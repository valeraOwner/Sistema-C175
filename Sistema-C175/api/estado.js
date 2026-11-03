// Indica a la web si la redacción con IA está disponible (sin exponer la clave).
export default function handler(req, res) {
  res.status(200).json({ ia: Boolean(process.env.ANTHROPIC_API_KEY) });
}
