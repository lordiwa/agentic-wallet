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
| Esquema de la base | `server/src/db/schema.ts` |
| Rutas HTTP | `server/src/api/` |
| Dashboard | `web/src/` |

## Comandos

```bash
npm install          # Node 22+
npm run build        # web + server (tsc, sin emit en web)
npm test             # toda la suite (vitest)
npm run dev          # server + web
npm run onboard      # checklist de configuración
```

Antes de dar por terminado cualquier cambio: **`npm run build` y `npm test` en
verde**. No hay excepción.

## Convenciones

- **TypeScript ESM.** Los imports relativos llevan extensión `.js` (aunque el
  archivo sea `.ts`) — es requisito de ESM en Node.
- **Tests junto al código:** `foo.ts` → `foo.test.ts`. Vitest sólo corre
  `server/src/**/*.test.ts`, `server/scripts/**/*.test.ts` y
  `web/src/**/*.test.{ts,tsx}`.
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
