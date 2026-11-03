// Función serverless de Vercel (opcional): redacta la recomendación con Claude.
// Requiere la variable de entorno ANTHROPIC_API_KEY. Opcional: ANTHROPIC_MODEL.
// Sin la clave, la web usa la nota redactada por plantilla y oculta el botón.

const SISTEMA = `Eres el asistente de mantenimiento de una flota de camiones CAT 793F con motor Cat C175-16 en la mina Cerro Verde (Arequipa, 2650 msnm).
Recibes la salida de un modelo predictivo y redactas una nota breve para el supervisor de guardia, en español del Perú, tono profesional y directo.
Reglas:
- Usa solo los datos recibidos. No inventes lecturas, códigos de falla, repuestos ni historial.
- Explica en una frase qué significa la probabilidad (está calibrada: 0.20 equivale a que alrededor de 20 de cada 100 casos similares fallan en 72 h).
- Menciona los desvíos con sus unidades y explica qué sistema sugieren y por qué.
- Da una recomendación concreta con plazo, coherente con el nivel: Normal = seguir monitoreando; Precaución = programar inspección; Crítico = retirar del ciclo y evaluar detención.
- Cierra recordando que la decisión final es del personal de mantenimiento, en una frase corta.
- Máximo 160 palabras, 2 o 3 párrafos separados por una línea en blanco, sin viñetas, sin títulos, sin markdown.`;

function valida(b) {
  return b && typeof b.camion === 'string' && /^KT-\d{2}$/.test(b.camion) && typeof b.nivel === 'string';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST.' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(501).json({ error: 'La redacción con IA no está configurada (falta ANTHROPIC_API_KEY).' });
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  if (!valida(b)) return res.status(400).json({ error: 'Datos de entrada no válidos.' });
  const datos = JSON.stringify(b).slice(0, 4000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 600,
        system: SISTEMA,
        messages: [{ role: 'user', content: `Datos del DSS para este camión (JSON):\n${datos}\n\nRedacta la nota para el supervisor.` }],
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: j?.error?.message || `La API respondió ${r.status}.` });
    const texto = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    return res.status(200).json({ texto });
  } catch (e) {
    return res.status(502).json({ error: `No se pudo contactar la API: ${e.message}` });
  }
}
