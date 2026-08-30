/**
 * Bank-agnostic email parsing contract (spec F1-03). A `BankEmailParser`
 * turns one inbound bank email into a deterministic `ParseResult`: a
 * transaction candidate, or a marker for the kinds of email another ticket
 * owns (ignored / statement / reverso). No parser persists anything — these
 * are pure functions over plain-text email content.
 */

/** Plain-text inbound email, already stripped of any HTML (a later ticket owns HTML->text). */
export interface InboundEmail {
  subject: string;
  body: string;
  gmail_msg_id: string;
  gmail_thread_id?: string | null;
  ts: string;
  account?: string | null;
}

/** The transaction "tipo" values from spec catalog 5.1. */
export type TransactionType =
  | "debito"
  | "credito"
  | "transferencia"
  | "servicio"
  | "retiro"
  | "recarga"
  | "sueldo"
  | "recibido";

export type Direction = "in" | "out";

/**
 * A parsed transaction candidate. `amount` is `null` only when
 * `needs_review` is true — an unparseable amount is never guessed or
 * coerced (AC6), so callers must not treat `null` as zero.
 */
export interface ParsedTransaction {
  kind: "transaction";
  type: TransactionType;
  direction: Direction;
  amount: number | null;
  currency: string;
  counterparty?: string | null;
  account?: string | null;
  /**
   * El titular de la cuenta como lo escribe el banco, cuando el correo lo
   * trae ("Cuenta débito: <NOMBRE> <cuenta enmascarada>"). Es la unica
   * evidencia del titular en todo el ledger, y de aqui la lee el onboarding
   * para proponerlo (`onboard/suggest.ts`). Va aparte de `account`: ese campo
   * es el token enmascarado con el que se aparean reverso y consumo, y mezclar
   * las dos cosas rompe ese apareo.
   */
  account_holder?: string | null;
  /**
   * Movimiento entre instrumentos del propio usuario: plata que cambia de
   * lugar sin ser gasto ni ingreso. Se excluye de todos los agregados
   * (`EXCLUDE_FROM_TOTALS_SQL`).
   *
   * Va acá, y no sólo en `rules/reconcile.ts`, porque hay tipos de correo que
   * son internos **por lo que son**, no por a quién nombran: el pago de la
   * propia tarjeta de crédito lo es siempre, y su contraparte es la tarjeta,
   * no el titular, así que la regla de `markInternalTransfers` —que compara
   * la contraparte contra el nombre del titular— no puede verlo. Cuando el
   * parser lo sabe por el tipo de correo, lo afirma; el resto lo sigue
   * resolviendo reconcile.
   */
  is_internal?: boolean;
  raw_subject: string;
  needs_review: boolean;
  review_reason?: string;
}

/** An email recognized but deliberately not turned into a transaction (spec 5.2). */
export interface IgnoredEmail {
  kind: "ignored";
  reason: string;
}

/** A statement email (e.g. "Estado de Cuenta") — parsed separately by F1-05. */
export interface StatementEmail {
  kind: "statement";
  raw_subject: string;
}

/** A reversal notification — matched against its original transaction by F1-04. */
export interface ReversoEmail {
  kind: "reverso";
  raw_subject: string;
}

export type ParseResult = ParsedTransaction | IgnoredEmail | StatementEmail | ReversoEmail;

/** One bank's implementation of the parsing contract, registered in the parser registry. */
export interface BankEmailParser {
  /** Stable identifier for the bank (used for logging/debugging), e.g. "produbanco". */
  bankId: string;
  /**
   * Gmail `from:` fragments this bank sends notifications from, e.g.
   * `["produbanco"]` or `["notificaciones@mibanco.com"]`.
   *
   * This is what makes registering a parser sufficient to add a bank: the
   * ingest query is built by OR-ing every registered parser's senders
   * together (see `ingest/pipeline.ts`'s `buildSearchQuery`). A parser that
   * declared none would parse perfectly and still never receive an email,
   * because the Gmail search would never fetch one -- so this is required,
   * not optional.
   */
  gmailSenders: readonly string[];
  /** Cheap check: does this email plausibly belong to this bank? */
  canParse(email: InboundEmail): boolean;
  /** Classify and extract. Only called when `canParse` returned true. */
  parse(email: InboundEmail): ParseResult;
}
