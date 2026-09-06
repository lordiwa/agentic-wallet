/**
 * Los sobres sobre SQLite: leer la tabla `savings` y escribirla.
 *
 * La decisión de fondo está en `strategy/sobres.ts` y no acá — el colchón ya
 * era un sobre y sigue siendo la misma fila (`label = 'colchon'`), no una
 * nueva. Este archivo sólo traduce entre esa tabla y la forma que el motor
 * entiende, y como todo `db/`, **no calcula plata**: convierte a centavos en la
 * entrada y a unidades en la salida, que es la misma frontera que usa el resto
 * del motor.
 *
 * ## El id de una fila vieja
 *
 * `savings` nació con una clave entera y un `label`. La columna `sobre_id` es
 * posterior (ver `schema.ts`), así que la fila del colchón de cualquier base
 * existente la tiene en NULL. En vez de un backfill —que habría que recordar
 * correr en cada base— el id se deriva del `label` cuando falta: para la única
 * fila que puede estar en esa situación, `label = 'colchon'`, eso da
 * exactamente `colchon`, que es el id que el motor espera.
 */
import type Database from "better-sqlite3";
import { fromCents, toCents } from "../strategy/money.js";
import { idDeSobre, type SobreDoc } from "../strategy/sobres.js";

interface SavingsRow {
  id: number;
  sobre_id: string | null;
  label: string | null;
  target: number | null;
  reserved: number | null;
  created_at: string | null;
  updated_at: string | null;
}

function aDoc(row: SavingsRow): SobreDoc {
  return {
    id: row.sobre_id ?? idDeSobre(row.label ?? ""),
    label: row.label,
    reservedCents: toCents(row.reserved ?? 0),
    targetCents: row.target === null ? null : toCents(row.target),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Todos los sobres guardados. Una fila sin id derivable —`label` vacío y
 * `sobre_id` NULL— se descarta: no hay forma de nombrarla ni de ajustarla. */
export function listSobreRows(db: Database.Database): SobreDoc[] {
  const rows = db.prepare("SELECT * FROM savings ORDER BY id").all() as SavingsRow[];
  return rows.map(aDoc).filter((doc) => doc.id !== "");
}

export interface SobreNuevo {
  id: string;
  nombre: string;
  montoCents: number;
  objetivoCents: number | null;
}

/**
 * Inserta un sobre. Sin `INSERT OR IGNORE`: el índice único de `sobre_id`
 * tiene que **fallar** si dos peticiones simultáneas crean el mismo sobre, para
 * que la segunda conteste un conflicto en vez de perderse en silencio.
 */
export function insertSobre(db: Database.Database, plan: SobreNuevo, now: string): void {
  db.prepare(
    `INSERT INTO savings (sobre_id, label, target, reserved, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    plan.id,
    plan.nombre,
    plan.objetivoCents === null ? null : fromCents(plan.objetivoCents),
    fromCents(plan.montoCents),
    now,
    now
  );
}

/** Escribe los campos que el ajuste tocó y ninguno más. El objetivo del colchón
 * NO pasa por acá: vive en `strategy_config.colchonObjetivo`. */
export function updateSobre(
  db: Database.Database,
  id: string,
  campos: { nombre?: string; montoCents?: number; objetivoCents?: number | null },
  now: string
): void {
  const sets: string[] = ["updated_at = ?"];
  const valores: unknown[] = [now];
  if (campos.nombre !== undefined) {
    sets.push("label = ?");
    valores.push(campos.nombre);
  }
  if (campos.montoCents !== undefined) {
    sets.push("reserved = ?");
    valores.push(fromCents(campos.montoCents));
  }
  if (campos.objetivoCents !== undefined) {
    sets.push("target = ?");
    valores.push(campos.objetivoCents === null ? null : fromCents(campos.objetivoCents));
  }
  // La fila del colchón se busca por `label` porque puede no tener `sobre_id`
  // (ver el doc de arriba); las demás siempre lo tienen.
  db.prepare(`UPDATE savings SET ${sets.join(", ")} WHERE sobre_id = ? OR (sobre_id IS NULL AND label = ?)`).run(
    ...valores,
    id,
    id
  );
}
