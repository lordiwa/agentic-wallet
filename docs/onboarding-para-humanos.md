# Configurar tu Agentic Wallet — guía para humanos

Este documento es para **vos**, la persona que va a usar el wallet. No necesitás
saber programar ni entender comandos. Un **agente** (un asistente de IA como
Claude Code, o un amigo que te ayude) va a hacer el trabajo técnico — tu parte
es tener a mano algunas cosas y responder unas preguntas.

> Si en cambio sos el agente que va a hacer la instalación, usá
> [onboarding.md](onboarding.md), que tiene todos los comandos.

---

## Qué es esto, en simple

Agentic Wallet lee los **correos que tu banco ya te manda** (cuando pagás,
transferís, o te llega el sueldo), arma un **historial de tus gastos** en tu
propia computadora, y después te deja **preguntarle cosas** como "¿cuánto gasté
en comida este mes?" o "¿me alcanza para comprar X?".

- **Todo queda en tu computadora.** No hay una cuenta que crear, no hay nube.
- **Es de solo lectura** para tu correo: no puede enviar ni borrar nada.
- Al principio no sabe nada de vos — **el agente te va a preguntar** para ir
  armando tu perfil.

---

## Antes de empezar: qué necesitás tener a mano

Estas son las 3 cosas que hacen falta. **Si no tenés una, avisá antes de
arrancar** — sin estas no se puede configurar.

| Qué | Por qué hace falta | Cómo saber si lo tenés |
|---|---|---|
| **Una cuenta de Gmail** | Ahí llegan los correos de tu banco | La que usás normalmente |
| **Una suscripción de Claude** (Pro o Max) o una API key de Anthropic | El wallet usa IA para leer y clasificar los correos | Si pagás Claude.ai o tenés cuenta en console.anthropic.com |
| **Un banco que te mande correos** por cada movimiento | Es la única fuente de datos | Si tu banco te notifica por email cada consumo/transferencia, sí |

**Importante:** el banco debe **mandarte un correo por cada transacción**
(consumo, transferencia, retiro, sueldo). Si tu banco solo te avisa en la app
y no por email, esto no va a funcionar (o hay que hacer un trabajo extra para
soportarlo).

---

## Cómo es el proceso (5 pasos, ~30-40 minutos)

El agente te va guiando. **Vos casi siempre solo contestás preguntas o tocás
un botón en el navegador cuando te lo piden.** Nada de esto se hace a ciegas.

### Paso 1 — Crear tu archivo de configuración

El agente crea un archivo `.env` en tu carpeta (es como una "ficha técnica" de
tu instalación). Solo te va a preguntar **en qué país/huso horario estás** (para
que los totales de "hoy" y "este mes" salgan bien).

**Tu parte:** decirle tu huso horario.

### Paso 2 — Conectar tu suscripción de Claude

El wallet necesita que Claude le ayude a leer los correos. Si tenés
suscripción Pro/Max, el agente te va a dar un **link de autorización** — lo
abrís, entrás con tu cuenta, y copiás un código que le pasás. Es como cuando
conectás una app a Google o a tu banco.

**Tu parte:** abrir el link, autorizar, pasarle el código.

### Paso 3 — Conectar tu Gmail (solo lectura)

Este es el paso más largo (~10 minutos) porque hay que pasar por la consola de
Google Cloud. El agente te guía pantalla por pantalla: habilitar la API de
Gmail, crear un "cliente" de Google, y autorizar con tu cuenta.

Después, el agente abre el navegador, **vos le das permiso a la app para leer
tu Gmail** (te va a mostrar qué exactamente: solo lectura), y listo.

**Tu parte:** seguir las instrucciones de Google que te da el agente, y
autorizar cuando el navegador te lo pida.

> **Si querés hacerlo por tu cuenta**, o el agente no está a mano, seguí
> [oauth-para-humanos.md](oauth-para-humanos.md): son 46 pasos numerados, con
> el nombre exacto de cada botón y una verificación en cada pantalla. Está
> escrito para alguien que nunca programó.

> Es **solo lectura** — no puede enviar, modificar ni borrar correos. Y lo
> podés revocar cuando quieras desde tu cuenta de Google.

### Paso 4 — Traer tu historial

El agente corre la sincronización: el wallet **lee tus correos pasados del
banco** y arma tu historial. Esto puede tardar unos minutos (más si tenés
muchos meses de correos).

**Tu parte:** esperar y confirmar que entraron datos.

### Paso 5 — Armar tu perfil (la parte importante, donde vos ayudás)

Acá el agente **lee tu historial real** y te propone cosas. Es un diálogo:

1. **Tu nombre y tu sueldo.** Te muestra: "detecté estos depósitos de sueldo,
   ¿es tu empresa? ¿cobrás quincenal?" — vos confirmás o corregís. Esto es
   importante: sirve para que el wallet sepa cuáles de tus transferencias son
   entre tus propias cuentas (y no las cuente como gasto).

2. **Tus categorías de gasto.** El agente te va a mostrar los comercios donde
   más gastás, **uno por uno**, y te pregunta: "¿a qué categoría va esto?"
   Por ejemplo:
   - *"Supermaxi — ¿comida?"* → decís que sí
   - *"Farmacia Cruz Azul — ¿salud?"* → sí
   - *"Netflix — ¿suscripción?"* → sí
   
   **Tu parte:** responder qué es cada comercio. Son las preguntas más
   importantes — esto es lo que arma tu "patrón de gastos". No hay respuestas
   correctas o incorrectas; es **tu** clasificación.

3. **Tu colchón y tus topes.** El agente te muestra cuánto gastás al mes en
   promedio y te pregunta cuánto querés tener **guardado como colchón** (una
   recomendación común: 3 meses de gasto, pero es tu decisión) y si querés un
   **tope mensual** para transferencias.

---

## Después de configurarlo

Cuando el proceso termina, el wallet está listo. Para instalar y preparar el
dashboard, corré `npm run build` primero — sin eso `http://localhost:3000`
responde un error en vez de la pantalla:

```bash
npm run build    # la primera vez: prepara el dashboard
npm run dev
```

Y abrís **http://localhost:3000** en tu navegador: vas a ver tu dashboard
(saldo, gastos por categoría, días hasta tu próximo sueldo) y un chat donde le
podés preguntar cosas de tu historial.

**Cómo se actualiza** (cuando haya mejoras):

```bash
git pull
npm install
npm run build
```

Tus datos (`.env` y tu base de datos) están protegidos: una actualización
**nunca** toca tu información ni tus credenciales.

---

## Si algo sale mal

| Problema | Qué es |
|---|---|
| "No entraron transacciones" | Tu banco puede no tener parser todavía (ver abajo) o los correos no están en ese Gmail |
| "Gmail me pide autorizar cada semana" | Un detalle de configuración de Google que se arregla publicando la app |
| "Hay filas en 'revisar'" | Algunos correos no se leyeron con certeza; las revisás a mano en la web |

### ¿Tu banco no es Produbanco?

El wallet viene con soporte de ejemplo para **Produbanco** (Ecuador). Si tu
banco es otro, hace falta un trabajo técnico extra para que el wallet entienda
sus correos — no es que "no funcione", es que **no está hecho todavía**. El
agente te va a decir si es el caso. Ver [multibanco.md](multibanco.md) si sos
curioso.

---

## En una frase

**Vos solo necesitás:** tu Gmail, tu suscripción de Claude, un banco que te
mande correos, y ganas de responder "¿esto es comida o es otro gasto?" un par
de veces. El resto lo hace el agente.
