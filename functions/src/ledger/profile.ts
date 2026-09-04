/**
 * El perfil del MVP: **dos campos** — copia de la parte pura de
 * `server/src/onboard/profile.ts`.
 *
 * Por qué exactamente estos dos: sin `diasPago` no hay próximo cobro, y sin
 * próximo cobro `safeToSpendHoy` devuelve 0 como guarda y no como afirmación
 * (R7); sin `colchonObjetivo` el anillo miente, porque `0 >= 0` es verdadero y
 * un usuario recién llegado se ve *financiado* sin haber reservado un peso
 * (R25). Los otros dos campos que la pantalla dibuja los propone el motor
 * leyendo el banco y no se editan a mano a propósito.
 */
import { parseDiasPago } from "./calendar.js";

export interface OnboardingProfile {
  diasPago: string[];
  /** **Fijado es "el calendario puede leer una ventana", no "hay algo
   * escrito"** (W30): un `"15"` guardado por un `--set` viejo se lee bien y
   * deja el calendario mudo igual. */
  diaDePagoFijado: boolean;
  colchonObjetivo: number;
  /** **R25.** Un objetivo en cero no es un objetivo cumplido: es uno que nadie
   * fijó, y sin este booleano las dos respuestas son idénticas campo por
   * campo. */
  colchonFijado: boolean;
}

export interface ProfilePatch {
  diasPago?: readonly string[];
  colchonObjetivo?: number;
}

export type ProfileError = "sin_campos" | "dias_pago_invalidos" | "colchon_invalido";

/**
 * Lleva lo que el usuario escribió al formato que el calendario consume, o
 * `null` si algo no se entiende.
 *
 * Existe por una trampa concreta: `parseDiasPago` **descarta en silencio** lo
 * que no parsea. Un `"15"` —lo más natural que alguien escribe en un campo que
 * dice "día de pago"— se guarda bien, se lee bien, y deja el calendario mudo
 * para siempre sin un solo error. Acá un día suelto se acepta y se convierte en
 * su ventana (`"15"` → `"15-15"`), y cualquier cosa que el calendario no leería
 * es un rechazo explícito. La lista vacía también: este es el camino por el que
 * se *configura* el día de pago, y borrarlo no es configurarlo.
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

/** El perfil derivado de la config del tenant. Nunca inventa: lo que no se
 * configuró se reporta como no configurado, no como cero. */
export function readProfile(config: { colchonObjetivo: number; sueldo: { diasPago: string[] } }): OnboardingProfile {
  const diasPago = config.sueldo.diasPago;
  return {
    diasPago,
    diaDePagoFijado: parseDiasPago(diasPago).length > 0,
    colchonObjetivo: config.colchonObjetivo,
    colchonFijado: config.colchonObjetivo > 0,
  };
}

export interface ProfileWrite {
  /** Los `diasPago` ya normalizados, si el patch los traía. */
  diasPago?: string[];
  colchonObjetivo?: number;
  campos: string[];
}

/**
 * Valida el patch ENTERO antes de decir qué escribir: media escritura dejaría
 * guardado un valor que el usuario confirmó junto a otro que se rechazó.
 *
 * Devuelve qué escribir, no lo escribe: la escritura es de Firestore y vive en
 * `firestore-ledger.ts`.
 */
export function planWriteProfile(patch: ProfilePatch): { ok: true; write: ProfileWrite } | { ok: false; error: ProfileError } {
  const write: ProfileWrite = { campos: [] };

  if (patch.diasPago !== undefined) {
    const diasPago = normalizarDiasPago(patch.diasPago);
    if (diasPago === null) return { ok: false, error: "dias_pago_invalidos" };
    write.diasPago = diasPago;
    write.campos.push("diasPago");
  }

  if (patch.colchonObjetivo !== undefined) {
    const objetivo = patch.colchonObjetivo;
    if (!Number.isFinite(objetivo) || objetivo < 0) return { ok: false, error: "colchon_invalido" };
    write.colchonObjetivo = objetivo;
    write.campos.push("colchonObjetivo");
  }

  if (write.campos.length === 0) return { ok: false, error: "sin_campos" };
  return { ok: true, write };
}
