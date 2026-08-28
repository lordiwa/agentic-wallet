/**
 * Bundlea el MCP server a un unico CJS committeado: `server/dist-mcp/mcp-server.cjs`.
 *
 * El punto es que `.mcp.json` pueda decir `node <bundle>` y listo — sin tsx,
 * sin `tsc` previo, sin depender de que el usuario haya corrido `npm run
 * build`. El bundle es un artefacto versionado: quien clona el repo tiene el
 * MCP server funcionando apenas instale dependencias.
 *
 * `dist-mcp/` y no `dist/` porque `.gitignore` excluye `dist/` (la salida de
 * `tsc`, que sigue siendo generada); el nombre distinto es lo que permite
 * commitear este bundle sin abrirle la puerta a la otra.
 *
 * EXTERNALS — aqui esta la diferencia con un MCP server puro. `better-sqlite3`
 * es un addon nativo (.node): esbuild no puede inlinearlo, y forzarlo solo
 * produce un bundle que revienta al arrancar. `googleapis` y el Claude Agent
 * SDK quedan fuera por peso y porque cargan cosas en runtime. Consecuencia
 * honesta: este bundle SI necesita el `node_modules` del repo. No es el caso
 * de un plugin que se instala por git-url sin `npm install` — aqui el server
 * corre desde el checkout del propio usuario, que ya tiene sus dependencias.
 * Lo que el bundle elimina es la cadena de TypeScript, no el node_modules.
 *
 * Lo que si se inlinea: `@modelcontextprotocol/sdk` y `zod`, que son JS puro.
 */
import { build } from "esbuild";
import path from "node:path";

const serverRoot = path.resolve(import.meta.dirname, "..");

const result = await build({
  entryPoints: [path.join(serverRoot, "src/mcp/main.ts")],
  outfile: path.join(serverRoot, "dist-mcp/mcp-server.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["better-sqlite3", "googleapis", "@anthropic-ai/claude-agent-sdk", "@napi-rs/keyring"],
  logLevel: "info",
});

/**
 * `import.meta` queda vacio en CJS, asi que cualquier modulo del bundle que
 * resuelva rutas por su ubicacion en disco se rompe en runtime — adentro del
 * cliente MCP, donde el error se ve como "el server no arranca" y nada mas.
 * Mejor fallar aca.
 *
 * La unica excepcion es `config.ts`, cuyo `repoRoot()` esta escrito
 * justamente para tolerar el undefined y caer a la raiz que pasa
 * `.mcp.json`. Es una lista explicita y no un patron: si aparece un uso
 * nuevo, el build tiene que doler.
 */
const IMPORT_META_ALLOWED = ["src/config.ts"];

const offenders = result.warnings
  .filter((w) => w.id === "empty-import-meta")
  .filter((w) => !IMPORT_META_ALLOWED.some((allowed) => w.location?.file.endsWith(allowed)));

if (offenders.length > 0) {
  for (const warning of offenders) {
    console.error(`  ${warning.location?.file}:${warning.location?.line} — ${warning.text}`);
  }
  throw new Error(
    `build-mcp: ${offenders.length} uso(s) de import.meta sin proteger en el grafo del bundle. ` +
      "Resolve la ruta con config.repoRoot() en vez de import.meta.dirname."
  );
}
