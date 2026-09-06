/**
 * `sobres.ts` vive dos veces —acá y en `server/src/strategy/sobres.ts`— y este
 * test exige que sean **idénticas byte a byte**, igual que el parser copiado
 * (`parser/parity.test.ts`).
 *
 * Por qué una copia y no un import: `firebase deploy` sube la carpeta
 * `functions/` sola, así que nada de `server/` existe en el runtime desplegado.
 *
 * Por qué byte a byte y no una matriz de casos: el módulo **no importa nada**
 * —está escrito así a propósito, ver su doc— y por eso la copia puede ser
 * literal, sin un solo retoque de rutas. Cuando dos archivos pueden ser
 * idénticos, exigir que lo sean es la comparación más fuerte que hay: no queda
 * lugar para una divergencia silenciosa entre lo que el panel local calcula y
 * lo que calcula la nube.
 *
 * Los tests de comportamiento están del lado del motor
 * (`server/src/strategy/sobres.test.ts`) y no se duplican: correrlos dos veces
 * sobre el mismo texto no prueba nada que esta igualdad no pruebe ya.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const aqui = dirname(fileURLToPath(import.meta.url));

describe("el motor de sobres copiado no puede divergir del motor", () => {
  it("sobres.ts es identico al de server/src/strategy", () => {
    const motor = join(aqui, "..", "..", "..", "server", "src", "strategy", "sobres.ts");
    expect(readFileSync(join(aqui, "sobres.ts"), "utf8")).toBe(readFileSync(motor, "utf8"));
  });
});
