import React from 'react';
import { claseNivel, nombreNivel } from '../lib/dss.js';

export default function Flota({ filas, sel, onSel }) {
  return (
    <ol className="flota" aria-label="Camiones ordenados por riesgo">
      {filas.map(f => {
        const p = Number.isNaN(f.p) ? null : f.p;
        const sube = p != null && !Number.isNaN(f.p24) && p - f.p24 > 0.04;
        return (
          <li key={f.id}>
            <button className={`fila ${sel === f.id ? 'sel' : ''}`} onClick={() => onSel(f.id)} aria-current={sel === f.id}>
              <span className="fila-id">{f.id}</span>
              <span className={`chip ${claseNivel(f.estado)}`}>{nombreNivel(f.estado)}</span>
              <span className="barra" aria-hidden="true"><span style={{ width: `${Math.min(100, (p ?? 0) * 100)}%` }} className={claseNivel(f.estado)} /></span>
              <span className="fila-p">{p == null ? '—' : `${Math.round(p * 100)} %`}{sube && <span className="sube" title="Subió en las últimas 24 h"> ▲</span>}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
