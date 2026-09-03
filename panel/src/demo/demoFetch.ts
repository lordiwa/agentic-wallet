/**
 * **Copia de `web/src/demo/demoFetch.ts`** (criterio 4 de TASK-056: copiar es
 * copiar; nada de arriba se reescribio). Lo que N2 agrega es T4 —"el modo demo
 * cubre las rutas que el andamio necesita"— y vive abajo, en su propio bloque,
 * salvo un cambio de comportamiento que se explica donde ocurre: en `web/` el
 * `POST /api/sync` de la demo era un 503, y con el sync adentro del chip eso
 * dejaria la mitad del hogar sin poder mostrarse nunca.
 *
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

  if (pathname === "/api/sync/status") return jsonResponse(demoSyncStatus());

  if (pathname === "/api/sync" && method === "POST") return jsonResponse(demoSyncBatch());

  if (pathname === "/api/classify/progress") return jsonResponse(DEMO_CLASSIFY_PROGRESS);

  if (pathname === "/api/classify/queue") {
    const groups = demoClassifyGroups(path);
    return jsonResponse({ groups, count: groups.length });
  }

  if (pathname === "/api/conversations") return jsonResponse({ conversations: [] });

  if (pathname.startsWith("/api/chat")) return chatStreamResponse();

  return jsonResponse({ error: "not found" }, 404);
}

/* ==========================================================================
 * T4 — lo que el andamio de N2 necesita del modo demo, contado como trabajo
 * (W6). Nada de arriba se reescribió; esto es lo que se agregó.
 *
 * Las dos reglas del encabezado siguen valiendo: nombres ficticios, y el modo
 * se anuncia siempre.
 * ========================================================================== */

/** Correos del buzón inventado, y cuántos drena cada llamada. Dos lotes: uno
 * no alcanza, que es justamente lo que el chip tiene que saber mostrar. */
const DEMO_BUZON = 3800;
const DEMO_LOTE = 1240;

/**
 * El único estado mutable de la demo. Existe porque el ciclo del sync **es**
 * un estado: disparar, quedar a medias, *Seguir*, terminar. Sin esto la demo
 * podría mostrar el botón pero nunca la barra de progreso ni *Seguir*, que es
 * la mitad del hogar de N2.
 *
 * Vive en el módulo (no en `localStorage`): la demo se reinicia sola al
 * recargar, que es el comportamiento correcto para algo que no persiste nada.
 */
const demoSync = {
  procesados: 0,
  /** `null` = nunca se sincronizó en esta sesión de demo. */
  ultimoSync: null as string | null,
};

function demoSyncStatus() {
  const aMedias = demoSync.procesados > 0 && demoSync.procesados < DEMO_BUZON;
  return {
    last_sync_ts: demoSync.ultimoSync,
    // R9: la demo también lo expone. Siempre false — un `fetch` inventado no
    // deja nada en vuelo entre dos llamadas.
    running: false,
    backlog: aMedias
      ? {
          processed: demoSync.procesados,
          total: DEMO_BUZON,
          remaining: DEMO_BUZON - demoSync.procesados,
          updated_at: daysAgo(0),
        }
      : null,
  };
}

/**
 * Un lote de la demo, con la misma forma que `POST /api/sync` de verdad
 * (`server/src/api/sync-route.ts`): `summary`, `progress` e `inserted_ids`.
 *
 * En `web/` esta ruta era un 503 ("no hay buzón que sincronizar"), y para un
 * dashboard que sólo miraba estaba bien. Con el sync adentro del chip, un 503
 * fijo haría que el modo demo no pueda mostrar ni la barra ni *Seguir* ni los
 * dos avisos post-sync: se estaría publicando una interfaz que oculta
 * justamente lo que N2 entrega.
 */
function demoSyncBatch() {
  const desde = demoSync.procesados;
  const procesados = Math.min(DEMO_BUZON, desde + DEMO_LOTE);
  demoSync.procesados = procesados;
  const complete = procesados >= DEMO_BUZON;
  if (complete) {
    demoSync.ultimoSync = daysAgo(0);
    demoSync.procesados = 0;
  }

  // Ids inventados y estables por lote: son los que el aviso de categoría le
  // pasaría a la cola (D7-b).
  const insertedIds = [desde + 1, desde + 2, desde + 3];

  return {
    summary: {
      seen: procesados - desde,
      inserted: insertedIds.length,
      duplicates: 0,
      needsReview: 2,
      skipped: 0,
      statementsPersisted: 0,
      statementsNeedReview: 0,
      reversalsApplied: 0,
    },
    progress: {
      processed: procesados,
      total: DEMO_BUZON,
      remaining: DEMO_BUZON - procesados,
      complete,
    },
    inserted_ids: insertedIds,
  };
}

/** Los grupos que la demo tiene para preguntar. Contrapartes ficticias, igual
 * que las transacciones de arriba. */
const DEMO_CLASSIFY_GROUPS = [
  {
    pattern: "mercado ejemplo",
    counterparty: "Mercado Ejemplo",
    count: 4,
    total: 65,
    months: 2,
    category: "otros",
    last_ts: daysAgo(3),
  },
  {
    pattern: "contacto uno",
    counterparty: "Contacto Uno",
    count: 2,
    total: 100,
    months: 1,
    category: "transferencia_persona",
    last_ts: daysAgo(2),
  },
  {
    pattern: "cajero ejemplo",
    counterparty: "Cajero Ejemplo",
    count: 1,
    total: 80,
    months: 1,
    category: "otros",
    last_ts: daysAgo(9),
  },
];

const DEMO_CLASSIFY_PROGRESS = {
  spending_total: 365.5,
  baseline_total: 245,
  covered_total: 0,
  covered_ratio: 0,
  unclassified_total: 245,
  unclassified_ratio: 0.6703,
  groups: DEMO_CLASSIFY_GROUPS.length,
  transactions: DEMO_CLASSIFY_GROUPS.reduce((sum, g) => sum + g.count, 0),
  target_ratio: 0.8,
  answers_to_target: 2,
  amount_to_target: 165,
  done: false,
};

/** `?transaction_ids=` acota la cola al lote (D7-b). Una lista vacía es una
 * cola vacía, no "sin filtro" — igual que en el motor. */
function demoClassifyGroups(path: string) {
  const query = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  const ids = new URLSearchParams(query).get("transaction_ids");
  if (ids === null) return DEMO_CLASSIFY_GROUPS;
  const cuantos = ids.split(",").filter((part) => part.trim() !== "").length;
  return DEMO_CLASSIFY_GROUPS.slice(0, Math.min(cuantos, DEMO_CLASSIFY_GROUPS.length));
}
