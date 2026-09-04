# El flujo portado a Cloud Functions

Hasta el commit anterior el pivot tenía cuatro piezas en pie (auth, overview,
ingesta mínima, health) y el panel recibía `501 no_portado` en todo lo demás.
Hoy **no queda una sola ruta del flujo sin portar**: `501` ya no es una
respuesta posible de este backend, y una ruta que no existe es un `404
ruta_desconocida` con su nombre.

La forma del puerto es siempre la misma y es lo que hace que esto sea revisable:
la lógica pura se copia a `functions/src/ledger/`, el borde queda en
`functions/src/api/router.ts`, y **un test de paridad le da la misma entrada a
las dos implementaciones y compara la salida campo por campo**. El motor de
`server/` sigue siendo la definición de qué es correcto; el puerto no la
reinterpreta.

## Pieza por pieza

| Pieza | Rutas | Motor reutilizado (`server/src/`) | Test de paridad | Estado |
|---|---|---|---|---|
| Sync / ingesta | `GET /sync/status`, función `ingest` | `ingest/pipeline.ts` | `api/ingest.test.ts` | ✅ |
| Clasificación | `GET /classify/queue`, `GET /classify/progress`, `POST /classify`, `POST /classify/silence`, `DELETE /classify/silence`, `GET /classify/silenced` | `classify/queue.ts`, `classify/progress.ts`, `classify/apply.ts`, `classify/silenced.ts` | `ledger/queue.parity.test.ts`, `ledger/writes.parity.test.ts` | ✅ |
| Revisión | `GET /review`, `POST /review/:id/resolve`, `GET /review/resolutions` | `review/resolve.ts` | `ledger/writes.parity.test.ts` | ✅ |
| Movimientos | `GET /transactions` | `api/queries.ts` | `ledger/listado.parity.test.ts` | ✅ |
| Categorías | (usada por overview y movimientos) | `category/categorize.ts` | `ledger/categorize.parity.test.ts` | ✅ |
| Estrategia | `GET /overview`, `GET /transfers`, `POST /buffer` | `strategy/balance.ts`, `strategy/spending.ts`, `strategy/card.ts`, `strategy/calendar.ts`, `strategy/transfers.ts`, `strategy/dates.ts` | `ledger/strategy.parity.test.ts` | ✅ |
| Perfil y alta | `GET /onboarding/profile`, `POST /onboarding/profile`, `GET /onboarding/recurring` | `onboard/profile.ts`, `onboard/recurring.ts`, `onboard/suggest.ts` | `ledger/recurring.parity.test.ts` | ✅ |

Son **17 rutas**. `functions/src/api/router.ts` las exporta en `RUTAS` y
`api/router.test.ts` recorre la lista entera contra el emulador: con un token
válido las diecisiete contestan `200`, sin token las diecisiete contestan `401
sin_token`, y `/api/lo-que-sea` contesta `404 ruta_desconocida`. El test
recorre esas rutas escritas **en la forma en que el panel las pide** (`/api/…`)
y afirma que son tantas como `RUTAS`, así que una ruta agregada de un lado y no
del otro rompe el test.

### Las dos que no viven en la función `api`

Del lado del panel, `rutaEnFunciones()` (`panel/src/api/client.ts`) manda todo
`/api/*` a la función `api` y **nunca devuelve `null`** — "esto todavía no lo
leo de tu cuenta" dejó de ser una respuesta posible. Quedan dos excepciones,
cada una por su motivo:

- `/api/sync` → `ingest`, la única función que descifra el refresh token.
  Tenerla aparte es lo que evita que el resto del backend tenga la clave
  maestra en su proceso, y además necesita 540 s de timeout.
- `/api/health` → `health`, la sonda pública, que no comparte proceso con nada
  que lea un ledger.

## Las tres correcciones que el puerto sacó a la luz

Escribir la segunda implementación es lo que las hizo visibles: ninguna se veía
mirando el motor solo.

1. **`FirestoreLedger.rules()` ordenaba por fecha de escritura.** El motor
   ordena de patrón más largo a más corto, que es lo que hace que una regla
   específica gane sobre una general. Con dos reglas anidadas el overview
   portado clasificaba distinto que el motor. Ordenar por longitud es lo
   correcto; ver también la nota sobre patrones más largos que el
   `counterparty` real.

2. **La ingesta buscaba y procesaba los N primeros correos en cada llamada.**
   Gmail devuelve del más nuevo al más viejo, así que en un buzón grande la
   corrida avanzaba la marca hasta el correo más nuevo y dejaba todo el resto
   *por debajo* del checkpoint — fuera del alcance de cualquier búsqueda
   futura, y en silencio. Ahora el drenado es por lotes con checkpoint, que es
   la única forma en que "procesé N" no significa "perdí el resto".

3. **`db/strategy-config.ts` construía su schema con una referencia de un
   módulo con el que forma ciclo.** Quien entrara al grafo por
   `strategy/calendar.js` rompía `setStrategyConfig` para todas sus
   superficies, no sólo para la que entró. Es la clase de bug que no aparece en
   los tests de un módulo y sí en el primer consumidor con otro orden de
   importación.

## Lo que el puerto borró

`PendienteCard` ya no existe. Dibujaba el estado "esta ruta todavía no está
portada", y **un estado que no puede ocurrir no se dibuja por las dudas**: si
alguna vez vuelve a poder ocurrir, el que la reponga va a querer decidir cómo se
ve, no heredar una tarjeta escrita para otro pivot.

## Cómo se verifica

```bash
cd functions && npm run build
PATH="$JRE/bin:$PATH" node scripts/with-emulator.mjs \
  node node_modules/vitest/vitest.mjs run
```

El emulador de Firestore necesita un JRE en el `PATH`. Los tests de paridad
importan el motor de `server/` — por eso `src/test-support/` está excluido del
build de `functions/`: vive fuera del `rootDir` del paquete, vitest lo resuelve
igual, y el andamio de los tests no tiene por qué viajar al runtime.
