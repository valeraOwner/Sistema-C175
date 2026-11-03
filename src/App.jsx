import React, { useEffect, useMemo, useRef, useState } from 'react';
import { decodificar, correrFSM, PARAMS_DEFECTO, PASOS_DIA, PASOS_HORA, fechaDePaso, fmtFecha, claseNivel, nombreNivel } from './lib/dss.js';
import Flota from './componentes/Flota.jsx';
import Camion from './componentes/Camion.jsx';
import Ajustes from './componentes/Ajustes.jsx';

const VELOCIDADES = [{ v: 1, t: '1 h/s' }, { v: 6, t: '6 h/s' }, { v: 24, t: '1 día/s' }];

export default function App() {
  const [flota, setFlota] = useState(null);
  const [error, setError] = useState(null);
  const [paso, setPaso] = useState(66 * PASOS_DIA + 9 * PASOS_HORA);   // 8 mar, 09:00
  const [play, setPlay] = useState(false);
  const [vel, setVel] = useState(6);
  const [params, setParams] = useState(PARAMS_DEFECTO);
  const [sel, setSel] = useState(null);
  const [vista, setVista] = useState('flota');
  const [verFallas, setVerFallas] = useState(false);

  useEffect(() => {
    fetch('data/fleet.json').then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(f => { f.trucks.forEach(c => { c.codigos = decodificar(c.p); delete c.p; }); setFlota(f); })
      .catch(e => setError(`No se pudo cargar data/fleet.json (${e.message}). Revisa que la carpeta public/data esté en el despliegue.`));
  }, []);

  const resultados = useMemo(() => {
    if (!flota) return null;
    const r = {};
    for (const c of flota.trucks) r[c.id] = correrFSM(c.codigos, c.inicio_seg, params);
    return r;
  }, [flota, params]);

  // Reloj de simulación
  const ref = useRef();
  useEffect(() => {
    if (!play || !flota) return;
    ref.current = setInterval(() => setPaso(p => {
      const n = p + vel * PASOS_HORA / 4;
      if (n >= flota.n_steps - 1) { setPlay(false); return flota.n_steps - 1; }
      return n;
    }), 250);
    return () => clearInterval(ref.current);
  }, [play, vel, flota]);

  const filas = useMemo(() => {
    if (!flota || !resultados) return [];
    return flota.trucks.map(c => {
      const { estado, ps } = resultados[c.id];
      const s = estado[paso], p = ps[paso];
      const p24 = paso >= PASOS_DIA ? ps[paso - PASOS_DIA] : NaN;
      let desde = paso; while (desde > 0 && estado[desde - 1] === s) desde--;
      return { c, id: c.id, estado: s, p, p24, horasEnEstado: (paso - desde) / PASOS_HORA };
    }).sort((a, b) => (b.estado - a.estado) || ((b.p || 0) - (a.p || 0)));
  }, [flota, resultados, paso]);

  useEffect(() => { if (!sel && filas.length) setSel(filas[0].id); }, [filas, sel]);

  if (error) return <div className="vacio"><p>{error}</p></div>;
  if (!flota) return <div className="vacio"><p>Cargando la telemetría de la flota…</p></div>;

  const conteo = [2, 1, 0, -1].map(s => ({ s, n: filas.filter(f => f.estado === s).length }));
  const fecha = fechaDePaso(flota.t0, Math.floor(paso));
  const fila = filas.find(f => f.id === sel);

  return (
    <div className="app">
      <header className="cabecera">
        <div className="marca">
          <h1>Salud de motores C175-16</h1>
          <p>Flota simulada de 50 camiones CAT 793F en Cerro Verde, a 2650 msnm</p>
        </div>
        <div className="reloj" aria-label="Reloj de simulación">
          <button className="btn primario" onClick={() => setPlay(!play)} aria-pressed={play}>{play ? 'Pausar' : 'Reproducir'}</button>
          <div className="velocidades" role="group" aria-label="Velocidad de reproducción">
            {VELOCIDADES.map(o => <button key={o.v} className={`btn chico ${vel === o.v ? 'activo' : ''}`} onClick={() => setVel(o.v)}>{o.t}</button>)}
          </div>
          <div className="fecha"><span className="fecha-valor">{fmtFecha(fecha)}</span><span className="fecha-anio">2026</span></div>
          <input className="deslizador" type="range" min={PASOS_DIA * 3} max={flota.n_steps - 1} step={PASOS_HORA} value={Math.floor(paso)}
            onChange={e => { setPaso(+e.target.value); }} aria-label="Fecha de la simulación" />
        </div>
        <nav className="pestanas" aria-label="Vistas">
          <button className={vista === 'flota' ? 'activo' : ''} onClick={() => setVista('flota')}>Flota</button>
          <button className={vista === 'ajustes' ? 'activo' : ''} onClick={() => setVista('ajustes')}>Umbrales y desempeño</button>
        </nav>
      </header>

      {vista === 'flota' ? (
        <main className="cuerpo">
          <aside className="col-flota">
            <div className="resumen">
              {conteo.map(({ s, n }) => (
                <div key={s} className={`conteo ${claseNivel(s)}`}><strong>{n}</strong><span>{nombreNivel(s)}</span></div>
              ))}
            </div>
            <Flota filas={filas} sel={sel} onSel={setSel} />
          </aside>
          <section className="col-detalle">
            {fila && <Camion fila={fila} flota={flota} res={resultados[fila.id]} paso={Math.floor(paso)} params={params}
              verFallas={verFallas} setVerFallas={setVerFallas} />}
          </section>
        </main>
      ) : (
        <Ajustes flota={flota} resultados={resultados} params={params} setParams={setParams} />
      )}
      <footer className="pie">
        Prototipo académico. Datos sintéticos generados para el curso de Gestión de Sistemas y Tecnologías de Información (UNSA, 2026). Las alertas no reemplazan el diagnóstico del personal de mantenimiento.
      </footer>
    </div>
  );
}
