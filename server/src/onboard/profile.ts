/**
 * El perfil del MVP: **dos campos, no cuatro** (H2, en su versión mínima —
 * `docs/plan-final-mvp.md` §3, fase N4).
 *
 * Por qué exactamente estos dos y ninguno más:
 *
 * - **`diasPago`.** Sin él `nextPayday` devuelve `null`, y sin próximo cobro
 *   `safeToSpendHoy` devuelve `0` como guardia contra dividir por cero — no
 *   como afirmación (R7). El Resumen entero queda diciendo "todavía no sé".
 * - **`colchonObjetivo`.** Sin él el anillo miente: `colchonStatus` calcula
 *   `financiado = reservado >= objetivo`, y `0 >= 0` es verdadero, así que un
 *   usuario recién llegado se ve *financiado* sin haber reservado un peso
 *   (**R25**). Ver `colchonFijado` más abajo.
 *
 * Los otros dos campos que `p1-alta-perfil.html` dibuja **no se editan desde la
 * UI en el MVP**, y no es un recorte por tiempo: `titular` lo propone el motor
 * leyéndolo del banco (`suggestTitular`, y un titular escrito a mano que no
 * matchea deja las transferencias propias contadas como gasto), y el monto del
 * sueldo viene con los días desde `suggestSalary`. Un campo de texto libre
 * sobre cualquiera de los dos es una forma de romper el motor sin enterarse.
 *
 * Escritura y lectura viven acá y no en la ruta HTTP por la razón de siempre:
 * son reglas sobre la plata (qué es un día de pago válido, qué significa un
 * objetivo en cero) y tienen que tener un solo dueño, con sus tests.
 */
import type Database from "better-sqlite3";
import { getStrategyConfig, setStrategyConfig } from "../db/strategy-config.js";
import { parseDiasPago } from "../strategy/calendar.js";

/** Los dos campos del perfil, en el orden en que la pantalla los pregunta.
 * `diasPago` vive DENTRO de la clave `sueldo` de `strategy_config`; escribirlo
 * toca esa fila entera, preservando el resto del sueldo. */
export const CLAVES_DEL_PERFIL = ["diasPago", "colchonObjetivo"] as const;

export interface OnboardingProfile {
  /** Ventanas de día de pago, en el formato que `parseDiasPago` consume. */
  diasPago: string[];
  /** Lista vacía = nunca se configuró. Sin esto no hay safe-to-spend (R7). */
  diaDePagoFijado: boolean;
  colchonObjetivo: number;
  /**
   * **R25.** `colchonObjetivo` en cero NO es un objetivo cumplido: es un
   * objetivo que nadie fijó. La respuesta de "no fijé objetivo" es idéntica
   * campo por campo a la de "cumplí mi objetivo" —las dos dicen
   * `financiado: true, faltante: 0`— y lo único que las distingue es este
   * booleano. Se decide acá, una vez, y no en cada pantalla que dibuje el
   * anillo.
   */
  colchonFijado: boolean;
}

export interface ProfilePatch {
  /** Días u ventanas tal como los escribió el usuario; se normalizan. */
  diasPago?: readonly string[];
  colchonObjetivo?: number;
}

export type ProfileError = "sin_campos" | "dias_pago_invalidos" | "colchon_invalido";

export type ProfileResult =
  | { ok: true; profile: OnboardingProfile; campos: string[] }
  | { ok: false; error: ProfileError };

/**
 * Lleva lo que el usuario escribió al formato que el calendario consume, o
 * devuelve `null` si algo no se entiende.
 *
 * Existe por una trampa concreta: **`parseDiasPago` descarta en silencio lo que
 * no parsea**. Un `"15"` escrito a mano —lo más natural que alguien puede
 * escribir en un campo que dice "día de pago"— se guarda bien, se lee bien, y
 * deja el calendario mudo para siempre sin un solo error en ninguna parte. Por
 * eso acá un día suelto se acepta y se convierte en su ventana (`"15"` →
 * `"15-15"`), y **cualquier cosa que el calendario no leería es un rechazo
 * explícito**, no una entrada que se cae sola.
 *
 * Los días fuera de 1..31 también se rechazan: `parseDiasPago` aceptaría un
 * `"32-32"` como ventana válida, y una ventana que ningún mes contiene es otra
 * forma de dejar el calendario mudo.
 *
 * La lista vacía es un rechazo: este es el camino por el que se *configura* el
 * día de pago, y borrarlo no es configurarlo.
 */
