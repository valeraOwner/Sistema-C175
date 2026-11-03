"""Reproduce la Parte B del notebook (B1-B6, B10) y exporta los datos que usa la web.

Uso: python pipeline.py <telemetria.parquet> <eventos.csv> <carpeta_salida>
"""
import sys, os, json, time, base64
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.model_selection import GroupKFold
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import average_precision_score, roc_auc_score, brier_score_loss

PARQ, EVCSV, OUT = sys.argv[1:4]
PASO_MIN, SEMILLA = 10, 42
PASO_H = PASO_MIN / 60
PB = {"ventanas_pasos": {"1h": 6, "6h": 36, "24h": 144, "72h": 432}, "folds": 5, "stride_lgb": 3}
t0 = time.time()
log = lambda *a: print(f"[{time.time()-t0:6.0f}s]", *a, flush=True)

df = pd.read_parquet(PARQ)
D = df.sort_values(["truck_id", "timestamp"]).reset_index(drop=True); del df
D["modo"] = D["modo_ciclo"].cat.codes.astype(np.int8)
salto = D.groupby("truck_id")["timestamp"].diff() > pd.Timedelta(minutes=PASO_MIN * 1.5)
D["segmento"] = salto.groupby(D["truck_id"]).cumsum().astype(int)
D["seg_global"] = D.groupby(["truck_id", "segmento"]).ngroup()
N = len(D); POS = np.arange(N)
PRIMERO = POS - D.groupby("seg_global").cumcount().to_numpy()
D["inicio_seg"] = POS == PRIMERO


def estad_ventana(x, W, primero=PRIMERO, frac_min=0.3):
    x = x.astype(np.float64); v = ~np.isnan(x)
    c = np.concatenate([[0.0], np.cumsum(np.where(v, x, 0.0))])
    c2 = np.concatenate([[0.0], np.cumsum(np.where(v, x * x, 0.0))])
    n = np.concatenate([[0], np.cumsum(v)])
    i = np.arange(len(x)); s = np.maximum(i - W + 1, primero)
    cnt = n[i + 1] - n[s]
    ok = cnt >= np.maximum(1.0, frac_min * np.minimum(W, i - primero + 1))
    media = np.where(ok, (c[i + 1] - c[s]) / np.maximum(cnt, 1), np.nan)
    var = np.where(ok, (c2[i + 1] - c2[s]) / np.maximum(cnt, 1) - media**2, np.nan)
    return media.astype(np.float32), np.sqrt(np.maximum(var, 0)).astype(np.float32)


D["carga_m30"] = estad_ventana(D["carga_motor_pct"].to_numpy(), 3)[0]
D["carga_m60"] = estad_ventana(D["carga_motor_pct"].to_numpy(), 6)[0]
D["edad_motor_5k"] = np.floor(D["horas_motor"] / 5000).astype(np.int8)

SENS = ["P_aceite_kPa", "T_aceite_C", "T_refrigerante_C", "P_boost_kPa", "T_admision_C",
        "T_escape_C", "delta_T_escape_banco_C", "consumo_comb_Lh", "blowby_kPa"]
CTX_BASE = ["rpm", "carga_motor_pct", "carga_m30", "carga_m60", "payload_t", "velocidad_kmh",
            "pendiente_pct", "T_ambiente_C", "modo", "edad_motor_5k"]
m_tr = (D["particion_ref"] == "train").to_numpy() & (POS % 5 == 0)
ESPERADO = {}
for s in SENS:
    ok = m_tr & D[s].notna().to_numpy()
    mdl = lgb.LGBMRegressor(objective="l1", n_estimators=100, learning_rate=0.1, num_leaves=31, min_child_samples=500,
                            subsample=0.8, subsample_freq=1, random_state=SEMILLA, n_jobs=-1, verbose=-1)
    mdl.fit(D.loc[ok, CTX_BASE], D.loc[ok, s])
    ESPERADO[s] = mdl.predict(D[CTX_BASE]).astype(np.float32)
    D["res_" + s] = (D[s] - ESPERADO[s]).astype(np.float32)
