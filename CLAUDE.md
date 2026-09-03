# Agentic Wallet — guía para agentes

Copiloto financiero local-first: lee correos de notificación bancaria desde
Gmail, arma un ledger en SQLite local, y responde preguntas sobre él.

## Reglas que no se negocian

1. **El monto sale del parser determinista, nunca de Claude.** Claude es una
   verificación cruzada: si su lectura no coincide con la del parser, la fila
   va a `needs_review` y queda excluida de todos los totales. Si vas a tocar
   `ingest/` o `parser/`, esta es la invariante que protegen los tests.
2. **Nada de datos personales en el repo.** Ni en código, ni en tests, ni en
   docs. Los fixtures usan nombres ficticios. `.env` y `*.sqlite` están en
   `.gitignore` y ahí se quedan.
3. **Nada precargado que sea específico de una persona o un país.** No hay
   lista de comercios, no hay sueldo de ejemplo, no hay titular. Todo eso lo
   configura el usuario vía `npm run onboard`. Si agregás una función que
   necesita un valor así, el default correcto es vacío/cero, no un ejemplo
   plausible.
4. **`amount: 0` nunca significa "no pude leerlo".** Cero es un monto válido.
   Lo desconocido es `amount: null` + `needs_review: true`.

## Dónde está cada cosa

| Necesitás tocar | Andá a |
|---|---|
| Soportar otro banco | `server/src/parser/` — ver `docs/multibanco.md` |
| Cómo se leen y persisten los correos | `server/src/ingest/pipeline.ts` |
| Reversos, duplicados, transferencias internas | `server/src/rules/reconcile.ts` |
| Categorías de gasto | `server/src/category/` |
| Saldo, sueldo, deudas, colchón, calendario | `server/src/strategy/` |
| Qué significa "hoy" / "este mes" | `server/src/strategy/dates.ts` |
| El chat sobre el historial | `server/src/chat/` |
| Configuración guiada | `server/src/onboard/` — ver `docs/onboarding.md` |
| Las tools MCP | `server/src/mcp/` — ver `docs/mcp.md` |
| Esquema de la base | `server/src/db/schema.ts` |
| Rutas HTTP | `server/src/api/` |
| La llave del server (`WALLET_ACCESS_TOKEN`) | `server/src/api/auth.ts` |
| Panel (Vue 3, el frontend del MVP) | `panel/src/` — ver `docs/plan-final-mvp.md` |
| Tokens del design system | `panel/src/styles/tokens.css` — el único lugar con un hex |
| Dashboard viejo (React) | `web/src/` |

## Comandos

```bash
npm install          # Node 22+
npm run build        # web + server (tsc, sin emit en web)
npm test             # toda la suite (vitest)
npm run dev          # server + web + panel
npm run dev:panel    # server + panel (el frontend del MVP, sin el viejo)
npm run onboard      # checklist de configuración
npm run build:mcp    # regenera el bundle MCP (ya incluido en `npm run build`)
```

Antes de dar por terminado cualquier cambio: **`npm run build` y `npm test` en
verde**. No hay excepción.

## Convenciones

- **TypeScript ESM.** Los imports relativos llevan extensión `.js` (aunque el
  archivo sea `.ts`) — es requisito de ESM en Node.
- **Tests junto al código:** `foo.ts` → `foo.test.ts`. Vitest sólo corre
  `server/src/**/*.test.ts`, `server/scripts/**/*.test.ts`,
  `web/src/**/*.test.{ts,tsx}` y `panel/src/**/*.test.ts`. En `web/` y
  `panel/` el entorno se pide por archivo con
  `/** @vitest-environment jsdom */`; el default global es `node`.
- **En `panel/` y `web/` los imports relativos NO llevan extensión** — los
  resuelve Vite, no Node. La regla del `.js` es de `server/`.
- **El panel es Vue 3 y sólo Vue 3.** `web/` es React y es el dashboard viejo:
  no se mezclan, y el panel no se escribe en React.
- **Ningún componente escribe un color.** Los hex viven una sola vez en
  `panel/src/styles/tokens.css`; `panel/src/styles/tokens.test.ts` falla si
  aparece uno afuera.
- **Los comentarios explican el porqué, no el qué.** El código ya dice qué
  hace; el comentario existe para la decisión que no es obvia (por qué mediana
  y no promedio, por qué se resta un día en la query de Gmail). Seguí ese tono.
- **Telemetría estructurada:** `withSpanSync` / `emitMetric` / `logInfo` en
  `db/telemetry.ts`. **Nunca loguees valores personales** — sólo claves,
  conteos e ids. Los CLIs silencian los spans con `WALLET_TELEMETRY_SILENT`
  porque su stdout es un resultado JSON, no un log.
- **Commits:** Conventional Commits, en español.

## Diseño del onboarding

`npm run onboard` es un set de subcomandos **no interactivos**, no un wizard de
stdin. Es a propósito: está pensado para que un agente lo maneje —
`--status` para saber dónde está, `--suggest` para leer el ledger real,
preguntarle al humano sólo lo que hace falta, y `--set` / `--rule` para
escribir. Todo idempotente y reanudable.

Si extendés el onboarding, mantené esa propiedad: **stdout parseable, cero
prompts bloqueantes, y nunca escribir un valor que el usuario no confirmó.**

## El servidor MCP

`server/src/mcp/` expone el motor como herramientas para cualquier agente que
hable MCP. Ver `docs/mcp.md`. Tres reglas al tocarlo:

1. **Cero lógica financiera en esa capa.** Una tool valida argumentos, llama a
   una función que ya existe en `strategy/`/`api/`/`onboard/`, y serializa. Si
   te encontrás calculando algo ahí, va en el motor con su propio test.
2. **`stdout` es JSON-RPC.** Un `console.log` rompe el protocolo. Los logs van
   a `stderr`.
3. **El bundle es un artefacto versionado.** Si tocás `server/src/mcp/`,
   `npm run build` lo regenera y el `.cjs` entra en el mismo commit.
