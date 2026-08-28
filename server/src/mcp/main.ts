/**
 * Entrypoint del MCP server — lo unico que esbuild bundlea.
 *
 * Vive separado de `server.ts` a proposito: ese modulo se importa desde los
 * tests y no debe arrancar nada al cargarse. El truco habitual
 * (`require.main === module`) no sobrevive limpio al pasar de ESM a CJS, y un
 * archivo de dos lineas es mas facil de razonar que un guard condicional.
 */
import { main } from "./server.js";

main().catch((error: unknown) => {
  // stderr: stdout lo ocupa JSON-RPC.
  console.error(error);
  process.exit(1);
});
