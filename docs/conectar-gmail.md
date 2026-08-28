# Conectar Gmail (OAuth de solo lectura)

Agentic Wallet lee los correos de notificación de tu banco directamente desde
tu Gmail, en **solo lectura**. Esto se configura una sola vez.

Es el paso más largo del onboarding porque hay que pasar por la consola de
Google Cloud, pero son ~10 minutos y no se repite.

## Por qué hace falta

El asunto de un correo de consumo trae el monto, pero **el comercio va en el
cuerpo** del HTML. Sin acceso al cuerpo no hay forma de categorizar gastos.

Leer esos cuerpos vía un MCP de Gmail cuesta ~2.000 tokens por correo — para
tres meses de historial son cientos de miles de tokens **cada vez** que
sincronices. Con acceso local es un comando, gratis y repetible.

## Alcance y seguridad

- **Scope único: `https://www.googleapis.com/auth/gmail.readonly`.** Solo
  lectura. No hay forma de enviar, modificar ni borrar correo.
- El cliente OAuth es de tipo **Desktop app**: el `client_secret` vive sólo en
  tu `.env` local, que está en `.gitignore`.
- Las búsquedas filtran por remitente (los `gmailSenders` de los parsers
  registrados). Ninguna otra parte de tu bandeja se toca.
- Revocás el acceso cuando quieras en
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).

## Configuración en Google Cloud Console

Creá (o elegí) un proyecto en
[console.cloud.google.com](https://console.cloud.google.com).

| Paso | Dónde | Qué hacer |
|---|---|---|
| 1 | APIs & Services → Library | Buscar **Gmail API** → *Enable* |
| 2 | Google Auth Platform → Overview → *Get started* | App name (el que quieras), support email: tu correo |
| 3 | ídem, Audience | **External** |
| 4 | ídem, Contact Information | Tu correo |
| 5 | ídem, Finish | Aceptar la *User Data Policy* → **Create** |
| 6 | Data Access → *Add or remove scopes* | Marcar `.../auth/gmail.readonly` → *Update* → **Save** |
| 7 | Clients → *Create client* | Application type **Desktop app** → **Create** |
| 8 | Audience → Publishing status | **Publish app** → *Confirm* |

Del paso 7 salen el **Client ID** y el **Client secret**. El secret se muestra
una sola vez, en el diálogo de creación: copialo ahí mismo.

### El paso 8 no es opcional

Con la app en estado **Testing**, Google **caduca el refresh token a los 7
días** — tendrías que reautorizar cada semana. En **In production** no expira.

La app queda *sin verificar*, y está bien: la verificación es un trámite para
apps que distribuís a terceros, no para una que usás vos con tu propia cuenta.

- Al autorizar vas a ver **"Google hasn't verified this app"**. Se pasa con
  *Advanced → Go to (nombre de tu app) (unsafe)*. Es esperado.
- La consola muestra un aviso de *"Your app requires verification"*. No hay
  nada que hacer: sólo aplica si publicás la app para otros usuarios.

## Poner las credenciales

En tu `.env`:

```
GMAIL_OAUTH_CLIENT_ID=<el client id del paso 7>
GMAIL_OAUTH_CLIENT_SECRET=<el client secret del paso 7>
```

## Generar el refresh token

```bash
npm run gmail-auth
```

El script:

1. Imprime una URL de autorización. Abrila en el navegador.
2. Elegí tu cuenta y aceptá el permiso de lectura (pasando por la pantalla de
   "app sin verificar").
3. Google redirige a `localhost`; el script captura el código y lo canjea.
4. Imprime el **refresh token**.

Ponelo en `.env`:

```
GMAIL_OAUTH_REFRESH_TOKEN=<el token>
```

Verificá que quedó:

```bash
npm run onboard -- --status   # el paso `gmail` debe estar en done: true
```

## Primer sync

```bash
npm run dev
curl -X POST localhost:3000/api/sync
```

La primera vez puede tardar varios minutos: trae todo el historial disponible.
Las siguientes son incrementales (sólo desde el último sync).

## Problemas comunes

| Síntoma | Qué pasa |
|---|---|
| `invalid_grant` al sincronizar | El refresh token caducó: la app quedó en *Testing*. Publicala (paso 8) y regenerá el token |
| El sync trae 0 transacciones | Tu banco no es Produbanco → ver [multibanco.md](multibanco.md); o los correos no están en esa cuenta |
| `access_denied` al autorizar | No pasaste por *Advanced → Go to ... (unsafe)*, o falta el scope del paso 6 |
| El navegador no abre | Copiá la URL que imprimió el script y pegala a mano |

## Revocar

En [myaccount.google.com/permissions](https://myaccount.google.com/permissions),
buscá tu app y *Remove access*. Después borrá las tres variables
`GMAIL_OAUTH_*` de tu `.env`.
