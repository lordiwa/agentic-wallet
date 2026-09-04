# Exponer el wallet en la web (piloto)

> Este documento es el que `server/src/index.ts` cita en sus avisos de
> arranque. Existe desde la Fase 0 del pivot a SaaS (`docs/pivot-saas.md`, P25).

El server del wallet habla **HTTP plano** y escucha en `127.0.0.1`. Eso está
bien para el uso local y no alcanza para el piloto: el `redirect_uri` del OAuth
de Google no acepta ni `http://` ni una IP pelada, así que sin un dominio con
TLS **no hay onboarding web**.

Este documento es el procedimiento para ponerlo detrás de un proxy con HTTPS,
qué se verificó de verdad y qué quedó bloqueado.

---

## 1. Las tres piezas

```
navegador  ──HTTPS──>  proxy del borde (:443)  ──HTTP──>  server del wallet (127.0.0.1:3010)
                       cert automático                     WALLET_BIND_HOST=127.0.0.1
```

El server del piloto escucha en el **3010**, no en el 3000: en esta VPS el 3000
lo ocupa el server viejo de `iwa-wallet`, que no se toca.

Hoy corre con `nohup` (log en `/opt/data/logs/wallet-server.log`) porque acá no
hay systemd — el PID 1 es `s6-svscan`. Eso significa que **no sobrevive a un
reinicio**: `deploy/wallet.service` existe para cuando haya un host donde
instalarlo (§5).

| Pieza | Archivo | Estado |
|---|---|---|
| Proxy con auto-HTTPS (Caddy) | `deploy/Caddyfile` | Escrito y **probado** (§4) |
| Proxy con auto-HTTPS (Traefik) | `deploy/traefik-wallet.yml` | Escrito, sin probar — necesita acceso al host |
| El server como servicio | `deploy/wallet.service` | Escrito, sin instalar — necesita root en el host |

Hay dos archivos de proxy porque **esta VPS ya tiene Traefik en el puerto 443**
(§5). Si el borde es de Traefik, se usa el segundo; el Caddyfile queda para una
máquina donde el 443 esté libre.

---

## 2. El dominio: sslip.io

El piloto usa `https://wallet.2.25.119.1.sslip.io`.

sslip.io resuelve cualquier nombre con la forma `<lo-que-sea>.1.2.3.4.sslip.io`
a la IP `1.2.3.4`. Verificado:

```
$ getent hosts wallet.2.25.119.1.sslip.io
2.25.119.1      wallet.2.25.119.1.sslip.io
```

Eso da un hostname público real — y por lo tanto un certificado de Let's
Encrypt real — sin comprar un dominio. Es la **opción 1** de la decisión D5 del
pivot: sirve para dejar el piloto armado, y migrar a un dominio propio después
es cambiar una línea del proxy y el `redirect_uri` en la consola de Google.

Lo que sslip.io **no** arregla: sigue haciendo falta que el puerto 443 de esa
IP lo atienda un proceso nuestro (§5).

---

## 3. El `.env` del server expuesto

Las cuatro variables que dejan de ser opcionales cuando el server sale a la
web. Ninguna tiene default activo a propósito: se encienden con la misma
decisión que abre el puerto.

| Variable | Valor para el piloto | Por qué |
|---|---|---|
| `WALLET_BIND_HOST` | `127.0.0.1` | **No se cambia.** El proxy llega por loopback; abrir el bind expone el puerto sin TLS |
| `WALLET_ACCESS_TOKEN` | 32 bytes al azar (`openssl rand -hex 32`) | Sin esto la API no pide llave. `GET /api/health` queda abierto a propósito |
| `WALLET_ALLOWED_ORIGINS` | el origen del panel publicado | Sin esto no hay cabecera CORS y sólo funciona el panel que sirve el propio server |
| `WALLET_RATE_LIMIT_RPS` | un número > 0 | Sin tope, adivinar la llave es gratis |
| `WALLET_TRUST_PROXY` | `true` | **Sólo** con el proxy como único camino al puerto. Si no, cualquiera elige su IP |

El server avisa por consola al arrancar si el bind no es loopback y le falta
alguna de estas (`server/src/index.ts`). Ese aviso es la red de seguridad, no
el procedimiento.

