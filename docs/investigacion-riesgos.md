# Investigación de riesgos: ¿qué se rompe si se reduce la dependencia de IA?

**Qué es esto:** una medición de riesgo sobre la propuesta de
[`investigacion-agentes-vs-scripts.md`](investigacion-agentes-vs-scripts.md).
No es una implementación ni una recomendación de código. Es el paso previo a
decidir.

**Método:** lectura del código real, ejecución de la suite (655 tests, 65
archivos, verde), y **forense sobre el ledger real de 1069 transacciones**
(2026-01-07 → 2026-08-26). Ningún dato personal entra a este documento: sólo
conteos, tipos y atribuciones.

**Corrección al reporte anterior:** el §7 "Fase 0" proponía correr
`SELECT COUNT(*) FROM transactions WHERE review_reason = 'claude_amount_mismatch'`.
**Esa consulta no se puede correr: `review_reason` no es una columna.** Existe
sólo como campo en memoria de `ParsedTransaction` (`parser/types.ts:56`), lo
escriben `produbanco.ts:131` y `reconcile.ts:137,170,233,258`, lo lee
`pipeline.ts:346` — y se pierde en el persist: `NewTransaction`
(`db/repository.ts:30-45`) no lo lleva y `CREATE TABLE transactions`
(`db/schema.ts:6-25`) no lo tiene. **El motivo de una revisión nunca se guardó.**
Lo que sigue es la reconstrucción forense que reemplaza esa consulta imposible.

---

## 0. El número que decidía todo

El reporte anterior decía: *"ese número decide todo — 0 después de miles de
correos → el check nunca se ganó el sueldo"*.

**El número es 0.**

Reconstrucción completa de las 108 filas en `needs_review`, sin margen de error
(los seis grupos suman exactamente 108):

| Motivo reconstruido | Filas | ¿Lo causó Claude? |
|---|---:|---|
| `amount_not_found` — `recibido` (el parser no leyó el monto) | 63 | No |
| `ambiguous_reversal_match` — `debito` marcado por reverso ambiguo | 18 | No |
| Reverso ambiguo (12) / no apareado (1) | 13 | No — Claude nunca ve reversos |
| `amount_not_found` — `retiro` | 10 | No |
| `amount_not_found` — `recarga` | 3 | No |
| `foreign_currency_ars` (`forceReview`) | 1 | No |
| **`claude_amount_mismatch`** | **0** | — |
| **Total** | **108** | |

### Cómo se reconstruyó (verificable)

1. **76 filas tienen `amount = 0`** — el `UNKNOWN_AMOUNT_PLACEHOLDER` de
   `pipeline.ts:158`. Sólo se escribe cuando `parseEmail` devolvió
   `amount: null`. En esos casos `needs_review` ya venía en `true` del parser
   (`produbanco.ts:119`), **antes** de que corriera el extractor. Se reparten en
   `recibido` 63, `retiro` 10, `recarga` 3. Verificado además: en las 76, el
   asunto no contiene ningún substring con forma de monto (0/76) — el fallo está
   en la rama anclada al cuerpo, no en el cross-check.

2. **32 filas tienen `amount ≠ 0`**: 19 `debito` (`hybrid`) y 13 `reverso`
   (`deterministic`).
   - Los 13 reversos son `deterministic` por construcción: `pipeline.ts:306-331`
     hace `continue` **antes** de llamar al extractor. Claude nunca los vio (y
     `pipeline.test.ts:376` lo afirma: `expect(extractor.received).toHaveLength(0)`).
   - De los 19 `debito`, 1 es el `foreign_currency_ars` (`forceReview: true`,
     `produbanco.ts:170-179`).
   - Los **18 restantes**: en los 18, el monto guardado coincide **exactamente**
     con el monto que la misma regex estricta lee de su propio asunto (18/18,
     cero divergencias). O sea: el parser leyó bien y la fila igual está
     marcada. Descartado `invalid_ts` (0 de las 108 tiene `ts` inválido) y
     `ambiguous_retiro_group` (sólo aplica a `type='retiro'`).