D["res_dT_aceite_refrig"] = D["res_T_aceite_C"] - D["res_T_refrigerante_C"]
log("residuos listos")

RES = ["res_" + s for s in SENS] + ["res_dT_aceite_refrig"]
F = {}
for r in RES:
    x = D[r].to_numpy(); medias = {}
    for nombre, W in PB["ventanas_pasos"].items():
        m, sd = estad_ventana(x, W); medias[nombre] = m; F[f"{r}_m{nombre}"] = m
        if nombre == "24h":
            F[f"{r}_sd24h"] = sd
    F[f"{r}_tend"] = medias["6h"] - medias["72h"]
for nombre in ["6h", "24h"]:
    F[f"nivel_ref_bajo_m{nombre}"] = estad_ventana(D["nivel_refrigerante_bajo"].to_numpy(), PB["ventanas_pasos"][nombre])[0]
CTX_CLF = ["rpm", "carga_motor_pct", "carga_m60", "payload_t", "velocidad_kmh", "pendiente_pct", "modo"]
X = pd.concat([D[CTX_CLF].astype(np.float32), pd.DataFrame(F)], axis=1)
FEATS = list(X.columns)
y = D["falla_72h"].to_numpy()
log(len(FEATS), "características")

dev = D["particion_ref"].isin(["train", "val"]).to_numpy(); tst = (D["particion_ref"] == "test").to_numpy()
idx_dev, idx_tst = np.flatnonzero(dev), np.flatnonzero(tst)
FOLDS = [(idx_dev[a], idx_dev[b]) for a, b in GroupKFold(n_splits=PB["folds"]).split(idx_dev, groups=D.loc[dev, "truck_id"])]


def fab():
    return lgb.LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=31, min_child_samples=200, subsample=0.8,
                              subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, random_state=SEMILLA, n_jobs=-1, verbose=-1)


st = PB["stride_lgb"]
oof = np.full(N, np.nan, np.float32)
for k, (a, b) in enumerate(FOLDS):
    m = fab().fit(X.iloc[a[::st]], y[a[::st]]); oof[b] = m.predict_proba(X.iloc[b])[:, 1]; log("fold", k)
final = fab().fit(X.iloc[idx_dev[::st]], y[idx_dev[::st]])
pt = np.full(N, np.nan, np.float32); pt[idx_tst] = final.predict_proba(X.iloc[idx_tst])[:, 1]
iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(oof[idx_dev], y[idx_dev])
P = np.full(N, np.nan, np.float32)
P[idx_dev] = iso.predict(oof[idx_dev]); P[idx_tst] = iso.predict(pt[idx_tst])
# veto por datos: sin telemetría del motor no hay probabilidad (como NaN en la capa de decisión)
sin_datos = D[SENS].isna().all(axis=1).to_numpy()
P[sin_datos] = np.nan

metr = {
    "PR_AUC_dev": float(average_precision_score(y[idx_dev], oof[idx_dev])),
    "PR_AUC_test": float(average_precision_score(y[idx_tst], pt[idx_tst])),
    "ROC_AUC_test": float(roc_auc_score(y[idx_tst], pt[idx_tst])),
    "Brier_test_cal": float(brier_score_loss(y[idx_tst], iso.predict(pt[idx_tst]))),
    "prevalencia_test": float(y[idx_tst].mean()),
}
log("métricas", metr)

# z-score robusto de residuos 6 h (sistema sugerido, como en B10)
GRUPO_SIS = {"refrigeracion": ["res_T_refrigerante_C"], "lubricacion": ["res_P_aceite_kPa"],
             "aire_turbo": ["res_P_boost_kPa", "res_T_admision_C"],
             "inyeccion": ["res_delta_T_escape_banco_C", "res_consumo_comb_Lh"], "desgaste_cilindro": ["res_blowby_kPa"]}
Z = {}
for r in {c for v in GRUPO_SIS.values() for c in v}:
    x = X.loc[idx_dev, f"{r}_m6h"]; med = np.nanmedian(x); mad = np.nanmedian(np.abs(x - med))
    Z[r] = ((X[f"{r}_m6h"] - med) / (1.4826 * mad)).to_numpy().astype(np.float32)

