// Redacción de recomendaciones en lenguaje natural a partir de la salida del modelo.
// No usa IA: es una plantilla con reglas, para que funcione sin claves ni conexión.

export const SISTEMAS = {
  refrigeracion: {
    nombre: 'refrigeración',
    z: ['z_res_T_refrigerante_C'],
    acciones: [
      'Revisar el nivel y el estado del refrigerante, y buscar fugas en mangueras y bomba de agua.',
      'Inspeccionar el radiador y el aftercooler (obstrucción por polvo, aletas dañadas).',
      'Tomar muestra de aceite S·O·S para descartar contaminación con refrigerante.',
    ],
  },
  lubricacion: {
    nombre: 'lubricación',
    z: ['z_res_P_aceite_kPa'],
    acciones: [
      'Verificar el nivel de aceite y el estado de los filtros.',
      'Medir la presión de aceite con manómetro de referencia para descartar falla de sensor.',
      'Tomar muestra de aceite para análisis de viscosidad, dilución y metales de desgaste.',
    ],
  },
  aire_turbo: {
    nombre: 'aire y turbo',
    z: ['z_res_P_boost_kPa', 'z_res_T_admision_C'],
    acciones: [
      'Inspeccionar los turbocargadores (juego axial y radial, fugas de aceite).',
      'Revisar el aftercooler y los ductos de admisión en busca de fugas.',
      'Verificar el estado de los filtros de aire y del prefiltro.',
    ],
  },
  inyeccion: {
    nombre: 'inyección',
    z: ['z_res_delta_T_escape_banco_C', 'z_res_consumo_comb_Lh'],
    acciones: [
      'Revisar el balance de temperatura de escape entre bancos con Cat ET.',
      'Hacer prueba de corte de cilindros para ubicar el inyector desbalanceado.',
      'Verificar la calidad del combustible y el estado de los filtros de combustible.',
    ],
  },
  desgaste_cilindro: {
    nombre: 'desgaste de cilindros',
    z: ['z_res_blowby_kPa'],
    acciones: [
      'Medir el blow-by en prueba estática y comparar con la referencia del motor.',
      'Revisar el análisis de aceite (hierro, cromo, silicio) para confirmar desgaste.',
      'Programar boroscopía de camisas si se confirma el aumento.',
    ],
  },
};

// Variables con residuo (observado − esperado para el régimen), con unidad, escala y redacción
const VARS = [
  { k: 'r_P_aceite', u: 'kPa', esc: 20, nom: 'la presión de aceite', d: 0 },
  { k: 'r_T_aceite', u: '°C', esc: 3, nom: 'la temperatura del aceite', d: 1 },
  { k: 'r_T_refrig', u: '°C', esc: 3, nom: 'la temperatura del refrigerante', d: 1 },
  { k: 'r_boost', u: 'kPa', esc: 9, nom: 'la presión de sobrealimentación', d: 0 },
  { k: 'r_T_adm', u: '°C', esc: 2.5, nom: 'la temperatura de admisión', d: 1 },
  { k: 'r_T_escape', u: '°C', esc: 15, nom: 'la temperatura de escape', d: 0 },
  { k: 'r_dT_bancos', u: '°C', esc: 6, nom: 'la diferencia de temperatura de escape entre bancos', d: 0 },
  { k: 'r_consumo', u: 'L/h', esc: 18, nom: 'el consumo de combustible', d: 0 },
  { k: 'r_blowby', u: 'kPa', esc: 0.12, nom: 'el blow-by', d: 2 },
];

// Sistema sugerido: el sistema cuya señal característica se desvía más, en la dirección física de la falla
// (presión de aceite o boost que caen, temperaturas, blow-by o consumo que suben), normalizada por una escala típica.
const FIRMA = {
  refrigeracion: [['r_T_refrig', 3]],
  lubricacion: [['r_P_aceite', -20]],
  aire_turbo: [['r_boost', -9], ['r_T_adm', 2.5]],
  inyeccion: [['r_dT_bancos', 6], ['r_consumo', 18]],
  desgaste_cilindro: [['r_blowby', 0.12]],
};
export function sistemaSugerido(serie, h) {
  let mejor = null, mejorS = -Infinity;
  for (const [id, vs] of Object.entries(FIRMA)) {
    const sc = Math.max(...vs.map(([k, e]) => (serie[k]?.[h] ?? 0) / e));
    if (sc > mejorS) { mejorS = sc; mejor = id; }
  }
  return { id: mejor, z: mejorS };
}

