/**
 * Hooks para correr los scripts de `scripts/` directamente, sin compilar antes.
 *
 * Resuelve dos cosas que hacían que `npm run migrate:tenant` muriera antes de
 * llegar a abrir el SQLite:
 *
 * 1. **La extensión.** La convención ESM del repo es que los imports relativos
 *    lleven `.js` aunque el archivo sea `.ts` (ver CLAUDE.md). Vitest resuelve
 *    ese `.js` al `.ts` de al lado por su cuenta — por eso los tests siempre
 *    anduvieron — pero el resolver de Node no, y tiraba ERR_MODULE_NOT_FOUND.
 *    No se arregla cambiando los imports a `.ts` porque esos mismos archivos
 *    los compila `tsc` para el deploy, donde `.js` es la extensión correcta.
 *
 * 2. **La sintaxis.** `--experimental-strip-types` sólo borra tipos, y se
 *    planta ante una parameter property (`constructor(private readonly db)`,
 *    `firestore-ledger.ts:84`) porque eso no es un tipo: emite código. Se
 *    transpila con el `typescript` que ya es devDependency en vez de reescribir
 *    `src/` para acomodar al runner.
 */
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resuelto = resolverSiExiste(specifier, context, nextResolve);
    if (resuelto !== null) return resuelto;

    // Sólo se reintenta lo que la convención puede haber tapado: un relativo
    // `.js` que en disco es `.ts`. Cualquier otro fallo se deja pasar tal cual.
    if (!specifier.startsWith(".") || !specifier.endsWith(".js")) {
      return nextResolve(specifier, context);
    }
    return { ...nextResolve(`${specifier.slice(0, -3)}.ts`, context), format: "module" };
  },

  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".ts")) return nextLoad(url, context);
    const ruta = fileURLToPath(url);
    const salida = ts.transpileModule(readFileSync(ruta, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: ruta,
    });
    return { format: "module", source: salida.outputText, shortCircuit: true };
  },
});

function resolverSiExiste(specifier, context, nextResolve) {
  try {
    const resuelto = nextResolve(specifier, context);
    // `nextResolve` de un relativo no verifica que el archivo exista: devuelve
    // la URL igual. El chequeo tiene que ser contra el disco.
    if (resuelto.url.startsWith("file:") && !existsSync(fileURLToPath(resuelto.url))) return null;
    return resuelto;
  } catch {
    return null;
  }
}