> `WALLET_TRUST_PROXY=true` sin proxy delante es **peor** que no limitar: la IP
> del cubo la elige el cliente por `X-Forwarded-For`, y con eso se saca un cubo
> nuevo por petición. Con `false` detrás de un proxy, todas las peticiones son
> `127.0.0.1` y el limitador es global — el primer atacante deja fuera a todos.
> Las dos mitades tienen que ir juntas.

---

## 4. Caddy: lo que se verificó de verdad

`deploy/Caddyfile` no es un ejemplo copiado: se levantó y se probó contra el
server real de este repo. Lo que se comprobó, y cómo:

**Configuración válida.**

```
$ caddy validate --config deploy/Caddyfile
Valid configuration
```

**El proxy pasa la autenticación tal cual.** Con el server en `127.0.0.1:3010`
y Caddy delante en modo HTTP local:

| Petición | Directo | Por Caddy |
|---|---|---|
| `GET /api/health` | 200 | **200** |
| `GET /api/overview` sin llave | 401 | **401** |
| `GET /api/overview` con la llave | 200 | **200** |
| `GET /api/overview` con una llave inventada | 401 | **401** |

Y el cuerpo de `health` responde `{"status":"ok","auth_required":true,
"authenticated":false}` — o sea que el server sabe que tiene llave puesta.

**El SSE no se buferea.** Es el requisito que `docs/pivot-saas.md` §3.1 marca
como obligatorio: `POST /api/chat` es `text/event-stream` y el panel lo lee
token a token. Contra un emisor que manda un evento cada 700 ms:

```
+ 750ms  <-  data: … evento-1
+1447ms  <-  data: … evento-2
+2151ms  <-  data: … evento-3
+2856ms  <-  data: … evento-4
```

Los eventos llegan **a medida que se producen**, no todos juntos al final. Y
`content-encoding: null` confirma que el `encode` no agarró el stream — por eso
la lista de tipos comprimibles del Caddyfile es explícita en vez de `text/*`,
que se tragaría el `text/event-stream`.

Cómo reproducirlo (el nombre del sitio es un parámetro justamente para esto):

```
WALLET_SITE_ADDRESS=http://localhost:8080 WALLET_PORT=3010 \
  caddy run --config deploy/Caddyfile
```

Sin `WALLET_SITE_ADDRESS`, el sitio es `wallet.2.25.119.1.sslip.io` y Caddy
pide el certificado solo.

**La cadena completa, sobre TLS.** Con Caddy en el 8443 y el server en el 3010
(cert de la CA interna de Caddy, ver `WALLET_LOCAL_CERTS` en §5), resolviendo
el nombre a loopback para no salir a internet:

```
$ curl -k --resolve wallet.2.25.119.1.sslip.io:8443:127.0.0.1 \
    https://wallet.2.25.119.1.sslip.io:8443/api/health
{"status":"ok","auth_required":true,"authenticated":false}
```

| Petición por Caddy sobre HTTPS | Código |
|---|---|
| `GET /api/health` sin llave | **200** |
| `GET /api/transactions` sin llave | **401** |
| `GET /api/transactions` con la llave | **200** |

**El CORS refleja la lista blanca, no la copia.** Con
`WALLET_ALLOWED_ORIGINS=https://agentic-wallet-71314.web.app`:

| `Origin` de la petición | `Access-Control-Allow-Origin` |
|---|---|
| `https://agentic-wallet-71314.web.app` | el mismo origen, y `Vary: Origin` |
| `https://atacante.example` | **ausente** — el navegador corta la respuesta |

El preflight `OPTIONS` responde `204` con `Allow-Methods: GET, POST, DELETE,
OPTIONS` y `Allow-Headers: Content-Type, Authorization`.

---

## 5. Lo que quedó bloqueado, y por qué

**El HTTPS público no se pudo levantar.** No es un problema de configuración
del wallet: es de quién es el dueño del puerto 443 de esa IP y de qué permisos
tiene el entorno donde se ejecutó la Fase 0.

Lo verificado, en orden:

