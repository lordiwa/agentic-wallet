# El wallet como servidor MCP

El motor del wallet se expone por [Model Context
Protocol](https://modelcontextprotocol.io) para que cualquier agente que hable
MCP —Claude Code, Claude Desktop, el que sea— pueda consultar el ledger y
operar el onboarding como herramientas nativas, sin pasar por el server HTTP ni
por la web.

Es la misma máquina, la misma SQLite y las mismas funciones que usa el
dashboard. No hay una segunda base ni una segunda copia de la aritmética: cada
tool es un envoltorio delgado sobre una función del motor que ya existe y ya
tiene tests. Si un número no cuadra, el bug está en `strategy/` o en
`api/queries.ts`, nunca en la capa MCP.

## Herramientas

| Tool | Qué hace | Envuelve |
|---|---|---|
| `get_balance` | Saldo actual, disponible de hoy, próximo pago | `strategy/balance.ts`, `strategy/calendar.ts` |
| `get_colchon_status` | Objetivo, reservado, faltante del colchón | `strategy/balance.ts` |
| `get_overview` | El tablero completo de una llamada | `api/routes.ts` (`buildOverview`) |
| `query_transactions` | Movimientos con filtros de fecha/tipo/contraparte | `api/queries.ts` (`queryTransactions`) |
| `get_review_queue` | Filas en `needs_review` | `api/queries.ts` |
| `get_spending_by_category` | Gasto por categoría en un período | `strategy/spending.ts` |
| `sync` | Lee los correos nuevos de Gmail e incorpora al ledger | `sync/` (`buildProductionSyncRunner`) |
| `onboarding_status` | En qué punto de la configuración está el usuario | `onboard/status.ts` |
| `suggest_profile` | Propone perfil leyendo el ledger real | `onboard/suggest.ts` |
| `set_profile` | Guarda los campos de `strategy_config` confirmados | `db/strategy-config.ts` |
| `set_rule` | Asocia un comercio a una categoría | `category/rules-repository.ts` |
| `apply_rules` | Aplica las reglas al historial ya sincronizado | `category/backfill.ts` (`backfillCategories`) |

Todas devuelven JSON. Las de lectura excluyen por defecto reversos,
transferencias internas y filas en `needs_review` — que es lo correcto para
cualquier total.

### El ciclo de configuración

`suggest_profile` **no escribe nada**: lee el ledger y propone. El agente le
muestra la propuesta al humano, el humano corrige, y recién ahí `set_profile`
guarda. Es la misma propiedad que tiene `npm run onboard` y por la misma razón:
nunca se escribe un valor que el usuario no confirmó. Si no hay evidencia en el
ledger, la sugerencia viene en `null` en vez de una cifra inventada.

`set_rule` sólo afecta lo que entre de ahí en adelante; el historial ya
sincronizado se recategoriza con `apply_rules` (el equivalente MCP de
`npm run onboard -- --backfill`). Es idempotente y nunca repisa una categoría ya
asignada, así que se puede llamar después de cada regla sin miedo.

Ojo con `sueldo.diasPago`: el motor lee **ventanas**, no días sueltos.
`["15-15", "30-30"]` es "el 15 y el 30", `["18-20"]` es "entre el 18 y el 20",
`["<=5"]` es "los primeros 5 días". Un `"15"` pelado no parsea y deja el
calendario de pagos en null.

## Registro

`.mcp.json` en la raíz del repo apunta al bundle:

```json
{
  "mcpServers": {
    "agentic-wallet": {
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR}/server/dist-mcp/mcp-server.cjs"],
      "env": {
        "CLAUDE_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}"
      }
    }
  }
}
```

`CLAUDE_PROJECT_DIR` no es decorativo: el cliente MCP lanza el proceso con un
cwd arbitrario (el del agente, no el del repo), así que sin esa variable el
server no sabría dónde están el `.env` ni la SQLite, y un `WALLET_DB_PATH`
relativo terminaría creando una base vacía en cualquier carpeta. La resolución
vive en `config.repoRoot()`.

## El bundle

`server/dist-mcp/mcp-server.cjs` es un artefacto **versionado**, generado con
esbuild por `server/scripts/build-mcp.mjs` y regenerado en cada `npm run build`.
Se commitea para que el MCP server arranque con `node <bundle>` apenas se clona
el repo: sin `tsx`, sin `tsc` previo, sin toolchain de TypeScript en runtime.

Va en `dist-mcp/` y no en `dist/` porque `.gitignore` excluye `dist/` (la salida
de `tsc`, que sí es descartable). El nombre distinto es lo que permite
commitear este bundle sin abrirle la puerta a la otra.

**Lo que el bundle NO elimina es el `node_modules`.** `better-sqlite3` es un
addon nativo: esbuild no puede inlinearlo, y `googleapis` y el Claude Agent SDK
quedan afuera por peso. Los tres son `external`. Esto está bien acá —el server
corre desde el checkout del propio usuario, que ya hizo `npm install`— pero es
la diferencia con un plugin que se instala por git-url sin instalar nada.

El build falla a propósito si aparece un `import.meta` sin proteger en el grafo
del bundle: en CJS queda vacío, y un módulo que resuelva rutas por su ubicación
en disco se rompería recién en runtime, adentro del cliente MCP, donde el error
se ve como "el server no arranca" y nada más.

## Tests

`server/src/mcp/server.test.ts` levanta el server contra una base temporal con
el transporte in-memory del SDK —cliente y server en el mismo proceso, sin
stdio ni subprocesos— y hace el round-trip de cada tool.

Lo que cubre es la **capa MCP**: que las tools estén registradas, que los
argumentos lleguen al motor bien traducidos y que el resultado salga como JSON
parseable. La aritmética financiera ya la cubren los tests de `strategy/`,
`api/` y `onboard/`; repetirla ahí sólo duplicaría el oráculo.

```bash
npm test                    # toda la suite, incluye el round-trip MCP
npm run build:mcp           # regenera el bundle
npm run mcp --workspace=server   # arranca el server a mano (espera stdin)
```

## Seguridad

Las mismas reglas que el resto del wallet, más una que es propia de esta capa:

- **`stdout` es el canal JSON-RPC.** Cualquier `console.log` corrompe el
  protocolo. Los spans de telemetría se silencian con `WALLET_TELEMETRY_SILENT`
  en el arranque; los logs van a `stderr`.
- **`sync` es la única tool que sale a la red** y la única que puede tardar. Sin
  credenciales responde `gmail_not_configured` sin tocar nada, y hay un guard
  en memoria para que dos corridas no se solapen.
- El server lee el `.env` del repo. No lo imprime, no lo expone por ninguna
  tool, y `onboarding_status` sólo reporta si cada credencial **está o no
  está** — nunca su valor.
