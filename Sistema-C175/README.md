# DSS de mantenimiento predictivo: motor Cat C175-16 (CAT 793F, Cerro Verde)

Prototipo web del sistema de soporte a decisiones del proyecto de GSTI (UNSA, 2026). Muestra una flota simulada de 50 camiones durante 180 días y, para cada camión, la probabilidad de falla en 72 horas, el nivel de alerta (Normal, Precaución o Crítico), el sistema probablemente afectado y una recomendación redactada en lenguaje natural.

> Los datos son sintéticos. Las alertas no reemplazan el diagnóstico del personal de mantenimiento.

## Qué hace la web

- **Flota:** ranking de los 50 camiones por riesgo en la fecha elegida. El reloj de simulación se puede mover con el deslizador o reproducir a 1 hora, 6 horas o 1 día por segundo.
- **Ficha del camión:**
  - Nota de recomendación en lenguaje natural: qué está pasando, qué variables se desvían y cuánto, qué sistema sugieren, qué hacer y en qué plazo.
  - Lista de verificación de acciones.
  - Gráfico de la probabilidad en los últimos 14 días, con el nivel de alerta hora por hora.
  - Desvíos de las variables del sistema sugerido.
  - Lecturas de la última hora e historial de alertas.
  - Opción **Mostrar fallas reales de la simulación**, para comprobar si la alerta llegó a tiempo.
- **Umbrales y desempeño:** permite cambiar los umbrales y los tiempos de confirmación de la capa de decisión. Recalcula en el navegador, para toda la flota, las fallas detectadas, la anticipación, las falsas alarmas y el costo.
- **Redacción con IA (opcional):** si configuras `ANTHROPIC_API_KEY` en Vercel, aparece el botón **Redactar con IA**. Este envía a Claude solo el resumen del camión (nivel, probabilidad, desvíos y acciones base) y muestra una nota redactada. Sin la clave, el botón no aparece y la web usa la redacción por plantilla.

## Cómo funciona

```
telemetria_cat793f_sintetica.parquet ──► pipeline/pipeline.py ──► public/data/
  (generador del notebook, Parte A)       residuos por régimen        fleet.json      P(falla 72 h) calibrada de los 50 camiones
                                          ventanas 1/6/24/72 h        trucks/KT-xx.json  lecturas y desvíos por hora
                                          LightGBM + GroupKFold
                                          calibración isotónica
                                                    │
                                                    ▼
                         Navegador: capa de decisión (EWMA, debouncing, histéresis, cooldown)
                                    sistema sugerido + nota en lenguaje natural (src/lib/nlg.js)
                                                    │
                                                    ▼ (opcional)
                                     /api/recomendacion ──► API de Claude
```

- Las probabilidades de los 42 camiones de desarrollo son **fuera de muestra** (validación cruzada agrupada por camión). Las de los 8 camiones de prueba vienen del modelo final, que nunca vio esos camiones.
- La capa de decisión (`src/lib/dss.js`) replica la máquina de estados del notebook (sección B7).
- El sistema sugerido usa la firma física de cada falla: presión de aceite o boost que caen; temperaturas, blow-by o consumo que suben. Cada desvío se normaliza por una escala típica. En los 56 eventos simulados acierta el sistema en el 93 % de los casos (evaluado 48, 24 y 6 h antes de la falla). La regla del notebook, basada en z-scores, acertaba el 67 %.

Resultados del modelo reentrenado para la web (prueba, 8 camiones): PR-AUC 0.659 (azar 0.029), ROC-AUC 0.861. Con los umbrales del estudio detecta 11 de 13 fallas, con una anticipación mediana de 99 h y 3 falsas alarmas. Las cifras difieren levemente del notebook (PR-AUC 0.644) porque el modelo se reentrenó en otro entorno.

## Ejecutar en tu computadora

Requiere Node.js 18 o superior.

```bash
npm install
npm run dev        # http://localhost:5173
```

La función `/api` solo corre en Vercel (o con `npx vercel dev`). Con `npm run dev` la web funciona igual, sin el botón de IA.

## Desplegar en Vercel

**Opción A: desde GitHub (recomendada)**

1. Sube esta carpeta a un repositorio de GitHub (incluida `public/data`, de unos 24 MB).
2. En [vercel.com/new](https://vercel.com/new), importa el repositorio. Vercel detecta Vite: el comando de build es `npm run build` y la carpeta de salida es `dist`, como en `vercel.json`.
3. (Opcional) En *Settings → Environment Variables*, agrega `ANTHROPIC_API_KEY` con tu clave de la consola de Anthropic. También puedes agregar `ANTHROPIC_MODEL` si quieres otro modelo (por defecto, `claude-sonnet-5-5`).
4. Haz clic en *Deploy*. Cada `git push` vuelve a desplegar.

**Opción B: desde la terminal**

```bash
npm i -g vercel
vercel            # primera vez: vincula el proyecto
vercel env add ANTHROPIC_API_KEY   # opcional
vercel --prod
```

## Regenerar los datos del modelo

Si cambias el generador o recalibras sus supuestos (por ejemplo, el boost en altura o el consumo de combustible), vuelve a exportar los datos:

```bash
pip install -r pipeline/requirements.txt
python pipeline/pipeline.py telemetria_cat793f_sintetica.parquet eventos_falla.csv public/data
```

Tarda unos 3 minutos en una laptop.

## Estructura

```
api/                  funciones serverless de Vercel (estado de la IA y redacción)
pipeline/             reentrenamiento y exportación de datos (Python)
public/data/          datos del modelo que consume la web
src/lib/dss.js        capa de decisión y métricas por evento
src/lib/nlg.js        sistema sugerido y redacción en lenguaje natural
src/componentes/      Flota, ficha del camión, umbrales y desempeño
```
