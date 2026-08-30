// Probe aislado del ItemsExtractor de Claude con un correo FICTICIO.
// No toca la base ni el buzon.
import { createClaudeEmailExtractor } from "./src/ingest/claude-email-extractor.js";
import { validateAmount } from "./src/ingest/amount-validate.js";

const fake = {
  subject: "Notificacion de Consumo",
  body: "Estimado cliente, se registro un consumo por USD 12.34 en COMERCIO DE PRUEBA el 30/08/2026.",
};

const started = Date.now();
const out = await createClaudeEmailExtractor().extract(fake);
const ms = Date.now() - started;
// El parser deterministico leeria 12.34 de este cuerpo; cruzamos contra eso.
const check = validateAmount(12.34, out.amount_text_raw);
console.log(JSON.stringify({ ms, extracted: out, crossCheck: check }, null, 2));
