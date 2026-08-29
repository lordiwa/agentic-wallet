# Agentic Wallet

Copiloto financiero personal **local-first**: lee los correos que tu banco ya
te manda, arma tu historial de gastos en una base SQLite en tu máquina, y te
deja preguntarle cosas en lenguaje natural.

No hay servidor en la nube, no hay cuenta que crear, no se conecta a tu banco.
Tu plata, tu historial y tus credenciales no salen de tu computadora.

```
Gmail (solo lectura) ──► parser determinista ──► SQLite local ──► API + web + chat
                              ▲
                              └── Claude solo como verificación cruzada,
                                  nunca como fuente de los montos
```

## Qué hace

- **Sincroniza** los correos de notificación de tu banco y los convierte en
  transacciones (consumos, transferencias, retiros, sueldos, reversos).
- **Categoriza** tus gastos con reglas que vos definís (nada viene precargado).
- **Calcula** saldo, gasto por categoría, días hasta el próximo sueldo, deudas,
  colchón, y un resumen diario.
- **Responde preguntas** por chat sobre tu propio historial.

### La regla de oro

El monto de una transacción **siempre** sale del parser determinista (regex
sobre el texto del correo), nunca de Claude. Claude se usa como segunda opinión:
si su lectura del monto no coincide con la del parser, la fila se marca
`needs_review` y queda **excluida de todos los totales** hasta que un humano la
revise. Un copiloto financiero que alucina un número es peor que no tener nada.

## Requisitos

| Requisito | Por qué |
|---|---|
| **Node.js 22+** | Usa `process.loadEnvFile` nativo (sin dotenv) |
| **Cuenta de Gmail** | Donde llegan las notificaciones de tu banco |
| **Suscripción Claude Pro/Max** *o* API key | Para la extracción y el chat |
| **Un banco que mande correos** de notificación por transacción | Es la única fuente de datos |

La suscripción Pro/Max se conecta con `claude setup-token` y **no cobra por
uso**. La API key de `console.anthropic.com` es la alternativa medida.

## Empezar

```bash
git clone https://github.com/lordiwa/agentic-wallet.git
cd agentic-wallet
npm install

# 1. Crea tu .env
npm run onboard -- --init-env

# 2. Mira qué falta (te lo dice paso a paso)
npm run onboard
```

A partir de ahí, `npm run onboard` es tu guía: imprime un checklist con lo que
falta y el comando exacto para cada paso.

**Dos guías, según quién sos:**

- **Si sos la persona que va a usar el wallet** → leé
  [docs/onboarding-para-humanos.md](docs/onboarding-para-humanos.md). Explica
  en simple qué va a pasar, qué necesitás tener a mano, y qué te van a
  preguntar. No necesitás saber comandos.
- **Si sos un agente (o ayudás técnicamente)** → leé
  [docs/onboarding.md](docs/onboarding.md). Tiene todos los comandos, el flujo
  completo y las reglas de operación para manejar la instalación de punta a
  punta guiando a un humano.

Resumen de los cinco pasos:

1. `.env` creado (`npm run onboard -- --init-env`)
2. Credencial de Claude (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`)
3. Gmail conectado en solo lectura (`npm run gmail-auth`, ver
   [docs/conectar-gmail.md](docs/conectar-gmail.md))
4. Primer sync — trae tu historial
5. Perfil: titular, sueldo, días de pago, colchón, topes

Cuando el checklist esté completo:

```bash
npm run build    # la primera vez: sin `web/dist` el dashboard da 404
npm run dev      # API + web en http://localhost:3000
```

## Cómo se actualiza

```bash
git pull
npm install      # por si cambiaron dependencias
npm run build
```

Tu `.env` y tu `wallet.sqlite` están en `.gitignore`: un `git pull` nunca
toca tus datos ni tus credenciales. Las migraciones de esquema corren solas al
arrancar (`CREATE TABLE IF NOT EXISTS`), así que no hay paso manual.

## Arquitectura multibanco

El repo trae **un parser de ejemplo, Produbanco** (Ecuador). No es el único
banco soportado: es la referencia de cómo se escribe uno.

Un banco es un objeto que implementa `BankEmailParser`
(`server/src/parser/types.ts`):

```ts
{
  bankId: "mibanco",
  gmailSenders: ["notificaciones@mibanco.com"],  // de dónde llegan los correos
  canParse(email) { ... },                        // ¿es un correo de este banco?
  parse(email) { ... },                           // → transacción / statement / reverso
}
```

Lo registrás con `registerParser(miParser)` y listo: la búsqueda de Gmail
incluye automáticamente sus remitentes, y el pipeline lo usa para cualquier
correo que reconozca. **El paso a paso está en
[docs/multibanco.md](docs/multibanco.md).**

Si tu banco no es Produbanco, escribir su parser es el único trabajo real de
adaptación. Todo lo demás (categorías, estrategia, chat, web) es agnóstico.

## Seguridad

- **Gmail: solo lectura.** El scope es `gmail.readonly`. No hay forma de enviar,
  modificar ni borrar correo.
- **Nada sale de tu máquina** salvo el texto de los correos que se manda a Claude
  para la verificación cruzada — y va **enmascarado**: los números de cuenta se
  reemplazan por `XXXXXX1234` antes de salir (`server/src/ingest/mask.ts`).
- **La API no tiene autenticación.** Por eso escucha en `127.0.0.1` por defecto.
  Si la corrés en un servidor con IP pública, dejala en `127.0.0.1` y da el
  acceso remoto con `tailscale serve 3000`. Ponerla en `0.0.0.0` publica tu
  historial bancario en internet.
- `.env`, `*.sqlite` y los PDFs de estado de cuenta están en `.gitignore`.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Server + web en modo desarrollo |
| `npm run build` | Compila web y server |
| `npm test` | Toda la suite |
| `npm run onboard` | Checklist de configuración (ver `docs/onboarding.md`) |
| `npm run gmail-auth` | Genera el refresh token de Gmail |
| `npm run seed` | Siembra la config inicial (idempotente) |
| `npm run build:mcp` | Regenera el bundle del servidor MCP |

## Como herramientas de un agente (MCP)

El repo trae un servidor [MCP](https://modelcontextprotocol.io) ya registrado en
`.mcp.json`: al abrir el proyecto con Claude Code (u otro cliente MCP), el
agente ve el wallet como herramientas nativas —consultar movimientos, ver el
saldo y el colchón, gasto por categoría, disparar el sync, y llevar adelante el
onboarding— sin levantar el server HTTP.

Es la misma SQLite local y las mismas funciones que usa el dashboard. Detalle
completo en [`docs/mcp.md`](docs/mcp.md).

## Estructura

```
server/src/
  parser/     parsers por banco (produbanco = ejemplo) + registry
  ingest/     pipeline Gmail → parser → Claude (cross-check) → SQLite
  rules/      reconciliación: reversos, duplicados, transferencias internas
  category/   categorización determinista + reglas del usuario
  strategy/   saldo, gasto, sueldo, deudas, colchón, calendario
  chat/       chat sobre tu propio historial (Claude Agent SDK)
  onboard/    el flujo de configuración guiado
  mcp/        el wallet como herramientas MCP para agentes
  api/        rutas Express
  db/         esquema SQLite, repositorio, telemetría
web/src/      SPA React (dashboard, gráficos, chat, bandeja de revisión)
```

## Licencia

Uso personal. Este repo no incluye datos de nadie: la base arranca vacía y
todos los valores del perfil son cero hasta que vos los configurás.
