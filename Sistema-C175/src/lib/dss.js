// Capa de decisión del DSS (misma lógica que fsm_dss del notebook, sección B7).
// Las probabilidades llegan cuantizadas: 0..250 = P*250, 254 = sin dato, 255 = fuera de servicio.

export const PASOS_HORA = 6;           // 10 min por paso
export const PASOS_DIA = 144;

export const PARAMS_DEFECTO = {
  t1: 0.18,          // umbral de Precaución (elegido por costo en DEV)
  t2: 0.50,          // umbral de Crítico = max(0.50, 2 * t1)
  hist: 0.7,         // histéresis
  nOn: 3,            // pasos consecutivos para subir de nivel
  nOff: 6,           // pasos consecutivos para bajar
  cooldown: 36,      // 6 h sin nueva alerta tras volver a Normal
  ewmaSpan: 18,      // ~3 h
};

export function decodificar(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function correrFSM(codigos, inicioSeg, p) {
  const n = codigos.length;
  const estado = new Int8Array(n).fill(-1);       // -1 = fuera de servicio
  const ps = new Float32Array(n).fill(NaN);
  const inicio = new Uint8Array(n);
  for (const s of inicioSeg) inicio[s] = 1;
  const alpha = 2 / (p.ewmaSpan + 1);
  let s = 0, cUp = 0, cDn = 0, cd = 0, pss = NaN;
  for (let i = 0; i < n; i++) {
    const c = codigos[i];
    if (c === 255) { estado[i] = -1; continue; }
    if (inicio[i]) { s = 0; cUp = 0; cDn = 0; cd = 0; pss = NaN; }
    if (c !== 254) {
      const pi = c / 250;
      pss = Number.isNaN(pss) ? pi : alpha * pi + (1 - alpha) * pss;
      const obj = pss >= p.t2 ? 2 : pss >= p.t1 ? 1 : 0;
      if (obj > s) {
        cDn = 0;
        if (cd === 0) { cUp++; if (cUp >= p.nOn) { s = obj; cUp = 0; } } else cUp = 0;
      } else {
        cUp = 0;
        if (s > 0) {
          const salida = (s === 2 ? p.t2 : p.t1) * p.hist;
          if (pss < salida) { cDn++; if (cDn >= p.nOff) { s--; cDn = 0; if (s === 0) cd = p.cooldown; } }
          else cDn = 0;
        }
      }
    }
    if (cd > 0) cd--;
    estado[i] = s;
    ps[i] = pss;
  }
  return { estado, ps };
}

// Episodios de alerta (estado >= 1), separados por más de 2 h
export function episodios(estado) {
  const eps = [];
  let ini = -1, fin = -1, max = 0;
  for (let i = 0; i < estado.length; i++) {
    if (estado[i] >= 1) {
      if (ini >= 0 && i - fin > 2 * PASOS_HORA) { eps.push({ ini, fin, max }); ini = -1; }
      if (ini < 0) { ini = i; max = 0; }
      fin = i; max = Math.max(max, estado[i]);
    }
  }
  if (ini >= 0) eps.push({ ini, fin, max });
  return eps;
}

// Métricas por evento (como metr_oper del notebook): ventana útil de 168 h antes de la falla
export function metricasEvento(camiones, resultados, filtro, C_FN = 20, C_FP = 1) {
  const V = 168 * PASOS_HORA;
  let nEv = 0, det = 0, falsas = 0, pasosServicio = 0;
  const leads = [];
  for (const c of camiones) {
    if (!filtro(c)) continue;
    const { estado } = resultados[c.id];
    for (let i = 0; i < estado.length; i++) if (estado[i] >= 0) pasosServicio++;
    const eps = episodios(estado);
    const usado = new Array(eps.length).fill(false);
    for (const f of c.fallas) {
      nEv++;
      let mejor = null;
      eps.forEach((e, k) => {
        if (e.ini <= f.step && e.fin >= f.step - V) { usado[k] = true; if (mejor === null || e.ini < mejor) mejor = e.ini; }
      });
      if (mejor !== null) { det++; leads.push((f.step - mejor) / PASOS_HORA); }
    }
    falsas += usado.filter(u => !u).length;
  }
  leads.sort((a, b) => a - b);
  const pct = q => leads.length ? leads[Math.min(leads.length - 1, Math.floor(q * (leads.length - 1) + 0.5))] : NaN;
  const horas = pasosServicio / PASOS_HORA;
  return { eventos: nEv, detectados: det, recall: nEv ? det / nEv : NaN, leadP50: pct(0.5), leadP10: pct(0.1),
    falsas, far1000: horas ? falsas / horas * 1000 : NaN, costo: C_FN * (nEv - det) + C_FP * falsas };
}

export const NIVELES = [
  { id: 0, nombre: 'Normal', clase: 'normal' },
  { id: 1, nombre: 'Precaución', clase: 'precaucion' },
  { id: 2, nombre: 'Crítico', clase: 'critico' },
];
export const nombreNivel = s => (s < 0 ? 'En taller' : NIVELES[s].nombre);
export const claseNivel = s => (s < 0 ? 'taller' : NIVELES[s].clase);

export function fechaDePaso(t0, paso) {
  return new Date(Date.parse(t0.endsWith('Z') ? t0 : t0 + 'Z') + paso * 10 * 60 * 1000);
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export function fmtFecha(d, conHora = true) {
  const dd = d.getUTCDate(), mm = MESES[d.getUTCMonth()];
  const hh = String(d.getUTCHours()).padStart(2, '0'), mi = String(d.getUTCMinutes()).padStart(2, '0');
  return conHora ? `${dd} ${mm}, ${hh}:${mi}` : `${dd} ${mm}`;
}
