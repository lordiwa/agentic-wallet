# Onboarding

Cómo llevar una instalación nueva de Agentic Wallet desde `git clone` hasta un
dashboard con datos reales.

Este documento está escrito para que **un agente** (Claude Code) lo ejecute
guiando a un humano, pero cada paso es un comando que se puede correr a mano.

---

## Para el agente: cómo usar este documento

`npm run onboard` es la fuente de verdad del estado. No asumas en qué paso está
el usuario: **preguntáselo al CLI**.

```bash
npm run onboard -- --status   # JSON: steps[], complete, next
```

Reglas de operación:

1. **Empezá siempre con `--status`.** Te dice cuál es el siguiente paso
   pendiente (`next`) y la acción exacta para resolverlo (`action`).
2. **Es reanudable.** Todos los subcomandos son idempotentes. Si la sesión se
   corta, volvé a correr `--status` y seguí desde ahí.
3. **Nunca inventes valores del perfil.** `--suggest` lee el ledger real del
   usuario. Si devuelve `null` en un campo, es porque no hay evidencia:
   preguntale al usuario, no lo rellenes.
4. **Confirmá antes de escribir.** El ciclo es: `--suggest` → mostrar la
   propuesta al usuario → él corrige → `--set` con el JSON confirmado.
5. **La salida de cada subcomando es JSON parseable en stdout.** Los logs de
   telemetría van silenciados en el CLI; los errores van a stderr con
   `{"ok": false, "error": "..."}` y exit code 1.

Subcomandos:

| Comando | Qué hace |
|---|---|
| `npm run onboard` | Checklist legible para humano |
| `npm run onboard -- --status` | Lo mismo, como JSON |
| `npm run onboard -- --init-env` | Copia `.env.example` → `.env` (nunca sobrescribe) |
| `npm run onboard -- --suggest` | Lee el ledger y propone un perfil |
| `npm run onboard -- --set '<json>'` | Escribe campos de `strategy_config` |
| `npm run onboard -- --rule <patrón>=<categoría>` | Agrega una regla de comercio |
| `npm run onboard -- --backfill` | Aplica las reglas al historial ya sincronizado |

---

## Paso 1 — `.env`

```bash
npm run onboard -- --init-env
```

Crea `.env` a partir de `.env.example`. **Nunca sobrescribe uno existente** —
ese archivo guarda el refresh token de Gmail, y perderlo obliga a rehacer todo
el OAuth.

`.env` está en `.gitignore`. No lo commitees nunca.

**Preguntale al usuario en qué huso horario está** y ponelo en
`WALLET_UTC_OFFSET_HOURS` (offset entero de UTC: `-5` Quito/Lima/Bogotá, `-3`
Buenos Aires, `-6` Ciudad de México, `+1` Madrid). El default es `-5`. Esto
define qué cuenta como "hoy" y "este mes" en todos los totales, así que si el
usuario no está en UTC-5 y no se cambia, las cifras diarias quedan corridas.

---

## Paso 2 — Credencial de Claude

Se necesita **una** de las dos. Preguntale al usuario cuál tiene.

**Opción A — suscripción Pro/Max (recomendada, no cobra por uso):**

```bash
claude setup-token
```

Imprime un token. Va en `.env`:

```
CLAUDE_CODE_OAUTH_TOKEN=<el token>
```