export function normalizarDiasPago(entradas: readonly string[]): string[] | null {
  if (entradas.length === 0) return null;

  const ventanas = new Set<string>();
  for (const entrada of entradas) {
    const texto = entrada.trim();

    const suelto = /^(\d{1,2})$/.exec(texto);
    const rango = /^(\d{1,2})-(\d{1,2})$/.exec(texto);
    const hasta = /^<=(\d{1,2})$/.exec(texto);

    if (suelto) {
      const dia = Number(suelto[1]);
      if (dia < 1 || dia > 31) return null;
      ventanas.add(`${dia}-${dia}`);
      continue;
    }
    if (rango) {
      const desde = Number(rango[1]);
      const hastaDia = Number(rango[2]);
      if (desde < 1 || hastaDia > 31 || desde > hastaDia) return null;
      ventanas.add(`${desde}-${hastaDia}`);
      continue;
    }
    if (hasta) {
      const dia = Number(hasta[1]);
      if (dia < 1 || dia > 31) return null;
      ventanas.add(`<=${dia}`);
      continue;
    }
    return null;
  }

  // Ordenadas por el primer día de la ventana, para que el perfil se lea igual
  // sin importar en qué orden se escribieron.
  return [...ventanas].sort((a, b) => primerDia(a) - primerDia(b));
}

function primerDia(ventana: string): number {
  const parsed = parseDiasPago([ventana])[0];
  return parsed ? parsed.minDay : 0;
}

/** El perfil tal como está hoy. Nunca inventa: lo que no se configuró se
 * reporta como no configurado, no como cero. */
export function readProfile(db: Database.Database): OnboardingProfile {
  const config = getStrategyConfig(db);
  const diasPago = config.sueldo.diasPago;

  return {
    diasPago,
    diaDePagoFijado: diasPago.length > 0,
    colchonObjetivo: config.colchonObjetivo,
    colchonFijado: config.colchonObjetivo > 0,
  };
}

/**
 * Escribe los campos presentes en el patch y **sólo** esos. Parcial a
 * propósito: el usuario puede fijar el colchón hoy y el día de pago cuando el
 * primer sueldo aparezca en el ledger, y ninguno de los dos actos puede pisar
 * al otro.
 *
 * Todo el patch se valida antes de escribir nada: media escritura dejaría
 * guardado un valor que el usuario confirmó junto a otro que se rechazó.
 */
export function writeProfile(db: Database.Database, patch: ProfilePatch): ProfileResult {
  const campos: string[] = [];
  const escritura: Parameters<typeof setStrategyConfig>[1] = {};

  if (patch.diasPago !== undefined) {
    const diasPago = normalizarDiasPago(patch.diasPago);
    if (diasPago === null) return { ok: false, error: "dias_pago_invalidos" };
    // El resto del sueldo —fuente, cadencia, monto— lo leyó el motor del
    // historial y esta pantalla no lo edita: se relee y se reescribe igual.
    escritura.sueldo = { ...getStrategyConfig(db).sueldo, diasPago };
    campos.push("diasPago");
  }

  if (patch.colchonObjetivo !== undefined) {
    const objetivo = patch.colchonObjetivo;
    if (!Number.isFinite(objetivo) || objetivo < 0) return { ok: false, error: "colchon_invalido" };
    escritura.colchonObjetivo = objetivo;
    campos.push("colchonObjetivo");
  }

  if (campos.length === 0) return { ok: false, error: "sin_campos" };

  setStrategyConfig(db, escritura);
  return { ok: true, profile: readProfile(db), campos };
}