# ---------------------------------------------------------------- exportación
os.makedirs(os.path.join(OUT, "trucks"), exist_ok=True)
T0 = pd.Timestamp("2026-01-01"); NSTEP = 180 * 144
D["step"] = ((D["timestamp"] - T0) / pd.Timedelta(minutes=PASO_MIN)).astype(int).to_numpy()
ev = pd.read_csv(EVCSV)
trucks = sorted(D["truck_id"].unique())
fleet = {"t0": "2026-01-01T00:00:00", "step_min": PASO_MIN, "n_steps": NSTEP, "trucks": [], "metricas": metr,
         "nota": "Probabilidades fuera de muestra: camiones DEV por validación cruzada (GroupKFold) y TEST con el modelo final."}
VARS_H = {"T_aceite_C": "T_aceite", "T_refrigerante_C": "T_refrig", "P_aceite_kPa": "P_aceite", "P_boost_kPa": "boost",
          "T_admision_C": "T_adm", "T_escape_C": "T_escape", "delta_T_escape_banco_C": "dT_bancos",
          "consumo_comb_Lh": "consumo", "blowby_kPa": "blowby", "carga_motor_pct": "carga", "T_ambiente_C": "T_amb"}


def q(a, nd):  # redondeo con None para NaN
    return [None if (v is None or not np.isfinite(v)) else round(float(v), nd) for v in a]


for tk in trucks:
    ii = np.flatnonzero((D["truck_id"] == tk).to_numpy())
    steps = D["step"].to_numpy()[ii]
    code = np.full(NSTEP, 255, np.uint8)                      # 255 = fuera de servicio (reparación)
    pv = P[ii]
    code[steps] = np.where(np.isnan(pv), 254, np.clip(np.round(pv * 250), 0, 250)).astype(np.uint8)   # 254 = sin dato
    seg = steps[D["inicio_seg"].to_numpy()[ii]].tolist()
    part = str(D["particion_ref"].iloc[ii[0]])
    e = ev[ev["truck_id"] == tk]
    fallas = [{"step": int(r.falla), "onset": int(r.onset), "sistema": r.sistema, "tipo": r.tipo} for r in e.itertuples()]
    fleet["trucks"].append({"id": tk, "particion": part, "p": base64.b64encode(code.tobytes()).decode(), "inicio_seg": seg,
                            "horas_motor0": round(float(D["horas_motor"].iloc[ii[0]]), 0), "fallas": fallas})
    # detalle horario
    hh = steps // 6
    g = pd.DataFrame({"h": hh})
    for c, k in VARS_H.items():
        g[k] = D[c].to_numpy()[ii]
    for s in SENS:
        g["r_" + VARS_H[s]] = X[f"res_{s}_m6h"].to_numpy()[ii]
    g["nivel_bajo"] = D["nivel_refrigerante_bajo"].to_numpy()[ii]
    g["modo"] = D["modo"].to_numpy()[ii]
    agg = g.groupby("h").agg({**{c: "mean" for c in g.columns if c not in ("h", "modo")}, "modo": lambda x: int(np.bincount(x[x >= 0]).argmax()) if (x >= 0).any() else -1})
    agg = agg.reindex(np.arange(NSTEP // 6))
    det = {"id": tk, "hora0": "2026-01-01T00:00:00", "n_horas": NSTEP // 6,
           "series": {k: q(agg[k].to_numpy(), 2 if k in ("blowby", "r_blowby") else 1) for k in agg.columns if k != "modo"},
           "modo": [None if not np.isfinite(v) else int(v) for v in agg["modo"].to_numpy()]}
    with open(os.path.join(OUT, "trucks", f"{tk}.json"), "w") as f:
        json.dump(det, f, separators=(",", ":"))
fleet["modos"] = list(D["modo_ciclo"].cat.categories)
with open(os.path.join(OUT, "fleet.json"), "w") as f:
    json.dump(fleet, f, separators=(",", ":"))
log("exportado")