**Opción B — API key medida:** sacar una key de
[console.anthropic.com](https://console.anthropic.com) y ponerla en
`ANTHROPIC_API_KEY`. Se factura por token.

Si ambas están seteadas, `ANTHROPIC_API_KEY` tiene precedencia.

Verificá con `npm run onboard -- --status`: el paso `claude` debe pasar a
`done: true`.

---

## Paso 3 — Gmail (solo lectura)

El paso más largo, porque involucra la consola de Google Cloud. **El paso a
paso completo está en [conectar-gmail.md](conectar-gmail.md)** — seguilo de
ahí; acá va sólo el resumen.

1. En Google Cloud Console: habilitar **Gmail API**, configurar la pantalla de
   consentimiento, agregar el scope `gmail.readonly`, y crear un cliente OAuth
   de tipo **Desktop app**.
2. Poner el client id y el secret en `.env`:
   ```
   GMAIL_OAUTH_CLIENT_ID=...
   GMAIL_OAUTH_CLIENT_SECRET=...
   ```
3. Generar el refresh token:
   ```bash
   npm run gmail-auth
   ```
   Abre el navegador, pedís el permiso, y el script imprime el refresh token.
   Va en `GMAIL_OAUTH_REFRESH_TOKEN`.

> **Importante:** publicá la app (*Publishing status → In production*). En
> estado *Testing*, Google caduca el refresh token **cada 7 días**.

El scope es únicamente `gmail.readonly`: no se puede enviar, modificar ni
borrar correo. Se revoca cuando quieras desde
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

---

## Paso 4 — Primer sync

Trae el historial. Puede tardar: son varios minutos si hay meses de correos.

```bash
npm run dev
# en otra terminal:
curl -X POST localhost:3000/api/sync
```

O desde la web (`http://localhost:3000`), botón **Sincronizar**.

Verificá que entraron transacciones:

```bash
npm run onboard -- --status   # el paso `sync` debe estar en done: true
```

Si el sync trae **cero** transacciones, casi siempre es una de dos cosas:

- El banco del usuario no es Produbanco → hay que escribir su parser, ver
  [multibanco.md](multibanco.md).
- Los correos del banco no están en esa cuenta de Gmail.

---

## Paso 5 — Perfil financiero

Acá es donde el agente hace el trabajo interesante: **leer el historial real y
proponer**, en vez de preguntar a ciegas.

```bash
npm run onboard -- --suggest
```

Devuelve algo así:

```json
{
  "titular": "PEREZ GOMEZ ANA MARIA",
  "salary": {
    "fuente": "EMPRESA EJEMPLO SA",
    "cadencia": "quincenal",
    "montoEstimado": 1000,
    "diasPago": ["15", "30"],
    "sampleSize": 6
  },
  "uncategorized": [
    { "counterparty": "VETERINARIA CENTRAL", "count": 8, "total": 240.5 }
  ],
  "gastoMensualPromedio": 820.4,
  "mesesDeHistorial": 3.2
}
```

### 5a. Confirmar titular y sueldo

Mostrale la propuesta al usuario **con el `sampleSize`** ("esto sale de 6
depósitos de sueldo"). Que confirme o corrija. Después:

```bash
npm run onboard -- --set '{
  "titular": "PEREZ GOMEZ ANA MARIA",
  "sueldo": {
    "fuente": "EMPRESA EJEMPLO SA",
    "cadencia": "quincenal",
    "montoEstimado": 1000,
    "diasPago": ["15", "30"]
  }
}'
```

`titular` importa más de lo que parece: es cómo el motor reconoce las
transferencias entre cuentas propias del usuario como **internas**, para no
contarlas como gasto. Si está mal, los totales quedan inflados.

Si `salary` vino `null`, no hay depósitos de tipo `sueldo` en el ledger.
Preguntale al usuario cuánto cobra y qué días, y escribilo igual.

### 5b. Armar el patrón de gastos

`uncategorized` trae los comercios que hoy caen en `otros`, **ordenados por
plata gastada**. Ese orden es deliberado: preguntar por los 10 comercios donde
se fue más plata cubre la mayor parte del gasto con pocas preguntas.

Preguntale al usuario, comercio por comercio, a qué categoría pertenece. Las
categorías válidas son fijas:

```
comida  transporte  salud  mascota  servicios
recarga  efectivo  transferencia_persona  suscripcion  otros
```

Y guardá cada respuesta:

```bash
npm run onboard -- --rule "veterinaria=mascota"
npm run onboard -- --rule "farmacia=salud"
```

El patrón se guarda **normalizado** (minúsculas, sin tildes) y matchea por
substring: la regla `veterinaria` cubre `VETERINARIA CENTRAL`,
`Veterinaría del Sur` y cualquier variante que escriba el banco. Por eso
conviene un patrón corto y distintivo, no el nombre completo.

Las reglas más largas ganan sobre las más cortas, así que podés tener
`farmacia=salud` y `farmacia san jose=otros` conviviendo.

> **No hay lista de comercios precargada, y es a propósito.** Qué comercios
> existen y a qué categoría pertenecen depende del país y de la persona. Una
> lista de fábrica clasificaría mal el ledger de todo el mundo menos el de quien
> la escribió.

Después de cargar todas las reglas, aplicalas al historial que ya estaba
sincronizado:

```bash
npm run onboard -- --backfill
# → {"ok": true, "updated": 143}
```

Las filas que ya tenían categoría no se tocan, así que correrlo dos veces es
inofensivo.

### 5c. Colchón, sueldo y topes

Con `gastoMensualPromedio` a la vista, proponé un colchón. Una heurística común
es 3 meses de gasto — pero **es una decisión del usuario, no del agente**:
mostrale el número y que él elija el multiplicador.

```bash
npm run onboard -- --set '{
  "colchonObjetivo": 2500,
  "topeTransferenciasMensual": 400,
  "moneda": "USD"
}'
```

| Campo | Qué es |
|---|---|
| `colchonObjetivo` | Cuánto querés tener guardado como red de seguridad |
| `topeTransferenciasMensual` | Límite mensual de transferencias a personas |
| `moneda` | Código de moneda, ej. `USD` |
| `balanceSnapshot` | `{ amount, at }` — saldo real en una fecha, punto de anclaje |

**`balanceSnapshot`** merece una nota. El saldo se calcula sumando el ledger
desde ese punto. Si el usuario sabe cuánto tenía en el banco en una fecha
concreta, cargarlo hace que el saldo mostrado sea el real y no sólo el neto de
lo que se sincronizó:

```bash
npm run onboard -- --set '{"balanceSnapshot": {"amount": 1234.56, "at": "2026-08-01"}}'
```

Si no lo sabe, dejalo en cero: el valor por defecto (`amount: 0` en la época)
significa "el saldo es la suma de todo el ledger", que es el comportamiento
neutro correcto.

---

## Terminado

```bash
npm run onboard        # debe decir "Todo listo"
npm run dev            # http://localhost:3000
```

El paso `profile` se considera completo cuando hay `titular` **y** al menos un
día de pago configurado — los dos campos que nada más puede inferir con
seguridad. Un colchón en cero es una decisión legítima, así que no cuenta para
el check.

## Si algo sale mal

| Síntoma | Causa probable |
|---|---|
| El sync trae 0 transacciones | Banco sin parser → [multibanco.md](multibanco.md) |
| `--suggest` devuelve todo `null` | El ledger está vacío: falta el paso 4 |
| Gmail pide reautorizar cada semana | La app quedó en *Testing*, hay que publicarla |
| `--set` responde `campo desconocido` | Typo en el nombre del campo; el error lista los válidos |
| Muchas filas en la bandeja de revisión | El monto del parser y el de Claude no coincidieron: revisalas a mano en la web |
