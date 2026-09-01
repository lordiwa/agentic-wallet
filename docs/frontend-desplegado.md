# El dashboard publicado

**URL: <https://agentic-wallet-71314.web.app>** (Firebase Hosting, proyecto
`agentic-wallet-71314`).

Ese sitio arranca en **modo demostracion**: numeros inventados, y lo dice en
un cartel amarillo arriba de todo. No lleva adentro ni un dato tuyo. Este
documento explica por que, y como apuntarlo a tu ledger de verdad.

---

## El problema, sin vueltas

El frontend nunca tuvo una URL de backend que configurar: el server Express
sirve la SPA **y** la API en el mismo puerto, asi que `fetch("/api/overview")`
siempre daba en el blanco. Firebase Hosting sirve archivos estaticos y nada
mas — ahi `/api` no existe.

Y el server no se puede publicar tal cual:

- **La API no tiene autenticacion.** Ninguna. Quien llegue al puerto lee el
  historial bancario completo (`GET /api/transactions`), dispara lecturas de
  Gmail (`POST /api/sync`) y gasta credito de Claude (`POST /api/chat`).
- Por eso `WALLET_BIND_HOST=127.0.0.1` es el default y en este servidor se
  queda asi. Un tunel publico (ngrok, Cloudflare Tunnel) equivale a publicar
  el ledger: la URL es larga, pero no es un secreto ni un permiso.

## Las opciones que habia, y cual se tomo

| Opcion | Que pasaba | Veredicto |
|---|---|---|
| Tunel publico al server (ngrok/cloudflared) | Datos reales ya | **No.** API sin auth = ledger publico para quien tenga la URL |
| Hornear un snapshot del ledger en el bundle | Datos reales, sin backend | **No.** Publica movimientos bancarios en una URL abierta |
| Cloud Function como proxy | Mueve el problema | **No.** La Function sigue sin poder llegar al `127.0.0.1` del servidor |
| Sitio estatico con backend configurable + demo | UI publicable hoy, datos reales cuando haya un backend accesible | **Si** |

Lo que se publica es la **interfaz**, no los datos. Y la interfaz sabe
apuntarse a otro backend sin recompilar.

## Como elige el frontend de donde saca los datos

`web/src/api/base.ts`, en orden de mas explicito a menos:

1. **`?api=<url>` en la URL** — se guarda en el `localStorage` de ese
   navegador y queda. Es lo que permite reapuntar el sitio ya desplegado sin
   redeployar nada.
2. Lo guardado por una visita anterior.
3. `VITE_API_BASE_URL` del build (el sitio publicado trae `demo`, ver
   `web/.env.demo`).
4. Mismo origen — el caso local de siempre.

El valor especial `demo` no habla con ningun server: sirve respuestas locales
de `web/src/demo/demoFetch.ts`.

**La configuracion vive en el navegador de quien mira, no en el bundle.** El
artefacto publicado no contiene ninguna URL privada.

## Acceso: sin login, y por que esta bien

**Decision: el sitio es publico y no pide contrasena.**

No es pereza, es que hoy no hay nada que proteger ahi: el bundle publicado no
tiene datos, el modo demo es todo inventado, y la URL del backend la pone
quien mira en su propio navegador. Poner un login para custodiar datos falsos
seria teatro.

**Esto cambia el dia que el sitio apunte a datos reales.** Si el backend pasa
a ser accesible desde internet, el limite de acceso lo tiene que poner el
backend (autenticacion de verdad en la API), no el frontend — una pantalla de
login en la SPA no protege nada, porque la API se puede llamar directo con
`curl`. Mientras la API siga sin auth, el unico limite valido es de red:
`127.0.0.1` + tailnet.

## Como ver datos reales

El camino que no rompe nada:

1. **Hacer el server alcanzable en privado.** `tailscale serve 3000` proxea
   desde tu tailnet a `localhost:3000` sin abrir un solo puerto publico, y da
   una URL `https://<maquina>.<tailnet>.ts.net` con certificado valido. Solo
   la alcanzan los dispositivos de tu tailnet.
   *(A la fecha de este documento, este servidor no tiene Tailscale instalado.
   Es el paso que falta.)*

