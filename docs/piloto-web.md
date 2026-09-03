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
navegador  ──HTTPS──>  proxy del borde (:443)  ──HTTP──>  server del wallet (127.0.0.1:3000)
                       cert automático                     WALLET_BIND_HOST=127.0.0.1
```

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
WALLET_SITE_ADDRESS=http://localhost:8080 WALLET_PORT=3000 \
  caddy run --config deploy/Caddyfile
```

Sin `WALLET_SITE_ADDRESS`, el sitio es `wallet.2.25.119.1.sslip.io` y Caddy
pide el certificado solo.

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
