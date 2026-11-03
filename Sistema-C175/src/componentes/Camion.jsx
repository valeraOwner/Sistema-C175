import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, ReferenceLine, Tooltip, CartesianGrid } from 'recharts';
import { PASOS_HORA, PASOS_DIA, fechaDePaso, fmtFecha, claseNivel, nombreNivel, episodios } from '../lib/dss.js';
import { redactar, sistemaSugerido, senales, SISTEMAS, contextoIA } from '../lib/nlg.js';

const cache = {};
async function cargarDetalle(id) {
  if (!cache[id]) cache[id] = fetch(`data/trucks/${id}.json`).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  return cache[id];
}
let iaEstado = null;
async function iaDisponible() {
  if (iaEstado === null) iaEstado = fetch('/api/estado').then(r => (r.ok ? r.json() : { ia: false })).then(j => !!j.ia).catch(() => false);
  return iaEstado;
}

const VENTANA_H = 14 * 24;
const VARS_SIS = {
  refrigeracion: [['r_T_refrig', 'T refrigerante', '°C'], ['r_T_aceite', 'T aceite', '°C'], ['r_P_aceite', 'P aceite', 'kPa']],
  lubricacion: [['r_P_aceite', 'P aceite', 'kPa'], ['r_T_aceite', 'T aceite', '°C'], ['r_blowby', 'Blow-by', 'kPa']],
  aire_turbo: [['r_boost', 'Boost', 'kPa'], ['r_T_adm', 'T admisión', '°C'], ['r_T_escape', 'T escape', '°C']],
  inyeccion: [['r_consumo', 'Consumo', 'L/h'], ['r_dT_bancos', 'ΔT entre bancos', '°C'], ['r_T_escape', 'T escape', '°C']],
  desgaste_cilindro: [['r_blowby', 'Blow-by', 'kPa'], ['r_P_aceite', 'P aceite', 'kPa'], ['r_T_escape', 'T escape', '°C']],
};
const COLORES = ['#16708A', '#C2410C', '#6B5CA5'];
const LECTURAS = [
  ['T_aceite', 'Temperatura de aceite', '°C', 1], ['T_refrig', 'Temperatura de refrigerante', '°C', 1], ['P_aceite', 'Presión de aceite', 'kPa', 0],
  ['boost', 'Presión de sobrealimentación', 'kPa', 0], ['T_escape', 'Temperatura de escape', '°C', 0], ['consumo', 'Consumo de combustible', 'L/h', 0],
  ['blowby', 'Blow-by', 'kPa', 2], ['carga', 'Carga del motor', '%', 0],
];