2. **Autorizar el origen del sitio en el server.** El navegador exige que la
   API declare quien puede leer su respuesta. En el `.env`:

   ```
   WALLET_ALLOWED_ORIGINS=https://agentic-wallet-71314.web.app
   ```

   Vacia por defecto: sin esto no se emite ninguna cabecera CORS y el server
   se comporta como siempre. Ver `server/src/api/cors.ts`. Ojo: **CORS no es
   autenticacion** — decide quien puede leer la respuesta desde un navegador,
   no quien puede llamar a la API. El limite real sigue siendo de red.

3. **Apuntar el sitio.** Abrir una sola vez:

   ```
   https://agentic-wallet-71314.web.app/?api=https://<maquina>.<tailnet>.ts.net
   ```

   Queda guardado. El cartel de arriba pasa de "MODO DEMOSTRACION" a
   "Datos de: <tu url> - conectado". Para volver a la demo: `?api=demo`.

Alternativa sin Tailscale, si el server corriera en la misma maquina desde la
que mirás: `?api=http://127.0.0.1:3000`. Los navegadores tratan `localhost` /
`127.0.0.1` como origen seguro, asi que una pagina HTTPS puede llamarlo sin
que salte el bloqueo de contenido mixto (Safari es la excepcion historica).

## Auto-refresco

El dashboard se actualiza solo cada **30 segundos** (`lib/refresh.tsx`).

- Es polling, no SSE: el unico stream del server es la respuesta del chat, no
  hay canal de eventos del ledger, y montar uno para un dashboard de un
  usuario seria infraestructura para un problema que un GET cada medio minuto
  ya resuelve.
- **Se para con la pestania oculta** y se pone al dia al volver, para que una
  pestania olvidada no pase el dia pegandole a la API.
- Terminar un sync fuerza un refresco inmediato: los datos que se acaban de
  escribir no esperan al proximo tick.
- La tabla de transacciones **no muestra spinner** en un refresco de fondo —
  vaciarla cada 30 segundos para volver a llenarla con las mismas filas es
  parpadeo, no informacion.

El estado del sync (`GET /api/sync/status`, componente `SyncStatus`) dice
cuando fue la ultima sincronizacion y si esta al dia:

| Estado | Que significa |
|---|---|
| **Al dia** | Ultimo sync hace menos de 24h |
| **Atrasado** | Mas de 24h sin leer el buzon |
| **Nunca se sincronizo** | No hay `sync_state`; no es lo mismo que "cero movimientos" |
| **Sincronizacion a medias** | Quedo un backlog sin drenar; dice cuantos correos faltan |

El umbral es 24h porque el ledger se alimenta de correos que llegan a lo largo
del dia y el sync se dispara a mano: pedirle frescura de minutos marcaria
"atrasado" el estado normal.

## Actualizar el sitio publicado

```bash
npm run deploy:hosting     # build del bundle demo + firebase deploy --only hosting
```

O en dos pasos:

```bash
npm run build:hosting                  # -> web/dist-demo
firebase deploy --only hosting
```

Dos detalles que importan:

- **`web/dist-demo` no es `web/dist`.** `web/dist` es el build que sirve el
  server local (base = mismo origen); `web/dist-demo` es el que va al hosting
  (base = `demo`, via `web/.env.demo`). Son dos artefactos distintos a
  proposito: publicar `web/dist` daria una pagina que le pega a un `/api` que
  en Firebase no existe, y todas las secciones mostrarian error.
- El deploy necesita `firebase login` y acceso al proyecto
  `agentic-wallet-71314` (ver `.firebaserc`).

## Que falta para que esto sea "el dashboard real"

En orden de importancia:

1. **Tailscale en el servidor** (`tailscale serve 3000`). Sin esto no hay
   forma segura de que un navegador de afuera llegue al ledger.
2. **Autenticacion en la API** si alguna vez tiene que salir del tailnet.
   Hasta entonces, `WALLET_BIND_HOST` se queda en `127.0.0.1`.
3. El sync sigue disparandose a mano (o por el scheduler del server). El
   dashboard refleja el estado; no lo provoca.
