import React, { useMemo, useState } from 'react';
import { metricasEvento, PARAMS_DEFECTO } from '../lib/dss.js';

function Control({ etiqueta, ayuda, valor, min, max, paso, fmt, onChange }) {
  const id = etiqueta.replace(/\s/g, '-');
  return (
    <div className="control">
      <label htmlFor={id}><span>{etiqueta}</span><strong>{fmt(valor)}</strong></label>
      <input id={id} type="range" min={min} max={max} step={paso} value={valor} onChange={e => onChange(+e.target.value)} />
      <p className="pista">{ayuda}</p>
    </div>
  );
}

function Bloque({ titulo, nota, m }) {
  const f = (x, d = 0) => (Number.isNaN(x) ? '—' : x.toLocaleString('es-PE', { maximumFractionDigits: d, minimumFractionDigits: d }));
  return (
    <div className="bloque">
      <h3>{titulo}</h3>
      <p className="pista">{nota}</p>
      <dl className="metricas">
        <div><dt>Fallas detectadas</dt><dd>{m.detectados} de {m.eventos}</dd></div>
        <div><dt>Anticipación mediana</dt><dd>{f(m.leadP50)} h</dd></div>
        <div><dt>Anticipación en el peor 10 %</dt><dd>{f(m.leadP10)} h</dd></div>
        <div><dt>Falsas alarmas</dt><dd>{m.falsas}</dd></div>
        <div><dt>Falsas alarmas cada 1000 h</dt><dd>{f(m.far1000, 2)}</dd></div>
        <div><dt>Costo (falla no detectada × C_FN + falsa alarma)</dt><dd>{f(m.costo)}</dd></div>
      </dl>
    </div>
  );
}

export default function Ajustes({ flota, resultados, params, setParams }) {
  const [cfn, setCfn] = useState(20);
  const mTest = useMemo(() => metricasEvento(flota.trucks, resultados, c => c.particion === 'test', cfn), [flota, resultados, cfn]);
  const mDev = useMemo(() => metricasEvento(flota.trucks, resultados, c => c.particion !== 'test', cfn), [flota, resultados, cfn]);
  const set = (k, v) => setParams(p => ({ ...p, [k]: v }));
  const pct = v => `${Math.round(v * 100)} %`;
  const m = flota.metricas;

  return (
    <main className="ajustes">
      <section className="ajustes-controles">
        <h2>Umbrales de la capa de decisión</h2>
        <p>El modelo entrega una probabilidad; estos parámetros deciden cuándo se convierte en alerta. Cada cambio se recalcula para los 50 camiones y los 180 días de la simulación.</p>
        <Control etiqueta="Umbral de Precaución" valor={params.t1} min={0.03} max={0.45} paso={0.01} fmt={pct}
          ayuda="Más bajo: alertas más tempranas y más falsas alarmas." onChange={v => setParams(p => ({ ...p, t1: v, t2: Math.max(p.t2, v + 0.05) }))} />
        <Control etiqueta="Umbral de Crítico" valor={params.t2} min={0.2} max={0.9} paso={0.01} fmt={pct}
          ayuda="Probabilidad a partir de la cual se recomienda retirar el camión del ciclo." onChange={v => set('t2', Math.max(v, params.t1 + 0.05))} />
        <Control etiqueta="Confirmación para subir de nivel" valor={params.nOn} min={1} max={12} paso={1} fmt={v => `${v * 10} min`}
          ayuda="Tiempo que la probabilidad debe sostenerse sobre el umbral antes de alertar." onChange={v => set('nOn', v)} />
        <Control etiqueta="Confirmación para bajar de nivel" valor={params.nOff} min={1} max={36} paso={1} fmt={v => `${v * 10} min`}
          ayuda="Evita que la alerta se encienda y apague repetidamente." onChange={v => set('nOff', v)} />
        <Control etiqueta="Costo de una falla no detectada" valor={cfn} min={5} max={50} paso={1} fmt={v => `${v} falsas alarmas`}
          ayuda="Cuántas falsas alarmas equivalen, en costo, a una falla que no se anticipó." onChange={setCfn} />
        <button className="btn" onClick={() => { setParams(PARAMS_DEFECTO); setCfn(20); }}>Restablecer valores del estudio</button>
      </section>
      <section className="ajustes-resultados">
        <Bloque titulo="Camiones de prueba (8)" nota="Nunca se usaron para entrenar el modelo ni para elegir los umbrales del estudio." m={mTest} />
        <Bloque titulo="Camiones de desarrollo (42)" nota="Probabilidades fuera de muestra por validación cruzada agrupada por camión." m={mDev} />
        <div className="bloque">
          <h3>Calidad del modelo por registro</h3>
          <dl className="metricas">
            <div><dt>PR-AUC en prueba</dt><dd>{m.PR_AUC_test.toFixed(3)}</dd></div>
            <div><dt>Azar (prevalencia)</dt><dd>{m.prevalencia_test.toFixed(3)}</dd></div>
            <div><dt>ROC-AUC en prueba</dt><dd>{m.ROC_AUC_test.toFixed(3)}</dd></div>
            <div><dt>Brier calibrado en prueba</dt><dd>{m.Brier_test_cal.toFixed(4)}</dd></div>
          </dl>
          <p className="pista">LightGBM con 69 características (residuos por régimen y ventanas de 1 a 72 h), calibrado con regresión isotónica.</p>
        </div>
      </section>
    </main>
  );
}