export default function Camion({ fila, flota, res, paso, params, verFallas, setVerFallas }) {
  const [det, setDet] = useState(null);
  const [err, setErr] = useState(null);
  const [ia, setIa] = useState({ disponible: false, texto: null, cargando: false, error: null });

  useEffect(() => {
    let vivo = true; setDet(null); setErr(null);
    cargarDetalle(fila.id).then(d => vivo && setDet(d)).catch(() => vivo && setErr('No se pudo cargar el detalle de este camión.'));
    return () => { vivo = false; };
  }, [fila.id]);
  useEffect(() => { iaDisponible().then(ok => setIa(s => ({ ...s, disponible: ok }))); }, []);
  useEffect(() => { setIa(s => ({ ...s, texto: null, error: null })); }, [fila.id, Math.floor(paso / PASOS_HORA)]);

  const h = Math.floor(paso / PASOS_HORA);
  const c = fila.c;

  const ctx = useMemo(() => {
    if (!det) return null;
    const s = det.series;
    // última hora con datos (por si la actual es un corte)
    let hh = h; while (hh > 0 && s.T_aceite[hh] == null && h - hh < 6) hh--;
    let horasEnTaller = 0;
    if (fila.estado < 0) { let k = paso; while (k > 0 && res.estado[k - 1] < 0) k--; horasEnTaller = (paso - k) / PASOS_HORA; }
    return {
      id: fila.id, estado: fila.estado, p: Number.isNaN(fila.p) ? null : fila.p, p24: Number.isNaN(fila.p24) ? null : fila.p24,
      horasEnEstado: fila.horasEnEstado, horasEnTaller, hh,
      sistema: sistemaSugerido(s, hh).id, senales: senales(s, hh),
    };
  }, [det, h, fila, paso, res]);

  const nota = useMemo(() => (ctx ? redactar(ctx) : null), [ctx]);

  const datos = useMemo(() => {
    if (!det) return [];
    const ini = Math.max(0, h - VENTANA_H), out = [];
    for (let k = ini; k <= h; k++) {
      const i = k * PASOS_HORA + PASOS_HORA - 1 > paso ? paso : k * PASOS_HORA + PASOS_HORA - 1;
      const e = res.estado[i], p = res.ps[i];
      const o = { h: k, p: e < 0 || Number.isNaN(p) ? null : Math.round(p * 1000) / 10, e };
      for (const [key] of Object.values(VARS_SIS).flat()) o[key] = det.series[key]?.[k] ?? null;
      out.push(o);
    }
    return out;
  }, [det, h, paso, res]);

  const historial = useMemo(() => {
    const eps = episodios(res.estado.subarray(0, paso + 1));
    return eps.reverse().slice(0, 6).map(e => {
      const f = c.fallas.find(f => f.step >= e.ini && f.step - e.fin <= 168 * PASOS_HORA);
      return { ...e, falla: f };
    });
  }, [res, paso, c]);

  const proxima = c.fallas.find(f => f.step >= paso);
  const fmtH = k => fmtFecha(fechaDePaso(flota.t0, k * PASOS_HORA), false);

  async function redactarIA() {
    setIa(s => ({ ...s, cargando: true, error: null }));
    try {
      const r = await fetch('/api/recomendacion', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(contextoIA(ctx, nota)) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setIa(s => ({ ...s, texto: j.texto, cargando: false }));
    } catch (e) {
      setIa(s => ({ ...s, cargando: false, error: `No se pudo redactar con IA: ${e.message}` }));
    }
  }

  if (err) return <p className="aviso">{err}</p>;
  if (!det || !ctx) return <p className="aviso">Cargando {fila.id}…</p>;

  const vars = VARS_SIS[ctx.sistema];
  const nivel = claseNivel(fila.estado);

  return (
    <article className={`camion nivel-${nivel}`}>
      <header className="camion-cab">
        <div>
          <h2 className="camion-id">{fila.id}</h2>
          <p className="camion-meta">CAT 793F con motor C175-16. {Math.round(c.horas_motor0 + paso / PASOS_HORA).toLocaleString('es-PE')} horas de motor aproximadas.</p>
        </div>
        <div className="camion-estado">
          <span className={`chip grande ${nivel}`}>{nombreNivel(fila.estado)}</span>
          {ctx.p != null && fila.estado >= 0 && <span className="camion-p"><strong>{Math.round(ctx.p * 100)} %</strong> de probabilidad de falla en 72 h</span>}
        </div>
      </header>

      <section className={`nota ${nivel}`} aria-label="Recomendación">
        <h3>{nota.titular}</h3>
        {(ia.texto ? ia.texto.split(/\n\s*\n/) : nota.parrafos).map((t, i) => <p key={i}>{t}</p>)}
        {nota.acciones.length > 0 && fila.estado > 0 && !ia.texto && (
          <>
            <h4>Qué revisar{nota.plazo ? `, ${nota.plazo.toLowerCase()}` : ''}</h4>
            <ul className="acciones">{nota.acciones.map((a, i) => <li key={i}><label><input type="checkbox" /> {a}</label></li>)}</ul>
          </>
        )}
        <div className="nota-pie">
          {ia.disponible && fila.estado >= 0 && (
            ia.texto
              ? <button className="btn" onClick={() => setIa(s => ({ ...s, texto: null }))}>Volver a la nota estándar</button>
              : <button className="btn" onClick={redactarIA} disabled={ia.cargando}>{ia.cargando ? 'Redactando…' : 'Redactar con IA'}</button>
          )}
          {ia.texto && <span className="pista">Redactado por IA a partir de los mismos datos. Verifica antes de actuar.</span>}
          {ia.error && <span className="error">{ia.error}</span>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-cab">
          <h3>Probabilidad de falla en 72 h, últimos 14 días</h3>
          <label className="interruptor"><input type="checkbox" checked={verFallas} onChange={e => setVerFallas(e.target.checked)} /> Mostrar fallas reales de la simulación</label>
        </div>
        <div className="grafico">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={datos} margin={{ top: 8, right: 28, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#D5DBD9" vertical={false} />
              <XAxis dataKey="h" tickFormatter={fmtH} interval={47} tick={{ fontSize: 12, fill: '#56646A' }} stroke="#AAB4B2" />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v} %`} tick={{ fontSize: 12, fill: '#56646A' }} stroke="#AAB4B2" />
              <Tooltip formatter={v => [`${v} %`, 'P(falla 72 h)']} labelFormatter={k => fmtFecha(fechaDePaso(flota.t0, k * PASOS_HORA))} />
              <ReferenceLine y={params.t1 * 100} stroke="#B07A00" strokeDasharray="4 3" label={{ value: 'Precaución', position: 'insideTopLeft', fontSize: 11, fill: '#8A5F00' }} />
              <ReferenceLine y={params.t2 * 100} stroke="#B3261E" strokeDasharray="4 3" label={{ value: 'Crítico', position: 'insideTopLeft', fontSize: 11, fill: '#B3261E' }} />
              {verFallas && c.fallas.filter(f => f.step <= paso && f.step >= (h - VENTANA_H) * PASOS_HORA).map(f => (
                <ReferenceLine key={f.step} x={Math.floor(f.step / PASOS_HORA)} stroke="#1D2B31" strokeWidth={2} label={{ value: `Falla: ${SISTEMAS[f.sistema].nombre}`, position: 'insideTopRight', fontSize: 11, fill: '#1D2B31' }} />
              ))}
              <Area type="monotone" dataKey="p" stroke="#16708A" strokeWidth={2} fill="#16708A" fillOpacity={0.12} isAnimationActive={false} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="franja" aria-label="Nivel de alerta por hora">
            {datos.map(d => <span key={d.h} className={claseNivel(d.e)} />)}
          </div>
        </div>
        {verFallas && (
          <p className="pista">{proxima
            ? `Verdad de la simulación: este camión falla en ${SISTEMAS[proxima.sistema].nombre} el ${fmtFecha(fechaDePaso(flota.t0, proxima.step))} (en ${Math.round((proxima.step - paso) / PASOS_HORA)} h; falla ${proxima.tipo}).`
            : 'Verdad de la simulación: este camión no tiene más fallas programadas en el periodo.'} El modelo no usa esta información.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-cab">
          <h3>Desvío respecto a lo esperado: sistema de {SISTEMAS[ctx.sistema].nombre}</h3>
        </div>
        <p className="pista">Cada línea es la diferencia entre lo medido y lo que el modelo espera para la carga, las RPM, la pendiente y el clima del momento (media de 6 h). Cerca de cero es normal.</p>
        <div className="mini-graficos">
          {vars.map(([k, t, u], i) => (
            <div key={k} className="mini">
              <h4>{t} <span>({u})</span></h4>
              <ResponsiveContainer width="100%" height={110}>
                <ComposedChart data={datos} margin={{ top: 4, right: 6, left: -6, bottom: 0 }}>
                  <CartesianGrid stroke="#E1E6E4" vertical={false} />
                  <XAxis dataKey="h" hide />
                  <YAxis tick={{ fontSize: 11, fill: '#56646A' }} stroke="#AAB4B2" width={44} />
                  <ReferenceLine y={0} stroke="#8A9693" />
                  <Tooltip formatter={v => [`${v} ${u}`, t]} labelFormatter={k => fmtFecha(fechaDePaso(flota.t0, k * PASOS_HORA))} />
                  <Line type="monotone" dataKey={k} stroke={COLORES[i]} strokeWidth={2} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </section>

      <div className="dos-col">
        <section className="panel">
          <h3>Lecturas de la última hora</h3>
          <table className="lecturas">
            <tbody>
              {LECTURAS.map(([k, t, u, d]) => {
                const v = det.series[k]?.[ctx.hh];
                return <tr key={k}><th scope="row">{t}</th><td>{v == null ? '—' : `${v.toLocaleString('es-PE', { maximumFractionDigits: d, minimumFractionDigits: d })} ${u}`}</td></tr>;
              })}
            </tbody>
          </table>
        </section>
        <section className="panel">
          <h3>Alertas anteriores</h3>
          {historial.length === 0 ? <p className="pista">Sin alertas desde el inicio del periodo.</p> : (
            <ul className="historial">
              {historial.map(e => (
                <li key={e.ini}>
                  <span className={`punto ${claseNivel(e.max)}`} aria-hidden="true" />
                  <span>{fmtFecha(fechaDePaso(flota.t0, e.ini))}, {Math.max(1, Math.round((e.fin - e.ini) / PASOS_HORA))} h en {nombreNivel(e.max).toLowerCase()}</span>
                  {verFallas && <em>{e.falla ? `precedió a falla de ${SISTEMAS[e.falla.sistema].nombre}` : 'sin falla posterior'}</em>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </article>
  );
}
