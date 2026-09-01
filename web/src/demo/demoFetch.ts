/**
 * Modo demostracion: respuestas inventadas, servidas sin salir a la red.
 *
 * Existe por una restriccion real, no por comodidad. El dashboard publicado
 * en un hosting estatico (Firebase) no tiene backend propio, y el server de
 * verdad escucha en 127.0.0.1 sin autenticacion — exponerlo para que la
 * pagina publica lo lea seria publicar el historial bancario. La salida no es
 * publicar datos: es publicar la INTERFAZ con datos falsos, y dejar que quien
 * la mire la apunte a su propio server cuando lo tenga accesible
 * (`?api=https://...`, ver ../api/base.ts).
 *
 * Dos reglas al tocar este archivo:
 *
 * 1. **Nada de aca puede parecerse a un dato real de nadie.** Nombres
 *    ficticios, montos redondos, ningun comercio ni banco de verdad. Este
 *    archivo se publica en una URL abierta.
 * 2. **El modo demo se anuncia siempre.** La UI lo dice en un cartel fijo
 *    (DemoBanner). Un dashboard financiero que muestra numeros inventados sin
 *    avisar es peor que uno vacio.
 *
 * Las fechas se calculan relativas a hoy para que la demo no envejezca; los
 * montos son fijos.
 */

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function dateOnly(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

interface DemoTx {
  id: number;
  ts: string;
  direction: string;
  type: string;
  amount: number;
  counterparty: string;
  category: string | null;
  needs_review: number;
}

const DEMO_TRANSACTIONS: DemoTx[] = [
  { id: 1, ts: daysAgo(0), direction: "out", type: "debito", amount: 12.5, counterparty: "Cafeteria Ejemplo", category: "comida", needs_review: 0 },
  { id: 2, ts: daysAgo(1), direction: "out", type: "servicio", amount: 40, counterparty: "Servicio de Luz Ficticio", category: "servicios", needs_review: 0 },
  { id: 3, ts: daysAgo(2), direction: "out", type: "transferencia", amount: 100, counterparty: "Contacto Uno", category: "transferencia_persona", needs_review: 1 },
  { id: 4, ts: daysAgo(3), direction: "out", type: "debito", amount: 65, counterparty: "Mercado Ejemplo", category: "comida", needs_review: 0 },
  { id: 5, ts: daysAgo(4), direction: "in", type: "sueldo", amount: 1200, counterparty: "Empresa Ficticia S.A.", category: null, needs_review: 0 },
  { id: 6, ts: daysAgo(6), direction: "out", type: "recarga", amount: 10, counterparty: "Operadora Ficticia", category: "recarga", needs_review: 0 },
  { id: 7, ts: daysAgo(8), direction: "out", type: "debito", amount: 25, counterparty: "Farmacia Ejemplo", category: "salud", needs_review: 0 },
  { id: 8, ts: daysAgo(9), direction: "out", type: "retiro", amount: 80, counterparty: "Cajero Ejemplo", category: "efectivo", needs_review: 1 },
  { id: 9, ts: daysAgo(11), direction: "out", type: "debito", amount: 18, counterparty: "Transporte Ejemplo", category: "transporte", needs_review: 0 },
  { id: 10, ts: daysAgo(13), direction: "out", type: "servicio", amount: 15, counterparty: "Suscripcion Ficticia", category: "suscripcion", needs_review: 0 },
];

function fullRow(tx: DemoTx) {
  return {
    id: tx.id,
    gmail_msg_id: `demo-${tx.id}`,
    gmail_thread_id: null,
    ts: tx.ts,
    direction: tx.direction,
    type: tx.type,
    amount: tx.amount,
    currency: "USD",
    counterparty: tx.counterparty,
    account: null,
    category: tx.category,
    raw_subject: "Notificacion de ejemplo",
    is_reversed: 0,
    is_internal: 0,
    needs_review: tx.needs_review,
    source: "demo",
    created_at: tx.ts,
  };
}

const DEMO_OVERVIEW = {
  balance: { amount: 1840.25, currency: "USD", at: dateOnly(0) },
  card: {
    card_mask: "XXXXXX0000",
    issue_date: dateOnly(-10),
    balance: 320,
    min_payment: 32,
    due_date: dateOnly(9),
  },
  counts: { total: DEMO_TRANSACTIONS.length, needs_review: DEMO_TRANSACTIONS.filter((t) => t.needs_review).length },
  safe_to_spend_hoy: 22.4,
  buffer_status: { objetivo: 500, reservado: 300, financiado: false, faltante: 200 },
  card_status: {
    saldoCorte: 320,
    minimo: 32,
    fechaMaxima: dateOnly(9),
    saldoActualEstimado: 320,
    aTiempo: true,
    requeridoPorQuincena: 160,
  },
  transfers_summary: {
    total: 100,
    tope: 500,
    restante: 400,
    sobrepasado: false,
    topContrapartes: [{ counterparty: "Contacto Uno", total: 100 }],
  },
  next_payday: dateOnly(12),
  spending_by_category: {
    comida: 77.5,
    servicios: 40,
    transferencia_persona: 100,
    salud: 25,
    efectivo: 80,
    transporte: 18,
    recarga: 10,
    suscripcion: 15,
  },
};

const DEMO_CONVERSATION_ID = "demo-conv-1";

const DEMO_CHAT_REPLY =
  "Estas viendo la demostracion: los numeros de esta pantalla son inventados. " +
  "Conectada a tu server, esta misma respuesta la escribe Claude leyendo tu ledger real.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Reproduce el framing SSE de `POST /api/chat` (ver server/src/api/chat-route.ts)
 * para que el parser del cliente sea el mismo en demo y en real. */
function chatStreamResponse(): Response {
  const frames = [
    `event: meta\ndata: ${JSON.stringify({ conversationId: DEMO_CONVERSATION_ID })}\n\n`,
    `event: text\ndata: ${JSON.stringify({ text: DEMO_CHAT_REPLY })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ assistantText: DEMO_CHAT_REPLY })}\n\n`,
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/**
 * Enruta por path (sin query) y devuelve una `Response` de verdad, no un
 * objeto parecido: el cliente hace `res.json()` y `res.body.getReader()` sin
 * enterarse de que no hubo red.
 */
export async function demoFetch(path: string, init?: RequestInit): Promise<Response> {
  const [pathname] = path.split("?");
  const method = (init?.method ?? "GET").toUpperCase();

  if (pathname === "/api/health") return jsonResponse({ status: "ok", mode: "demo" });

  if (pathname === "/api/overview") return jsonResponse(DEMO_OVERVIEW);

  if (pathname === "/api/review") {
    const rows = DEMO_TRANSACTIONS.filter((t) => t.needs_review).map(fullRow);
    return jsonResponse({ transactions: rows, count: rows.length });
  }

  if (pathname === "/api/transactions") {
    const rows = DEMO_TRANSACTIONS.map(fullRow);
    return jsonResponse({ transactions: rows, count: rows.length });
  }

  if (pathname === "/api/sync/status") {
    return jsonResponse({ last_sync_ts: daysAgo(0), backlog: null });
  }

  if (pathname === "/api/sync" && method === "POST") {
    // En demo no se sincroniza nada: decirlo es mas util que fingir un
    // resumen con correos que no existen.
    return jsonResponse({ error: "modo demostracion: no hay buzon que sincronizar" }, 503);
  }

  if (pathname === "/api/conversations") return jsonResponse({ conversations: [] });

  if (pathname.startsWith("/api/chat")) return chatStreamResponse();

  return jsonResponse({ error: "not found" }, 404);
}