1. **La IP es la VPS correcta.** El PTR de `2.25.119.1` es
   `srv1932491.hstgr.cloud` (Hostinger), y la salida a internet de esta máquina
   sale por esa misma IP.
2. **El puerto 443 ya está ocupado por Traefik.** El certificado que presenta
   `2.25.119.1:443` es `CN=TRAEFIK DEFAULT CERT`, y responde `404 page not
   found` a cualquier `Host` que no tenga en su tabla — incluido
   `wallet.2.25.119.1.sslip.io`. El 80 devuelve un `308` a HTTPS.
3. **Este entorno no llega a ese puerto.** Un servidor de prueba escuchando en
   `0.0.0.0:80` acá dentro **no** recibe las peticiones que van a
   `http://2.25.119.1/`: las contesta el Traefik del host. Son espacios de red
   distintos.
4. **No hay con qué instalarlo.** El PID 1 de este entorno es `s6-svscan`, no
   systemd; no hay `systemctl`, no hay `sudo` y el usuario no es root.

Consecuencia: **poner Caddy en el 443 significaría sacárselo a Traefik**, que
es tumbar lo que sea que ese Traefik esté sirviendo hoy. Eso no es una decisión
que se toma de paso en una Fase 0.

### Por qué el puerto 8443 tampoco alcanza

La salida obvia al 443 ocupado es mover el sitio a un puerto libre: Google
acepta un `redirect_uri` con puerto no estándar, así que
`https://wallet.2.25.119.1.sslip.io:8443` parecía dejar el piloto armado sin
tocar a Traefik. **Se intentó y no funciona**, por dos razones independientes —
cualquiera de las dos alcanza para bloquearlo.

**1. Let's Encrypt no valida en el 8443.** ACME comprueba el dominio contra
puertos fijos, no contra el puerto donde vive el sitio: `http-01` va al **80** y
`tls-alpn-01` va al **443**. Con Caddy escuchando en el 8443, los dos desafíos
salieron igual hacia el borde de Traefik y fallaron:

```
challenge_type: tls-alpn-01
  detail: "2.25.119.1: remote error: tls: unrecognized name"

challenge_type: http-01
  detail: "2.25.119.1: Invalid response from
           http://wallet.2.25.119.1.sslip.io/.well-known/acme-challenge/…: 404"
```

El `unrecognized name` y el `404` son la firma de Traefik contestando por un
`Host` que no tiene en su tabla — exactamente lo mismo que se ve con `curl`
desde afuera. O sea: **el puerto del sitio no cambia dónde valida ACME**. No hay
configuración de Caddy que evite esto; la única salida sin el 80/443 sería el
desafío `dns-01`, y sslip.io no da control del DNS para poner el registro `TXT`.

**2. El 8443 no está publicado.** Aun con un certificado, no habría a dónde
llegar: un servidor de prueba escuchando en `0.0.0.0:8443` acá dentro responde
por loopback pero rechaza la conexión desde la IP pública.

```
$ curl https://wallet.2.25.119.1.sslip.io:8443/api/health
Failed to connect to wallet.2.25.119.1.sslip.io port 8443: Could not connect
```

Es el mismo hallazgo del punto 3 de arriba: los puertos de este entorno no son
los puertos del host. Publicar el 8443 requiere el mismo acceso al host que
haría falta para configurar Traefik — con la diferencia de que por Traefik el
certificado sale gratis y por el 8443 seguiría sin salir.

De paso quedó probado que **la VPS sí es alcanzable desde internet**: Let's
Encrypt llegó a su 80 y a su 443 desde afuera. Lo que no es alcanzable es este
entorno.

> Para poder probar la cadena sobre TLS igual, el Caddyfile acepta
> `WALLET_LOCAL_CERTS=local_certs`, que firma con la CA interna de Caddy. Sirve
> para verificar el proxy de punta a punta (§4) y **no** sirve para un navegador
> ni para el panel en Firebase: ese certificado no lo confía nadie. El default
> del archivo sigue siendo ACME real.

Así quedó levantado en esta VPS, que es lo más cerca del piloto que se puede
llegar sin acceso al host:

```
WALLET_SITE_ADDRESS=https://wallet.2.25.119.1.sslip.io:8443 \
WALLET_PORT=3010 \
WALLET_LOCAL_CERTS=local_certs \
WALLET_AUTO_HTTPS="auto_https disable_redirects" \
  caddy run --config deploy/Caddyfile
```

Las dos últimas variables son las que **no** hacen falta en la máquina destino:
ahí el certificado lo emite Let's Encrypt y el redirect del 80 se quiere. Los
defaults del archivo son los de esa máquina, no los de esta.

### Cómo se desbloquea (30 minutos, con acceso al host)

El camino recomendado es el que **no** toca lo que ya funciona:

1. Copiar `deploy/traefik-wallet.yml` al directorio dinámico del Traefik del
   host (típicamente `/etc/traefik/dynamic/`) y completar los dos `TODO`: el
   nombre del `certResolver` ACME que ese Traefik ya usa, y la dirección real
   del server del wallet **vista desde Traefik** (si el wallet corre en un
   contenedor, `127.0.0.1` apunta a Traefik, no al wallet: es el error típico).
2. Instalar `deploy/wallet.service` y arrancarlo (`systemctl enable --now
   wallet`), para que el server sobreviva a un reinicio.
3. Verificar:

```
curl -s -o /dev/null -w "%{http_code}\n" https://wallet.2.25.119.1.sslip.io/api/health
# esperado: 200

curl -s -o /dev/null -w "%{http_code}\n" https://wallet.2.25.119.1.sslip.io/api/overview
# esperado: 401  (sin llave)
```

El camino alternativo —Caddy en el borde— sólo tiene sentido si el wallet se
muda a una máquina donde el 443 esté libre. Su configuración ya está probada.

---

## 6. Después de esto

Con el HTTPS arriba, el `redirect_uri` de OAuth pasa a ser
`https://wallet.2.25.119.1.sslip.io/api/gmail/callback` y hay que registrarlo
en la consola de Google Cloud. Eso ya es Fase 3 del pivot
(`docs/pivot-saas.md` §5), no Fase 0.

---

## 7. Cómo quedó de verdad: el borde es Firebase, y Gmail ya está cableado

Lo de arriba (§1–§6) es el camino de Caddy en una VPS, que quedó bloqueado por
el 443 ajeno. **El borde público terminó siendo Firebase Hosting + Cloud
Functions** (`docs/pivot-firebase.md`), y ahí el `redirect_uri` no es el de
sslip.io sino el de la función:

```
https://us-central1-agentic-wallet-71314.cloudfunctions.net/gmailAuthCallback
```

Esta sección es el estado **verificado contra producción** de esa conexión, no
el procedimiento. El procedimiento y el diseño están en `pivot-firebase.md`
§D.7; el flujo viejo de escritorio, en `conectar-gmail.md`.

### Qué está puesto y comprobado

| Pieza | Estado |
|---|---|
| Secreto `WALLET_TOKEN_KEK` | Secret Manager, versión 1 `ENABLED`. Decodifica a **32 bytes** exactos, que es lo que exige `masterKeyFromEnv` |
| Secreto `WALLET_GMAIL_CLIENT_SECRET` | Secret Manager, versión 1 `ENABLED`. Idéntico al del cliente "Bolsillo-web-client"; sin espacios ni salto de línea al final |
| Montaje de los secretos | `gmailAuthStart`, `gmailAuthCallback` e `ingest` los declaran y los reciben en la versión 1. `gmailAuthStatus`, `api`, `overview` y `health` **no** los tienen — el mínimo privilegio de `index.ts` es real, no sólo una intención |
| Variables públicas | `WALLET_GMAIL_CLIENT_ID`, `WALLET_OAUTH_REDIRECT_URI` y `WALLET_PANEL_ORIGIN` están en las siete funciones, con los valores de `functions/.env.agentic-wallet-71314` |
| El par client_id/client_secret | **Válido para Google.** Un canje con un `code` inventado devuelve `invalid_grant` (400), no `invalid_client` (401): Google reconoce las credenciales y lo único que rechaza es el código |
| La URL de consentimiento | Google la contesta con un `302` a su pantalla de login. Ni `redirect_uri_mismatch` ni `deleted_client`: la redirect URI está registrada byte por byte |
| `gmail.googleapis.com` | `ENABLED` en el proyecto **855144098021**, que es el dueño del cliente OAuth y por lo tanto el que cuenta para la cuota |

