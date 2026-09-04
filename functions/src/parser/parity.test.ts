/**
 * El parser que vive en `functions/` es una COPIA del motor, y este test exige
 * que sea una copia **byte a byte**.
 *
 * Por qué una copia y no un import: `firebase deploy` sube la carpeta
 * `functions/` sola, así que nada de `server/` existe en el runtime desplegado.
 * Es la misma restricción que ya obligó a copiar `categorize`
 * (`ledger/categorize.parity.test.ts`).
 *
 * Por qué byte a byte y no una matriz de casos: el parser de Produbanco son
 * ~1300 líneas de gramática afinada contra correos reales, y una matriz de
 * ejemplos sólo cubre lo que a alguien se le ocurrió poner. La igualdad exacta
 * no deja lugar a una divergencia silenciosa — y como estos archivos no
 * importan NADA fuera de `parser/`, la copia puede ser literal sin retoques.
 * Si alguien toca una de las dos, esto se pone rojo. Ese es todo el punto.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const aqui = dirname(fileURLToPath(import.meta.url));
const motor = join(aqui, "..", "..", "..", "server", "src", "parser");

/** Los archivos del parser, sin los tests: el motor los corre por su cuenta. */
const ARCHIVOS = ["types.ts", "html-text.ts", "field-extract.ts", "produbanco.ts", "registry.ts", "index.ts"];

describe("el parser copiado no puede divergir del motor", () => {
  for (const archivo of ARCHIVOS) {
    it(`${archivo} es identico al de server/src/parser`, () => {
      expect(readFileSync(join(aqui, archivo), "utf8")).toBe(readFileSync(join(motor, archivo), "utf8"));
    });
  }

  it("mojibake.ts tambien, que es de la decodificacion y no de la gramatica", () => {
    const copia = join(aqui, "..", "ingest", "mojibake.ts");
    const original = join(aqui, "..", "..", "..", "server", "src", "ingest", "mojibake.ts");
    expect(readFileSync(copia, "utf8")).toBe(readFileSync(original, "utf8"));
  });
});