3. **La única explicación que queda para esas 18 se reprodujo sobre los datos.**
   Replicando `applyReversals` (`reconcile.ts:151-172`) sobre el ledger —
   mismo monto en centavos, misma cuenta, misma ventana de
   `localDayKey`/6h — salen **12 reversos ambiguos, 1 no apareado, 123
   apareados**. Los 13 primeros son exactamente las 13 filas `reverso` en
   revisión, y los `debito` que esos 12 reversos ambiguos tocan son
   **exactamente los 18**, uno a uno (intersección 18/18).

### La honestidad del límite

No puedo demostrar que Claude nunca discrepó: si en esas 18 filas Claude además
hubiera discrepado, `needs_review` ya era `true` y el `review_reason` (que no se
guarda) se decide por orden. Lo que **sí** está demostrado, y es lo que importa
para la decisión:

> **No existe en el ledger ni una sola fila cuyo estado `needs_review` sea
> atribuible al cross-check de Claude.** Las 108 seguirían marcadas, idénticas,
> si el extractor no hubiera existido nunca.

En 933 correos que sí pasaron por Claude (todo lo que no es reverso), en 857
había un monto del parser contra el cual comparar. En 838 Claude coincidió. En
los 19 restantes su veredicto fue irrelevante porque la fila estaba marcada por
otra cosa. **Ocho meses de correos reales; cero filas ganadas.**

---

## 1. Riesgos de quitar `claude_extract`

### 1.1 Dónde se usa la salida del extractor — traza completa

`extracted` aparece **una sola vez** en todo el repo:

```
pipeline.ts:336  const extracted = await withSpan("ingest.claude_extract", …)
pipeline.ts:339  const validation = validateAmount(parseResult.amount, extracted.amount_text_raw);
pipeline.ts:341  const candidate = validation.ok ? parseResult : { …parseResult, needs_review: true, review_reason: "claude_amount_mismatch" }
```

`validateAmount` (`amount-validate.ts:46-55`) devuelve `{ ok, derived }`.
**`derived` no lo lee nadie.** Lo único que sale del extractor y llega a la base
es un booleano que puede subir `needs_review` de `false` a `true`. Nada más.

`extracted.counterparty` se pide en el schema (`claude-email-extractor.ts:31`)
y **se descarta**: la contraparte sale de `extractField(body, "Establecimiento")`
en el parser. Es un campo que se paga en tokens de salida y no se usa.

Cadena de dependencias afuera de `pipeline.ts`:

| Sitio | Dependencia |
|---|---|
| `sync/build-sync-runner.ts:81` | construye el extractor |
| `sync/build-sync-runner.ts:69` | **`return null` si no hay credencial de Claude** → `POST /api/sync` responde 503 |
| `mcp/server.ts:499` | usa el mismo `buildProductionSyncRunner` → misma puerta |
| `index.ts:76` | expone la capability al dashboard con el mismo check |
| `onboard/status.ts:117-124` | paso `claude` del checklist |
| `mcp/server.ts:218` | docstring que explica `needs_review` |
| `chat/` | **ninguna** — llama a `query()` por su cuenta |

### 1.2 Qué tests asumen su existencia

| Test | Qué pasa al quitarlo |
|---|---|
| `pipeline.test.ts:128` "flags needs_review … when Claude's amount disagrees" | **Muere.** No hay comportamiento que testear. |
| `pipeline.test.ts:150` "flags needs_review when Claude returns no amount_text_raw" | **Muere.** |
| `pipeline.test.ts:101` (parte AC5) | El assert de enmascarado (`extractor.received[0].body`) queda sin sujeto. `mask.test.ts` cubre la función pura, pero **se pierde el test de integración de AC5**. |
| `pipeline.test.ts:594` "tags … source:'hybrid'" | **Falla:** la fila pasaría a `deterministic`. |
| `pipeline.test.ts:375, 413, 453` "the extractor is never invoked for reverso/statement/ignored" | Quedan vacíos (tautológicos). |
| `claude-email-extractor.test.ts` (5 tests) | Se borran con el archivo. |
| `amount-validate.test.ts` (10 tests) | Se borran si se borra `validateAmount`. |
| ~50 sitios en `pipeline.test.ts` (33 `it`) y `run-sync.test.ts` (17 `it`) que arman `deps(gmail, extractor)` | Cambio **mecánico** (borrar un argumento), no semántico. |

