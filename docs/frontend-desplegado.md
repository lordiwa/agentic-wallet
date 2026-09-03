# El panel publicado

**URL: <https://agentic-wallet-71314.web.app>** (Firebase Hosting, proyecto
`agentic-wallet-71314`).

Ese sitio **arranca pidiendo entrar con Google** (ver `docs/pivot-firebase.md`
§D.5), y quien no quiera entrar puede mirarlo igual: la puerta tiene una salida
al modo demostracion.

En **modo demostracion** son numeros inventados, y lo dice en
dos lugares fijos —el pie de la barra lateral ("Modo demostracion / Datos
inventados") y el chip de backend de arriba—. No lleva adentro ni un dato
tuyo. Este documento explica por que, y como apuntarlo a tu ledger de verdad.

> **Que se publica hoy: el panel del MVP** (`panel/`, Vue 3), no el dashboard
> viejo de `web/` ni la web de documentacion. El proyecto tiene **un solo**
> sitio de hosting, asi que publicar el panel reemplazo a los docs HTML que
> estaban ahi antes; las fuentes de esos docs siguen intactas en `docs/` y
> `docs-site/` (ver `docs-site/README.md` para volver a publicarlos).

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

`panel/src/api/base.ts` (y su gemelo `web/src/api/base.ts`), en orden de mas
explicito a menos:

1. **`?api=<url>` en la URL** — **previa confirmacion explicita**, y recien
   ahi se guarda en el `localStorage` de ese navegador. Es lo que permite
   reapuntar el sitio ya desplegado sin redeployar nada.
2. Lo guardado por una visita anterior.
3. `VITE_API_BASE_URL` del build (el sitio publicado trae `demo`, ver
   `panel/.env.demo`).
4. Mismo origen — el caso local de siempre.

El valor especial `demo` no habla con ningun server: sirve respuestas locales
de `panel/src/demo/demoFetch.ts`. Y como el orden es ese, el modo demo **gana
sobre `?api=`** en el sitio publicado: el parametro es una propuesta que hay
que confirmar a mano, no un cambio de fuente de datos.

**La configuracion vive en el navegador de quien mira, no en el bundle.** El
artefacto publicado no contiene ninguna URL privada.

### Por que `?api=` ahora pregunta (fase N0, TASK-054)

Hasta la fase N0, `?api=` se guardaba solo. Con `WALLET_ACCESS_TOKEN` la llave
del server viaja en la cabecera de cada llamada, y entonces un enlace
`https://<sitio>/?api=https://host-ajeno` alcanzaba para que el dashboard le
entregara esa llave a quien mando el enlace, con un solo click (riesgo **R1**).

Ahora son dos decisiones separadas, y ninguna es automatica:

- **a que backend le hablo** — `?api=` pide confirmacion antes de guardarse;
- **a que backend le doy la llave** — solo a los de la lista blanca
  (`web/src/api/origins.ts`, copiada en `panel/src/api/origins.ts`): el mismo
  origen, el loopback, lo que fije `VITE_WALLET_TRUSTED_API_ORIGINS` en el
  build, y lo que el usuario confirme a mano. A un backend fuera de la lista
  **se le habla igual, pero sin credencial** — un 401 que se explica es mejor
  que un 200 conseguido regalando la llave.

> **`VITE_API_BASE_URL` NO entra solo a la lista blanca.** Son dos variables
> distintas a propósito: una dice *a quien le hablo*, la otra *a quien le doy
> la llave*, y que la primera venga del build no prueba nada sobre la segunda.
> Si fijás el backend en el build y el server tiene `WALLET_ACCESS_TOKEN`,
> **poné el mismo origen en `VITE_WALLET_TRUSTED_API_ORIGINS`**. Sin eso el
> sitio llama sin credencial y la API responde 401 aunque la llave este
> cargada. Falla cerrado, que es lo correcto, pero es facil de diagnosticar
> mal: el chip del panel lo dice con todas las letras ("ese servidor no esta
> autorizado").

## Acceso: ahora si hay login, y por que cambio

**Hasta el pivot: el sitio era publico y no pedia nada.** No era pereza —no
habia nada que proteger: el bundle no tiene datos, el modo demo es todo
inventado, y la URL del backend la pone quien mira en su propio navegador.
Poner un login para custodiar datos falsos habria sido teatro.

**Lo que cambio es que ahora hay un backend de verdad detras.** Las Cloud
Functions del pivot (`gmailAuthStart`, `gmailAuthStatus`, ...) exigen un **ID
token de Firebase** y sirven el ledger de quien lo presenta. Eso es un dato
real y una credencial real, asi que el sitio publicado ahora **arranca en la
pantalla de entrar con Google** (ver `docs/pivot-firebase.md` §D.5).

Dos cosas que no cambiaron, y conviene tenerlas claras:

- **El limite de acceso lo sigue poniendo el backend, no esta pantalla.** Una
  puerta en la SPA no protege nada por si sola —la API se llama con `curl`—;
  lo que protege es que la funcion verifique el ID token y lea solo el ledger
  de ese uid. La pantalla es la forma de conseguir el token, no el candado.
- **El server viejo de `server/` sigue con su propia llave**
  (`WALLET_ACCESS_TOKEN`) y su propio limite de red (`127.0.0.1` + tailnet).
  Son dos credenciales distintas para dos backends distintos y no se mezclan:
  el panel local ni siquiera descarga el SDK de Firebase.

**Se puede mirar sin entrar.** La pantalla tiene una salida al modo
demostracion — el sitio tiene que poder mostrar que es antes de pedirle la
cuenta a nadie. Esa eleccion no se guarda: un F5 vuelve a la puerta.

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

   El navegador pregunta si guardar ese backend; al aceptar queda guardado y
   el cartel de arriba pasa de "MODO DEMOSTRACION" a "Datos de: <tu url> -
   conectado". Para volver a la demo: `?api=demo`.

   Si el server tiene `WALLET_ACCESS_TOKEN`, ademas hay que agregar ese origen
   a la lista blanca del build (`VITE_WALLET_TRUSTED_API_ORIGINS`) para que la
   llave pueda viajar hacia el. Sin eso el sitio le habla igual, pero sin
   credencial, y la API responde 401.

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
npm run build:hosting                  # -> panel/dist-demo
firebase deploy --only hosting
```

Dos detalles que importan:

- **`panel/dist-demo` no es `panel/dist`.** `panel/dist` es el build que sirve
  el server local (base = mismo origen); `panel/dist-demo` es el que va al
  hosting (base = `demo`, via `panel/.env.demo`). Son dos artefactos distintos
  a proposito: publicar `panel/dist` daria una pagina que le pega a un `/api`
  que en Firebase no existe, y las cuatro pantallas mostrarian error.
  (`npm run build:hosting:web` sigue existiendo para el dashboard viejo, pero
  ya no es lo que se publica.)
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