### El flujo, extremo a extremo, sin navegador

Con un ID token real del uid del piloto (firmado con ADC vía
`iamcredentials.signJwt` sobre la SA `firebase-adminsdk-fbsvc`, que es la única
forma de conseguir uno sin navegador):

```
GET  /gmailAuthStatus   sin token  →  401 {"error":"sin_token"}
GET  /gmailAuthStatus   con token  →  200 {"conectado":false,"email":null,...}
POST /gmailAuthStart    sin token  →  401 {"error":"sin_token"}
POST /gmailAuthStart    con token  →  200 {authUrl,...}
        → accounts.google.com/o/oauth2/v2/auth
        → scope=gmail.readonly, access_type=offline, prompt=consent
GET  /gmailAuthCallback sin params           →  302 ?gmail=state_invalido
GET  /gmailAuthCallback ?error=access_denied →  302 ?gmail=cancelado
GET  /gmailAuthCallback state real + code falso →  302 ?gmail=google_rechazo
```

**El último renglón es la prueba que importa.** `google_rechazo` está detrás de
tres puertas que sólo se abren con los secretos cargados: `cargarConfig()` tuvo
que encontrar el `client_secret` y una KEK de 32 bytes (si falta cualquiera de
los dos tira `falta la variable ...` y la función responde 500, no un 302);
`canjearState()` tuvo que **descifrar** con la KEK el state que `gmailAuthStart`
había **cifrado** con ella minutos antes —o sea, la clave maestra hace el viaje
de ida y vuelta contra Firestore—; y recién entonces `canjearCode()` habló con
Google, que rechazó el código inventado. Lo que falla ahí es el código de
prueba, nunca la configuración.

Dicho de otro modo: **no falta ninguna credencial de Gmail en el server.** Lo
que falta es el consentimiento del humano, que por definición no se puede
automatizar.

### Lo único que queda, y es de Mato

1. Abrir el panel: `https://agentic-wallet-71314.web.app`.
2. Entrar con Google (la misma cuenta cuyo Gmail se va a leer).
3. Tocar **Conectar Gmail** → se abre `accounts.google.com`.
4. Autorizar el permiso de **solo lectura** de Gmail.
5. Google vuelve a `/#/conectado`; a partir de ahí `gmailAuthStatus` pasa a
   `{"conectado":true,"email":"..."}` y la ingesta tiene con qué correr.

Dos cosas que pueden salir mal en ese paso, las dos en la consola de Google y
ninguna verificable desde acá:

- **La pantalla de consentimiento es External/Testing.** Sólo autoriza a las
  cuentas que estén en la lista de *Test users*. Si aparece "Acceso bloqueado:
  … no ha completado el proceso de verificación", es eso: hay que agregar el
  correo a esa lista. La lista no se puede leer por API —ver
  `oauth-para-humanos.md`—, así que se comprueba entrando.
- **En Testing, el refresh token dura 7 días.** Cuando caduca, el panel muestra
  `necesitaReconectar` y hay que repetir los cinco pasos. Se arregla publicando
  la app, no tocando código.

Y una tercera, improbable pero fácil de reconocer si pasa: si la primera
ingesta devuelve un 403 que menciona *"Gmail API has not been used in project
743241056894"*, es que la cuota se está contando contra el proyecto de Firebase
y no contra el del cliente OAuth; se destraba habilitando `gmail.googleapis.com`
también ahí. El error dice el número de proyecto, así que no hay que adivinar.

### La copia de la KEK

`WALLET_TOKEN_KEK` está respaldada **fuera del repo**, en
`/opt/data/backups/wallet-keys/` con permisos `0600`. No es opcional: esa clave
cifra los refresh tokens guardados en Firestore, y perderla no rompe el
servicio de inmediato —rompe la posibilidad de descifrar lo ya guardado, y
obliga a que cada usuario vuelva a dar consentimiento.