**Saldo: 655 tests → ~638.** De los ~17 que se pierden, sólo **2** afirman una
garantía real (los de mismatch). Los otros 15 testean el andamio del extractor
mismo o su ausencia.

### 1.3 ¿Qué garantía se pierde de verdad?

Una sola, y hay que ser preciso sobre su alcance:

> Si el banco cambia la plantilla y la regex empieza a matchear la cifra
> equivocada **de forma silenciosa y plausible**, hoy eso *podría* salir como
> mismatch. Sin cross-check, entra callado.

Ahora, tres recortes a esa garantía, todos verificables en el código:

**(a) No cubre el modo de fallo más probable de un cambio de plantilla.** El
extractor corre en `pipeline.ts:333`, **después** de que
`parseResult.kind === "transaction"`. Si el banco cambia el asunto, `classify`
cae a `{kind:"ignored", reason:"unrecognized_subject"}` (`produbanco.ts:285`),
se cuenta en `skipped` y **el correo desaparece: nunca se persiste, nunca se
marca, nunca se cuenta**. Claude no lo ve. Ese es el desastre real de la deriva
de plantilla, y el cross-check es estructuralmente ciego a él.

**(b) No es una segunda fuente.** Claude lee el mismo texto. Si la plantilla
cambió de forma que hay una sola cifra plausible y es la equivocada, Claude cita
esa misma cifra y coincide. El check sólo detecta el subconjunto "hay más de una
cifra y cada uno agarró una distinta" — que es exactamente el subconjunto que un
guarda determinista detecta igual de bien.

**(c) Ocho meses de datos: 0 activaciones.** No es que el riesgo no exista; es
que este mecanismo no lo capturó ni una vez.

### 1.4 ¿El guarda determinista propuesto cubre la deriva de plantilla?

**Parcialmente, y la formulación de una línea del reporte anterior tiene un
error que hay que corregir antes de implementarla.**

> *"si en la región de la que el parser leyó hay más de un substring con forma de
> monto, el match es ambiguo → needs_review"*

- **Ramas que leen del asunto** (`debito`, `credito`, `servicio`,
  `transferencia`, y `recibido` cuando el asunto trae monto): la "región" es el
  asunto entero. Funciona bien. Un asunto con dos cifras hoy elige la primera en
  silencio; el guarda lo marcaría. **Mejora estricta sobre el estado actual.**
- **Ramas ancladas al cuerpo** (`retiro` vía `extractLabeledAmount(body,
  "Monto")`, `recibido` como fallback, `sueldo`, `recarga`): si "región" se lee
  como "el cuerpo", el guarda **se dispara en el 100 % de los casos** — el
  comentario de `produbanco.ts:50-56` dice literalmente que los cuerpos traen
  saldo y comisión antes del monto que importa. Sería un desastre de falsos
  positivos, **y los falsos positivos son permanentes** (§3.1).
  La formulación correcta es: **"la etiqueta anclada aparece más de una vez"**,
  no "hay más de un monto en el cuerpo".
- **Lo que el guarda NO cubre** (y Claude tampoco): la plantilla cambia y queda
  exactamente **una** cifra, que es la equivocada.

**Hay un guarda mejor y gratis que ninguno de los dos reportes propuso.** En
`recibido`, `produbanco.ts:274` ya hace:

```ts
const amount = extractAmount(rawSubject, "either") ?? extractLabeledAmount(body, "Monto");
```