export function senales(serie, h, max = 3) {
  const out = [];
  for (const v of VARS) {
    const r = serie[v.k]?.[h];
    if (r == null) continue;
    const score = Math.abs(r) / v.esc;
    if (score >= 1) out.push({ ...v, r, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

const pct = p => `${Math.round(p * 100)} %`;
const num = (x, d) => Math.abs(x).toLocaleString('es-PE', { maximumFractionDigits: d, minimumFractionDigits: d });
const frase = s => `${s.nom} está ${num(s.r, s.d)} ${s.u} por ${s.r < 0 ? 'debajo' : 'encima'} de lo esperado`;
function lista(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' y ' + items[items.length - 1];
}
function duracion(h) {
  if (h < 1) return 'hace menos de una hora';
  if (h < 48) return `hace ${Math.round(h)} ${Math.round(h) === 1 ? 'hora' : 'horas'}`;
  return `hace ${Math.round(h / 24)} días`;
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * ctx: { id, estado, p, p24, horasEnEstado, horasEnTaller, sistema, senales }
 * Devuelve { titular, parrafos[], acciones[], plazo }
 */
export function redactar(ctx) {
  const { id, estado, p, p24 } = ctx;
  if (estado < 0) {
    return {
      titular: `${id} está en taller`,
      parrafos: [`El camión salió de servicio ${duracion(ctx.horasEnTaller)} y no envía telemetría. Al volver a operar, el DSS reinicia su historial y necesita unas horas de datos para estimar de nuevo el riesgo.`],
      acciones: ['Registrar en el sistema la causa de la intervención y los componentes cambiados, para mejorar el modelo.'],
      plazo: null,
    };
  }
  if (p == null || Number.isNaN(p)) {
    return { titular: `${id}: sin datos recientes`, parrafos: ['No hay telemetría válida en este momento (corte de comunicación o sensores sin lectura). El nivel de alerta se mantiene hasta recibir datos.'], acciones: ['Verificar la comunicación del equipo con el sistema de monitoreo.'], plazo: null };
  }

  const sis = SISTEMAS[ctx.sistema];
  const delta = p - (p24 ?? p);
  let tendencia;
  if (p24 == null || Number.isNaN(p24)) tendencia = `La probabilidad de falla en las próximas 72 horas es de ${pct(p)}.`;
  else if (delta > 0.04) tendencia = `La probabilidad de falla en las próximas 72 horas subió de ${pct(p24)} a ${pct(p)} en el último día.`;
  else if (delta < -0.04) tendencia = `La probabilidad de falla en las próximas 72 horas bajó de ${pct(p24)} a ${pct(p)} en el último día.`;
  else tendencia = `La probabilidad de falla en las próximas 72 horas se mantiene en torno a ${pct(p)}.`;
  const ss = ctx.senales;
  const evidencia = ss.length
    ? `Comparado con lo normal para la carga, las RPM y la pendiente en que opera, ${lista(ss.map(frase))}.`
    : 'Ninguna variable se aparta claramente de lo esperado para su régimen; el riesgo viene de desvíos pequeños y sostenidos en varias señales.';

  if (estado === 0) {
    const vigilar = ss.length ? ` Como único punto a vigilar, ${frase(ss[0])}.` : '';
    return {
      titular: `${id} opera con normalidad`,
      parrafos: [`${tendencia} No hay señales de degradación que justifiquen una intervención.${vigilar}`],
      acciones: ['Mantener el monitoreo y el mantenimiento preventivo programado.'],
      plazo: null,
    };
  }

  const calib = `De cada 100 situaciones con este nivel de riesgo, alrededor de ${Math.max(1, Math.round(p * 100))} terminan en una falla dentro de 72 horas.`;
  if (estado === 1) {
    const urgente = p >= 0.32 || delta > 0.1;
    const plazo = urgente ? 'en las próximas 24 horas' : 'en la próxima parada programada, antes de 72 horas';
    return {
      titular: `${id} requiere una inspección de ${sis.nombre}`,
      parrafos: [
        `${id} está en Precaución desde ${duracion(ctx.horasEnEstado).replace('hace ', 'hace ')}. ${tendencia} ${calib}`,
        `${evidencia} El patrón coincide con una degradación del sistema de ${sis.nombre}.`,
        `Recomiendo programar la inspección ${plazo}${urgente ? ', porque el riesgo está creciendo' : ''}. El camión puede seguir operando mientras tanto; si la probabilidad supera el 50 %, el DSS lo pasará a Crítico.`,
      ],
      acciones: sis.acciones,
      plazo: cap(plazo),
    };
  }
  return {
    titular: `${id} en estado crítico: revisar ${sis.nombre} ahora`,
    parrafos: [
      `${id} pasó a Crítico ${duracion(ctx.horasEnEstado)}. ${tendencia} ${calib}`,
      `${evidencia} Todo apunta al sistema de ${sis.nombre}.`,
      `Recomiendo retirar el camión del ciclo en cuanto sea seguro hacerlo y evaluar la detención antes de que termine el turno. Seguir operando con este nivel de riesgo expone al motor a una falla mayor y a una parada más larga.`,
    ],
    acciones: ['Coordinar con despacho el retiro del camión del ciclo de acarreo.', ...sis.acciones],
    plazo: 'Antes del fin del turno',
  };
}

// Contexto compacto para la redacción con IA (opcional)
export function contextoIA(ctx, nota) {
  return {
    camion: ctx.id, nivel: ['Normal', 'Precaución', 'Crítico'][ctx.estado] ?? 'En taller',
    probabilidad_72h: ctx.p != null ? Math.round(ctx.p * 100) / 100 : null,
    probabilidad_hace_24h: ctx.p24 != null ? Math.round(ctx.p24 * 100) / 100 : null,
    horas_en_nivel: Math.round(ctx.horasEnEstado ?? 0),
    sistema_sugerido: SISTEMAS[ctx.sistema]?.nombre,
    desvios: ctx.senales.map(s => ({ variable: s.nom, desvio: Math.round(s.r * 100) / 100, unidad: s.u })),
    acciones_base: nota.acciones,
  };
}
