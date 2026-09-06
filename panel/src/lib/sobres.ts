/**
 * Cómo se dibuja un sobre, y cómo se dice lo que el motor rechazó.
 *
 * Puro y sin dependencias, igual que `lib/colchon.ts` —del que esto es el
 * hermano—: recibe lo que el motor calculó y decide la forma. No suma, no
 * promedia, no deriva plata. La única aritmética es el porcentaje de la barra,
 * que es un dibujo y no una cifra: no se muestra como monto en ningún lado.
 *
 * La regla que gobierna las dos funciones de arriba es la misma que en el
 * colchón (**R25**): un objetivo **sin fijar** no es un objetivo en cero. Sin
 * meta no hay porcentaje que valga, así que no se dibuja una barra llena ni una
 * vacía —se dice que no hay contra qué medir—. La diferencia con `colchon.ts`
 * es de dónde sale el dato: allá había que deducirlo de `objetivo > 0`, acá el
 * motor ya manda `objetivo: null`.
 */
import type { Sobre } from "../api/types";

export interface VistaSobre {
  id: string;
  nombre: string;
  monto: number;
  /** Hay una meta contra la que medir. Con `false` no hay porcentaje que valga. */
  fijado: boolean;
  objetivo: number;
  /** Lo que falta para la meta. Sólo tiene sentido con `fijado`. */
  faltante: number;
  /** 0..100. Sin meta es 0: no hay contra qué medir. */
  ancho: number;
  /** La clase de la barra del sistema (§2.1). */
  fill: "ok" | "neu";
  /** El colchón: se ajusta como cualquiera, pero no se renombra. */
  sistema: boolean;
}

export const SIN_META = "Sin meta";

export function vistaSobre(sobre: Sobre): VistaSobre {
  const objetivo = sobre.objetivo ?? 0;
  const fijado = objetivo > 0;
  const completo = fijado && sobre.monto >= objetivo;
  return {
    id: sobre.id,
    nombre: sobre.nombre,
    monto: sobre.monto,
    fijado,
    objetivo,
    faltante: fijado ? Math.max(0, objetivo - sobre.monto) : 0,
    ancho: fijado ? Math.min(100, Math.max(0, Math.round((sobre.monto / objetivo) * 100))) : 0,
    fill: completo ? "ok" : "neu",
    sistema: sobre.sistema,
  };
}

export function vistaSobres(sobres: readonly Sobre[]): VistaSobre[] {
  return sobres.map(vistaSobre);
}

/**
 * Los rechazos del motor, en castellano.
 *
 * Están acá y no en la vista porque son **contrato**: cada uno es un `error`
 * que `strategy/sobres.ts` devuelve por su nombre, y este mapa es lo que los
 * vuelve una frase. Un código que este mapa no conozca se muestra tal cual
 * antes que como un "algo salió mal" que no dice qué arreglar — que es
 * exactamente lo que hace la tarjeta de revisión con el motivo del server.
 */
const MENSAJES: Record<string, string> = {
  nombre_vacio: "Escribí un nombre para el sobre.",
  nombre_largo: "El nombre es demasiado largo.",
  nombre_sin_letras: "El nombre necesita al menos una letra o un número.",
  sobre_reservado: "El sobre de emergencia ya existe: es el colchón.",
  sobre_duplicado: "Ya tenés un sobre con ese nombre.",
  demasiados_sobres: "Llegaste al máximo de sobres.",
  monto_negativo: "No podés sacar más de lo que hay en el sobre.",
  sobre_no_existe: "Ese sobre ya no está.",
  sobre_del_sistema: "El colchón no se renombra: su nombre lo usa el motor.",
  monto_y_aporte: "Elegí una de las dos: fijar el monto o registrar un aporte.",
  sin_cambios: "No cambiaste nada.",
};

export function mensajeDeError(codigo: string): string {
  return MENSAJES[codigo] ?? codigo;
}
