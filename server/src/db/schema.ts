import type Database from "better-sqlite3";

// Spec section 8, canonical schema. Every statement is IF NOT EXISTS so
// migrate() is safe to run on every startup without a migrations table.
const CREATE_TRANSACTIONS = `
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  gmail_msg_id TEXT UNIQUE NOT NULL,
  gmail_thread_id TEXT,
  ts TEXT NOT NULL,
  direction TEXT NOT NULL,
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  counterparty TEXT,
  account TEXT,
  category TEXT,
  raw_subject TEXT,
  is_reversed INTEGER NOT NULL DEFAULT 0,
  is_internal INTEGER NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'claude',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const CREATE_STATEMENTS = `
CREATE TABLE IF NOT EXISTS statements (
  id INTEGER PRIMARY KEY,
  card_mask TEXT,
  issue_date TEXT,
  balance REAL,
  min_payment REAL,
  due_date TEXT,
  gmail_msg_id TEXT UNIQUE
);
`;

const CREATE_DEBTS = `
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY,
  person TEXT NOT NULL,
  amount REAL NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal',
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT
);
`;

const CREATE_STRATEGY_CONFIG = `
CREATE TABLE IF NOT EXISTS strategy_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const CREATE_SYNC_STATE = `
CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync_ts TEXT,
  last_history TEXT
);
`;

const CREATE_SAVINGS = `
CREATE TABLE IF NOT EXISTS savings (
  id INTEGER PRIMARY KEY,
  label TEXT,
  target REAL,
  reserved REAL DEFAULT 0,
  updated_at TEXT
);
`;

// TASK-033 (F3-A): the original CREATE_MESSAGES stub (id INTEGER, no
// conversation_id, no role/content constraints) was never written to by any
// code path — replaced here with the real chat schema: a message always
// belongs to a conversation and carries a validated role.
const CREATE_CONVERSATIONS = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

const CREATE_MESSAGES = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  ts TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Tablas del histórico reconstruido (historia/agentic-wallet-historia.sqlite).
//
// No estaban en el spec original: nacieron del trabajo de reconstrucción en
// recon-workspace/ y vivían en una base aparte, así que la app nunca las vio.
// Se traen tal cual (mismos nombres y columnas) en vez de traducirlas al
// vocabulario inglés del core: son un dominio propio -- sueldo quincenal,
// re-anclas de saldo, FlexiAhorro y metas de recorte -- y renombrarlas
// rompería los scripts de recon-workspace/ que las leen.
// ---------------------------------------------------------------------------

const CREATE_SUELDOS = `
CREATE TABLE IF NOT EXISTS sueldos (
  archivo TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL,
  periodo TEXT,
  anio INTEGER,
  mes INTEGER,
  quincena INTEGER,
  monto_neto REAL,
  leido_el TEXT
);
`;

/** Re-anclas de saldo leídas del banco por el usuario, no derivadas. */
const CREATE_SALDOS = `
CREATE TABLE IF NOT EXISTS saldos (
  fecha TEXT PRIMARY KEY,
  corriente REAL,
  flexiahorro REAL,
  emergencia REAL,
  nota TEXT
);
`;

const CREATE_FLEXIAHORRO = `
CREATE TABLE IF NOT EXISTS flexiahorro (
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL,
  monto REAL NOT NULL,
  PRIMARY KEY (fecha, tipo, monto)
);
`;

/** `meta` NULL = el rubro solo se observa, no se recorta. */
const CREATE_METAS = `
CREATE TABLE IF NOT EXISTS metas (
  rubro TEXT PRIMARY KEY,
  categoria TEXT NOT NULL,
  meta REAL,
  tipo TEXT NOT NULL,
  desde TEXT NOT NULL,
  nota TEXT
);
`;

/** `desvio` = real - meta; negativo significa que va bien. */
const CREATE_METAS_AVANCE = `
CREATE TABLE IF NOT EXISTS metas_avance (
  mes TEXT NOT NULL,
  rubro TEXT NOT NULL,
  real REAL NOT NULL,
  meta REAL,
  desvio REAL,
  PRIMARY KEY (mes, rubro)
);
`;

/**
 * User-owned merchant rules: "any counterparty containing <pattern> is
 * <category>". Ships EMPTY -- which merchants a person shops at is exactly
 * the kind of thing a boilerplate must not presume. `npm run onboard` fills
 * this by showing the user their own most frequent uncategorized
 * counterparties and asking which category each belongs to.
 *
 * `pattern` is stored already normalized (lowercased, accents stripped) and
 * matched as a substring, so one rule covers every casing/diacritic variant
 * the bank writes.
 */
const CREATE_CATEGORY_RULES = `
CREATE TABLE IF NOT EXISTS category_rules (
  id INTEGER PRIMARY KEY,
  pattern TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  created_at TEXT
);
`;

const CREATE_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_transactions_ts ON transactions (ts);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions (type);
CREATE INDEX IF NOT EXISTS idx_transactions_direction ON transactions (direction);
CREATE INDEX IF NOT EXISTS idx_transactions_counterparty ON transactions (counterparty);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_ts ON messages (conversation_id, ts);
`;

/** Creates the 14 tables + indexes if they don't already exist. Safe to call on every startup. */
export function migrate(db: Database.Database): void {
  db.exec(CREATE_TRANSACTIONS);
  db.exec(CREATE_STATEMENTS);
  db.exec(CREATE_DEBTS);
  db.exec(CREATE_STRATEGY_CONFIG);
  db.exec(CREATE_SYNC_STATE);
  db.exec(CREATE_SAVINGS);
  db.exec(CREATE_CONVERSATIONS);
  db.exec(CREATE_MESSAGES);
  db.exec(CREATE_SUELDOS);
  db.exec(CREATE_SALDOS);
  db.exec(CREATE_FLEXIAHORRO);
  db.exec(CREATE_METAS);
  db.exec(CREATE_METAS_AVANCE);
  db.exec(CREATE_CATEGORY_RULES);
  db.exec(CREATE_INDEXES);
}