Ese `??` es un desperdicio de evidencia. Asunto y cuerpo son **dos afirmaciones
independientes del mismo monto dentro del mismo correo**. Convertirlo en "si los
dos existen, tienen que coincidir" es una verificación cruzada **real** — más
fuerte que Claude, que lee el texto una sola vez — y cuesta cero. Es exactamente
el patrón que `heal-counterparty.ts:33-39` ya usa y documenta ("se escribe el
comercio sólo si el correo, reparseado hoy, rinde el MISMO monto").

**Y para el caso (a), el que de verdad importa:** un canario de *clasificación*,
no de monto. Alertar cuando la tasa de `skipped` / `unrecognized_subject` sobre
correos de un remitente registrado se sale de su base histórica. `IngestSummary`
ya lleva `skipped` (`pipeline.ts:95`) y `emitMetric("ingest.summary", …)` ya lo
emite (`pipeline.ts:225`). **El dato ya está; falta el umbral.** Determinista,
costo cero, y cubre el agujero que el LLM no cubre.

### 1.5 El canario del 1 %

**No sirve a ese ritmo y conviene decirlo.** El ledger tiene 1069 transacciones
en ~8 meses ≈ 130/mes. El 1 % es **1,3 correos por mes**. Para detectar una
deriva que afecta a todos los correos de un tipo, el tiempo esperado de
detección se mide en meses — y encima requiere que el mismatch se dispare, cosa
que en 933 correos no pasó nunca.

Si se quiere un canario, que sea **por novedad, no por azar**: correr el LLM sólo
sobre asuntos cuya forma normalizada (dígitos → `N`) no está en una tabla de
formas conocidas. En este ledger, los 63 `recibido` comparten **una sola** forma
de asunto — una tabla de formas conocidas es minúscula y un asunto nuevo salta al
primer correo, no al centésimo.

### 1.6 Riesgos operativos concretos de quitarlo

| Riesgo | Severidad | Nota |
|---|---|---|
| La puerta de credencial (`build-sync-runner.ts:69`) queda huérfana | **Media** | Si se quita el extractor y no la puerta, el sync sigue exigiendo una credencial de Claude que ya no usa. Hay que tocar los dos, y también `index.ts:76`, `mcp/server.ts:499` y el paso `claude` de `onboard/status.ts` (que **no se borra**: el chat sigue necesitando la credencial — sólo cambia de "obligatorio para sincronizar" a "obligatorio para el chat"). |
| `mcp/server.ts:218` documenta `needs_review` como "el parser y Claude no coincidieron" | **Baja** | Ya es engañoso hoy (0 filas por ese motivo). Hay que reescribirlo igual. |
| La columna `source` queda constante | **Baja** | Todo pasaría a `deterministic`. El default del schema (`'claude'`, `schema.ts:23`) ya está muerto. Las filas históricas `hybrid` no se tocan — se pierde poder distinguir eras futuras, no las pasadas. |
| Se pierde el test de integración de AC5 (enmascarado) | **Baja** | Con el extractor no queda nada a lo que mandarle un correo. `mask.test.ts` cubre la función; el `maskEmailForExtractor` de `pipeline.ts:335` queda sin llamador. |
| Más filas en revisión manual | **Ninguno** | Quitar el check **sólo puede quitar banderas**. Sobre este ledger: 108 → 108. |
| Un monto incorrecto entra a los totales | **Ninguno por este camino** | Ver §4. |

---

## 2. Riesgos de acotar el extractor (Haiku + `tools: []` + `systemPrompt` mínimo)

### 2.1 ¿Pasan los tests con Haiku?

**Sí — y ese es precisamente el problema.**

`claude-email-extractor.test.ts:8` hace `vi.mock("@anthropic-ai/claude-agent-sdk")`.
Ningún test hace una llamada real. Ningún test lee `options.model` ni
`options.tools` (el único que inspecciona `options` es el de `outputFormat`,
línea 47). Los 3 tests de cross-validación de `pipeline.test.ts` usan un
`FakeEmailExtractor`.

> **La suite queda 655/655 en verde aunque le pongas `model: 'no-existe'`.**
> El test suite no ofrece **ninguna** protección contra una regresión de calidad
> del modelo. Los tests pasando no es evidencia de nada aquí.

### 2.2 ¿Cae la precisión → más filas en revisión?

Sí, es el riesgo real, y va en la dirección mala:

- La tarea es "copiá el substring del monto". Haiku 4.5 debería hacerla bien.
- Pero **todo fallo del extractor es un falso positivo**, no una omisión:
  `claude-email-extractor.ts:49,75,77` devuelve `FAILED_EXTRACTION`
  (`amount_text_raw: null`) ante cualquier subtype de error, structured output
  ausente, o Zod fallando. Y `validateAmount(x, null)` → `ok: false`
  (`amount-validate.ts:51`) → **`needs_review = true`**.
- O sea: *cualquier* degradación —modelo más chico que devuelve un formato
  ligeramente distinto, rate limit, timeout, corte de red— se traduce en filas
  excluidas de todos los totales. Un incidente de API de 10 minutos durante un
  sync grande marca todo el lote.
- `systemPrompt` mínimo: hoy el extractor **no pasa ninguno**, así que hereda el
  preset de Claude Code. Fijar uno mínimo es el cambio de mayor ahorro y menor
  riesgo del paquete. `tools: []` no puede romper corrección (ya hay
  `maxTurns: 1` y cero MCP servers).

### 2.3 ¿Es reversible?

**El código sí. Sus efectos sobre el ledger no.**

Y acá está el hallazgo contraintuitivo de todo este análisis:

> **Acotar el extractor es más riesgoso para los datos que quitarlo.**

- Quitarlo sólo puede **no levantar** banderas que igual nadie levantó nunca. Y
  es recuperable: `pipeline.ts:380-386` **sube** `needs_review` en un re-sync, así
  que reactivar el extractor y re-sincronizar una ventana vieja re-evalúa esas
  filas (Gmail mediante).
- Acotarlo sólo puede **agregar** banderas. Y una bandera puesta **no se saca
  nunca**: ningún camino del código escribe `needs_review: false` (verificado por
  grep sobre todo `server/src`), `/api/review` es sólo `GET`
  (`api/routes.test.ts:141`), y el upgrade de `repository.ts:163` sólo lo llaman
  `pipeline.ts` y `reconstruct.ts`, ambos pasando `true`.

Es decir: el cambio "chico y seguro de 4 líneas" es el que puede corromper el
ledger de forma permanente, y el cambio "grande y arquitectónico" es el que no
puede.

---

## 3. Reversos y montos ambiguos: ¿los maneja el parser solo?

**Sí, y ya lo hace hoy — Claude nunca participó de este camino.**

### 3.1 Reversos: 100 % determinista, ya en producción

- `produbanco.ts:150` clasifica `kind: "reverso"`; `pipeline.ts:306-331` extrae
  monto/cuenta con `extractReversoFields` y hace `continue` **antes** del
  extractor.
- `reverso-extract.ts:46` prueba `Valor:` → `Monto:` → prosa, en ese orden, con
  la misma disciplina de dos decimales + `\b`. Sin match → `amount: null` →
  `needs_review`, nunca adivinado.
- Los 136 reversos del ledger son `source='deterministic'`. **Toda la columna
  `deterministic` (136 filas) son reversos** — `reconstruct.ts` no dejó filas en
  esta base.
- 123 apareados, 13 en revisión. Reproducido exactamente por replay.

### 3.2 El problema real de los reversos no tiene nada que ver con IA

Reproduciendo `applyReversals` sobre los datos aparece la causa raíz de **31 de
las 108 filas en revisión (29 %)**:

- `accountsEqual(null, null) === true` (`reconcile.ts:96`).
- Los **497** `debito` del ledger tienen `account = NULL` — el parser sólo
  puebla `account` en la rama `retiro` (`produbanco.ts:234`), nunca en consumo.
- Los 136 reversos también tienen `account = NULL`.
- Resultado: el filtro de `reconcile.ts:151-159` degenera a **monto + día**. Dos
  consumos del mismo monto el mismo día ⇒ el reverso es ambiguo ⇒ los dos
  consumos quedan marcados para siempre.

Doce reversos cayeron en eso y arrastraron 18 consumos. Ningún LLM interviene, y
ningún cambio al extractor lo mejora ni lo empeora.

### 3.3 Montos ambiguos: el agujero de 76 filas

Las 76 filas con `amount = 0` son el fallo más caro del ledger y también es
100 % determinista:

- **63/63 `recibido`** — el **100 %** de las transferencias recibidas — con monto
  0 y excluidas de todos los totales (`EXCLUDE_FROM_TOTALS_SQL`,
  `strategy/totals.ts:13`). Son `direction: 'in'`: **el saldo calculado está
  ignorando 63 ingresos.**
- Los 63 comparten **una sola** forma de asunto ("Transferencia recibida desde
  Produbanco", sin monto), así que `extractAmount(rawSubject, "either")` falla
  siempre y todo depende de `extractLabeledAmount(body, "Monto")`, que también
  falla 63/63.
- **Hipótesis, no verificada** (el cuerpo no se persiste, así que no puedo
  confirmarlo desde la base): es el mismo bug que TASK-041 arregló en
  `reverso-extract.ts:20` — el cuerpo dice `Valor:` y no `Monto:`. El arreglo se
  aplicó a los reversos y **nunca se propagó a `produbanco.ts`**. Confirmarlo
  cuesta un correo real.
- Idem `retiro` 10/10 y `recarga` 3/3.

Claude vio los 76 correos, y no podía hacer nada: su salida jamás se convierte en
un monto. **Ahí está el retorno de inversión, no en el extractor.**

---

## 4. La regla de oro: ¿se mantiene en los dos escenarios?

**Sí, en ambos, y por construcción — no por disciplina.**

El único punto donde algo derivado de Claude toca el flujo es
`pipeline.ts:339`, y lo que sale de ahí es `validation.ok`, un booleano. El
monto persistido es siempre `tx.amount ?? UNKNOWN_AMOUNT_PLACEHOLDER`
(`pipeline.ts:172`), y `tx.amount` viene de `parseEmail`. `validation.derived`
—el único número que Claude produce— **no lo lee nadie**.

- **Escenario A (quitar):** el monto sigue saliendo de `parseEmail`.
  `reconstruct.ts` ya es exactamente ese pipeline, con test propio y un doc que
  lo argumenta (líneas 11-20). Riesgo de monto incorrecto: **cero**.
- **Escenario B (acotar):** el número de Claude sigue sin entrar. Riesgo de monto
  incorrecto: **cero**.

### El único camino real por el que se rompería

Existe, es concreto, y hay que nombrarlo:

`validateAmount` devuelve `ok: false` también cuando `parserAmount === null`
(`amount-validate.ts:51`). Hoy eso es **redundante** — el parser ya puso
`needs_review: true` en `produbanco.ts:119`. Pero si alguien quita el extractor
"simplificando" el ternario de `pipeline.ts:341-347` a `candidate = parseResult`
y **al mismo tiempo** toca la lógica de `needs_review` del parser, las 76 filas
con `amount = 0` entrarían a los totales como transacciones de cero dólares. El
saldo no daría error: daría un número silenciosamente equivocado.

**Ese es el único riesgo de corrección de todo el cambio, y se cubre con un
test.** Ver §6.

---

## 5. Riesgo operativo: MCP, chat, onboarding

| Componente | ¿Depende del extractor? | Impacto |
|---|---|---|
| **Chat** (`chat/chat-service.ts`) | **No.** Llama a `query()` por su cuenta, con su `systemPrompt`, `tools: []` y sus 5 tools MCP in-process. | Ninguno. Es el componente IA inevitable y queda intacto. |
| **MCP `sync`** (`mcp/server.ts:249,499`) | Indirecta, vía `buildProductionSyncRunner`. | Hoy exige credencial de Claude aunque el usuario sólo quiera ingestar. Quitando extractor **y** puerta, el sync funciona con Gmail solo. Es una **mejora** operativa. |
| **Resto de tools MCP** | **No.** Leen del ledger. | Ninguno. |
| **`mcp/server.ts:218`** (docstring de `needs_review`) | Textual. | Hay que reescribirlo: hoy dice algo que los datos contradicen. |
| **Onboarding** (`onboard/status.ts:117`) | Paso `claude`. | **No se borra** — el chat lo sigue necesitando. Cambia de "obligatorio para sincronizar" a "obligatorio para el chat". |
| **`onboard --suggest`** (`onboard/suggest.ts:170`) | No. SQL puro. | Ninguno. Nota: ya excluye `needs_review = 0`, así que las 76 filas rotas tampoco alimentan las sugerencias de perfil. |
| **Dashboard** (`web/`) | No. | Ninguno. |

**¿Más filas en revisión manual para el usuario?** No. Quitar el check sólo puede
bajar el conteo. Sobre este ledger, lo deja idéntico: **108 → 108**.

Y un problema de UX que existe hoy y que ninguno de los dos escenarios arregla:
**`needs_review` es una tumba.** 108 filas (10,1 % del ledger, incluido el 100 %
de los ingresos por transferencia) están fuera de todos los totales y no hay
endpoint, CLI ni tool MCP para resolverlas. Antes de discutir quién las revisa,
hace falta construir dónde.

---

## 6. Recomendación

### ¿Viable?

**Quitar `claude_extract` del sync: sí, con evidencia.** No es una apuesta: es
retirar un mecanismo que en 933 correos y 8 meses no cambió el destino de ni una
fila, cuya única garantía teórica es ciega al modo de fallo más probable, y cuyo
reemplazo determinista ya existe y está testeado (`reconstruct.ts`).

**Acotar el extractor a Haiku: sí, pero es la opción *más* riesgosa de las dos**,
por §2.3. Si se hace, tiene que ser con un interruptor de config y una alerta
sobre la tasa de mismatch — no como cambio silencioso de 4 líneas.

### Orden propuesto

**Ninguno de los pasos 0-2 toca el extractor.** Son los que más valor entregan y
los que menos riesgo tienen.

0. **Arreglar los 76 montos perdidos.** El 100 % de los `recibido` y `retiro`
   están fuera de los totales. Confirmar la hipótesis `Valor:` vs `Monto:` con un
   correo real y propagar el arreglo de TASK-041 a `produbanco.ts`. *Esto es el
   ROI, no el costo de tokens.* Nota: `insertTransaction` es insert-only, así que
   arreglar el parser **no repara el histórico** — hace falta un `heal-amount`
   con el mismo patrón de guarda que `heal-counterparty.ts`, y ese sí escribe
   sobre plata: tiene que ser el cambio más testeado del paquete.
1. **Arreglar la ambigüedad de reversos.** Poblar `account` en la rama de consumo
   de `produbanco.ts`, o distinguir `null` de `null` en `accountsEqual` (hoy dos
   desconocidos se consideran iguales). Recupera hasta 31 filas.
2. **Construir la salida de `needs_review`.** Un endpoint/tool para resolver. Sin
   esto, cualquier bandera nueva es daño permanente y el paso 3 no debería
   hacerse.
3. **Recién ahí: el sync determinista por default.** Unificar `pipeline.ts` con
   `reconstruct.ts` detrás de un flag, con default determinista. Quitar la puerta
   de credencial de `build-sync-runner.ts:69` y actualizar `index.ts:76`,
   `mcp/server.ts:218,499`, `onboard/status.ts:117`.
4. **Reemplazar la garantía por dos guardas deterministas:**
   (a) auto-consistencia asunto↔cuerpo donde ambos tienen el monto — convertir el
   `??` de `produbanco.ts:274` en "si los dos existen, tienen que coincidir";
   (b) **canario de clasificación**: alertar sobre la tasa de `skipped` /
   `unrecognized_subject`, que ya viaja en `IngestSummary` y en
   `emitMetric("ingest.summary")`. Este es el que cubre el agujero que Claude
   nunca cubrió.
5. **Sólo si se decide conservar el extractor:** `systemPrompt` mínimo +
   `tools: []` + `model` explícito, detrás de config, con la métrica de mismatch
   emitida antes de tocar nada. Y sacar `counterparty` del schema de salida: se
   pide y se tira.

### Qué es irreversible

| Cosa | ¿Irreversible? |
|---|---|
| Borrar el extractor y sus tests | **No.** Es git. |
| Filas que quedarían sin marcar al quitar el check | **No.** El re-sync **sube** `needs_review` (`pipeline.ts:380-386`); reactivarlo y re-sincronizar la ventana las re-evalúa. |
| **Falsos positivos nuevos (Haiku, o el guarda mal formulado del §1.4)** | **SÍ.** Ningún camino escribe `needs_review: false`. La fila desaparece de los totales para siempre salvo editando SQLite a mano. |
| **Un `heal-amount` mal hecho en el paso 0** | **SÍ.** Es el único cambio del paquete que escribe sobre `amount`. |
| Perder la distinción `hybrid`/`deterministic` a futuro | Parcial. Las filas históricas no se tocan. |
| Los 933 correos que ya pasaron por Claude | Ya pasaron. El costo está hundido. |

### Qué tests protegerían el cambio

Cinco, y el primero es el que de verdad importa:

1. **`amount: null` nunca entra a los totales.** Un correo cuyo asunto y cuerpo
   no rinden monto → fila persistida con `needs_review = 1` **y ausente de
   `EXCLUDE_FROM_TOTALS_SQL`**. Es el único test que cubre el camino de §4, y
   hoy no existe en esa forma: `reconstruct.test.ts:187` verifica la bandera,
   pero no que la fila esté fuera del total.
2. **Regresión de invariante:** para un lote fijo de correos, el ledger que
   produce el sync determinista es **idéntico** al que produce el híbrido con un
   extractor que siempre coincide — misma `amount`, misma `needs_review`, mismo
   `category`, fila por fila. Es el test que demuestra que el cambio no mueve
   nada; conviene escribirlo **antes** de tocar `pipeline.ts`.
3. **El guarda de asunto↔cuerpo:** un correo donde asunto dice X y cuerpo dice Y
   → `needs_review`, y **nunca** elige uno de los dos.
4. **El guarda anclado no se dispara en el caso normal:** un `retiro` real con
   saldo y comisión en el cuerpo → `needs_review = 0`. Es el test que evita el
   desastre de falsos positivos del §1.4.
5. **La bandera nunca baja:** re-sincronizar una fila ya marcada la deja marcada,
   con cualquiera de los dos caminos.

Y uno que hoy falta y no depende de esta decisión: **si se conserva el extractor,
un test que afirme `options.model` y `options.tools`.** Sin él, cualquier cambio
de modelo pasa la suite sin que nadie se entere — que es exactamente la situación
actual.

---

## Apéndice: cómo verificar los números

Ninguna consulta de este documento requiere `review_reason` (no existe). Sobre el
ledger real, sin exponer datos:

```sql
-- Las 108, por tipo y source
SELECT type, source, COUNT(*) FROM transactions WHERE needs_review = 1 GROUP BY 1,2;

-- Las 76 del placeholder: parser sin monto, anterior a cualquier check
SELECT type, COUNT(*) FROM transactions WHERE needs_review = 1 AND amount = 0 GROUP BY 1;

-- Claude nunca vio un reverso
SELECT DISTINCT source FROM transactions WHERE type = 'reverso';  -- deterministic

-- El colapso del apareo: los consumos no tienen cuenta
SELECT COUNT(*) FROM transactions WHERE type = 'debito' AND account IS NULL;  -- 497 de 497
```

Las 18 filas de `ambiguous_reversal_match` se reconstruyen replicando
`reconcile.ts:151-172` (monto en centavos + cuenta + `localDayKey`/6h) sobre las
filas `debito` y `reverso`; el replay devuelve 12 ambiguos + 1 no apareado (= las
13 filas `reverso` en revisión) y toca exactamente esos 18 `debito`.
