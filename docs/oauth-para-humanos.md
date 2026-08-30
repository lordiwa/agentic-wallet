# Darle permiso a tu Gmail — guía para no técnicos

Esta guía es para **vos**, la persona que va a usar el wallet, aunque nunca
hayas programado nada en tu vida.

Es el único tramo de la instalación que **no se puede automatizar**: hay que
entrar a una página de Google con tu cuenta y hacer unos clics. Nadie lo puede
hacer por vos, porque hay que entrar con tu usuario y tu clave.

**Tiempo:** 15 a 25 minutos, una sola vez. Nunca más.

> **¿Preferís la versión corta y técnica?** Está en
> [conectar-gmail.md](conectar-gmail.md). Esta guía de acá es la misma cosa,
> pero explicada pantalla por pantalla.

---

## Qué vamos a hacer, en una frase

Le vamos a decir a Google: *"dale permiso a este programa que corre en mi
computadora para **leer** los correos de mi banco"*.

Al final vas a tener **tres códigos** que se pegan en un archivo del wallet.
Eso es todo.

**Los tres códigos son:**

| | Cómo se llama | De dónde sale |
|---|---|---|
| 1 | Client ID (identificador) | Lo crea Google en el Paso 27 |
| 2 | Client secret (clave) | Lo crea Google en el Paso 27 |
| 3 | Refresh token (permiso) | Lo genera tu propia computadora en el Paso 43 |

---

## Antes de empezar

Tené esto a mano. Si te falta alguno, conseguilo primero:

- [ ] **Tu cuenta de Gmail** — la que recibe los avisos de tu banco. Vas a
      tener que entrar con esa cuenta, no con otra.
- [ ] **El wallet ya instalado** en tu computadora. (En Windows: ya hiciste
      doble clic en `setup.bat`. Si no, hacelo primero.)
- [ ] **Un lugar donde pegar textos largos** mientras tanto: el Bloc de notas,
      Notas, un WhatsApp a vos mismo. Vas a copiar dos códigos y no los podés
      perder.
- [ ] **20 minutos sin que te interrumpan.** No es difícil, pero si cortás a la
      mitad tenés que volver a encontrar dónde estabas.

### Tres cosas que conviene saber antes

**1. Vas a ver palabras raras.** "API", "OAuth", "scope", "credencial". No
hace falta que entiendas ninguna. Al final de esta guía hay un
[diccionario](#diccionario-de-palabras-raras) si te da curiosidad, pero
podés hacer todo sin leerlo.

**2. La página de Google puede estar en inglés o en español**, y cambia según
el día. Por eso en cada paso te pongo **los dos nombres del botón**, así:
*Create* / *Crear*. Buscá el que veas.

**3. Google va a decirte que la app "no está verificada".** Eso es
**normal y esperado**. Es tu propia app, para vos, en tu computadora. La
verificación es un trámite para programas que se distribuyen a miles de
personas. En el Paso 40 te explico exactamente qué botón tocar cuando aparezca
esa advertencia.

---

# PARTE 1 — Entrar y crear tu proyecto

## Paso 1 — Abrí la página de Google Cloud

Abrí tu navegador y andá a:

```
https://console.cloud.google.com
```

Copiá y pegá esa dirección, no la escribas a mano.

**✅ Lo hiciste bien si:** ves una página con fondo blanco o gris que dice
*Google Cloud* arriba a la izquierda.

**⚠️ Si te pide iniciar sesión:** entrá con tu cuenta de Gmail — **la misma
donde llegan los correos del banco**. Es importantísimo: si entrás con otra
cuenta, el wallet después no va a encontrar ningún correo.

**⚠️ Si te aparece un formulario que pide país y aceptar términos:** elegí tu
país, marcá la casilla de aceptar, y dale a *Agree and continue* / *Aceptar y
continuar*. Es la primera vez que entrás a Google Cloud, nada más.

**⚠️ Si te pide una tarjeta de crédito o hablar de "facturación" / "billing":**
**no la pongas.** Nada de lo que vamos a hacer cuesta plata. Si ves un botón
*Activate free trial* / *Activar prueba gratis*, ignoralo y cerralo con la X.

[CAPTURA 01 — la pantalla inicial de Google Cloud Console, recién entrado,
señalando dónde dice "Google Cloud" arriba a la izquierda]

---

## Paso 2 — Encontrá el selector de proyecto

Arriba de todo, al lado de donde dice *Google Cloud*, hay un botón. Puede
decir *Select a project* / *Seleccionar un proyecto*, o puede tener el nombre
de algún proyecto que ya exista.

Es un botón con un triangulito ▾ al lado.

**Hacé clic ahí.**

[CAPTURA 02 — la barra superior, con una flecha señalando el selector de
proyecto al lado del logo]

**✅ Lo hiciste bien si:** se abrió una ventanita con una lista (puede estar
vacía) y arriba a la derecha un botón que dice *New project* / *Proyecto
nuevo*.

---

## Paso 3 — Creá un proyecto nuevo

En esa ventanita, hacé clic en **_New project_ / _Proyecto nuevo_**
(arriba a la derecha).

**✅ Lo hiciste bien si:** ahora ves un formulario con un campo que dice
*Project name* / *Nombre del proyecto*.

**⚠️ Si no ves el botón _New project_:** cerrá la ventanita (tecla `Esc`) y
volvé al **Paso 2**. A veces hay que hacer clic exactamente sobre el texto.

---

## Paso 4 — Ponele nombre y creá

En *Project name* / *Nombre del proyecto*, escribí exactamente esto:

```
mi-wallet
```

(Podés poner el nombre que quieras. `mi-wallet` es corto y se reconoce fácil
después. No uses espacios ni tildes.)

Debajo puede haber un campo *Location* / *Ubicación* que diga *No organization*
/ *Sin organización*. **Dejalo como está, no lo toques.**

Hacé clic en **_Create_ / _Crear_**.

[CAPTURA 03 — el formulario de proyecto nuevo con "mi-wallet" escrito en el
campo de nombre y el botón Create resaltado]

**✅ Lo hiciste bien si:** aparece un cartelito de "creando..." y después de
unos segundos volvés a la pantalla principal.

---

## Paso 5 — Asegurate de estar parado en tu proyecto

Esto es **el error más común de toda la guía**. Prestá atención 10 segundos.

Mirá otra vez arriba, al lado de *Google Cloud*. **Tiene que decir
`mi-wallet`** (o el nombre que le hayas puesto).

**✅ Si dice `mi-wallet`:** perfecto, seguí al Paso 6.

**⚠️ Si dice otra cosa o sigue diciendo _Select a project_:** hacé clic ahí,
buscá `mi-wallet` en la lista, y hacé clic sobre él. Puede que tengas que
mirar en la pestaña *All* / *Todos*.

[CAPTURA 04 — la barra superior mostrando "mi-wallet" como proyecto activo]

> **Por qué importa tanto:** todo lo que hagas de acá en adelante se guarda
> *dentro* del proyecto que esté seleccionado arriba. Si estás parado en otro,
> vas a hacer bien los pasos pero en el lugar equivocado, y al final nada va a
> funcionar. Cada vez que la guía te diga "verificá el proyecto", volvé a mirar
> esa barra.

---

# PARTE 2 — Prender el acceso a Gmail

Google tiene cientos de servicios apagados por defecto. Hay que prender el de
Gmail.

## Paso 6 — Andá al buscador de servicios

Arriba, en el medio de la pantalla, hay una **barra de búsqueda** con una lupa
🔍. Dice algo como *Search (/) for resources, docs, products...* / *Buscar
recursos, documentos, productos...*.

Hacé clic ahí y escribí exactamente:

```
Gmail API
```

**No aprietes Enter todavía.** Van a ir apareciendo resultados solos, debajo.

[CAPTURA 05 — la barra de búsqueda con "Gmail API" escrito y la lista de
sugerencias desplegada]

---

## Paso 7 — Elegí el resultado correcto

En la lista que apareció, buscá el que diga exactamente:

> **Gmail API** — y debajo, en gris, algo como *Marketplace product* o *API*

Hacé clic en ese.

**⚠️ Ojo:** puede haber varios resultados parecidos (*Gmail Add-ons*, *Gmail
Postmaster*...). Vos querés el que dice **solo "Gmail API"**, sin nada más.

**✅ Lo hiciste bien si:** se abrió una página con el logo de Gmail (el sobre
rojo y blanco), el título *Gmail API*, y un botón azul grande.

**⚠️ Si aterrizaste en una página de documentación llena de texto en inglés
sobre programación:** ese es el lugar equivocado. Volvé atrás con la flecha ←
del navegador y repetí el **Paso 6**.

---

## Paso 8 — Prendela

El botón azul grande dice **_Enable_ / _Habilitar_**.

Hacé clic ahí.

[CAPTURA 06 — la página de la Gmail API con el botón azul "Enable" resaltado]

Puede tardar 10 o 20 segundos. Dejalo trabajar.

---

## Paso 9 — Verificá que quedó prendida

**✅ Lo hiciste bien si:** ahora la página cambió. Donde antes había un botón
azul *Enable*, ahora ves algo como *API enabled* / *API habilitada*, o un
botón que dice **_Manage_ / _Administrar_**, o un tablero con gráficos vacíos.

**⚠️ Si seguís viendo el botón azul _Enable_:** no se prendió. Hacé clic otra
vez y esperá.

**⚠️ Si te dice que hace falta seleccionar un proyecto:** volvé al **Paso 5**,
seleccioná `mi-wallet`, y volvé a hacer el Paso 6.

> **Ya está.** El resto de la guía es sobre *permisos*: quién puede usar esto
> y para qué.

---

# PARTE 3 — Configurar la pantalla de permiso

Cuando al final le des permiso a tu wallet, Google te va a mostrar una
pantalla que dice "tal app quiere leer tu Gmail, ¿aceptás?". Esa pantalla hay
que armarla ahora.

## Paso 10 — Andá a la sección de permisos

Volvé a la **barra de búsqueda** de arriba (la de la lupa 🔍) y escribí:

```
Google Auth Platform
```

Hacé clic en el resultado que diga **Google Auth Platform**.

**⚠️ Si no aparece nada con ese nombre**, probá buscando:

```
OAuth consent screen
```

Es el nombre viejo de la misma sección. Google le cambió el nombre en 2024 y
según el día podés ver uno u otro.

[CAPTURA 07 — el resultado de búsqueda "Google Auth Platform" en la barra]

---

## Paso 11 — Empezá la configuración

**✅ Si ves una pantalla con un botón que dice _Get started_ / _Comenzar_:**
hacé clic ahí y seguí al Paso 12.

**⚠️ Si en cambio ya ves un menú a la izquierda con opciones llamadas
_Branding_, _Audience_, _Clients_, _Data Access_:** significa que esto ya
estaba configurado antes. **Saltá directo al [Paso 17](#paso-17--abrí-el-acceso-a-datos).**

[CAPTURA 08 — la pantalla de bienvenida de Google Auth Platform con el botón
"Get started"]

---

## Paso 12 — El nombre de tu app

Te va a pedir dos cosas:

**_App name_ / _Nombre de la aplicación_** — escribí:

```
Mi Wallet
```

Este nombre lo vas a ver vos, en la pantalla de permiso, más adelante. Poné el
que quieras.

**_User support email_ / _Correo de asistencia_** — es una lista desplegable.
Hacé clic y **elegí tu correo de Gmail** (va a ser la única opción, o casi).

Hacé clic en **_Next_ / _Siguiente_**.

[CAPTURA 09 — el formulario "App Information" con nombre y correo completados]

---

## Paso 13 — Quién puede usarla: elegí "External"

Ahora te pregunta *Audience* / *Público*. Hay dos opciones con un circulito
cada una:

- ⚪ **Internal** / **Interno**
- ⚪ **External** / **Externo**

**Elegí _External_ / _Externo_.** Hacé clic en su circulito.

Hacé clic en **_Next_ / _Siguiente_**.

[CAPTURA 10 — las dos opciones Internal/External con "External" seleccionado]

> **¿Por qué "externo" si es solo para mí?** Suena al revés, pero es así:
> *Internal* solo existe para cuentas de empresa (Google Workspace). Con una
> cuenta de Gmail normal, *External* es la única que funciona — y "externo" acá
> significa "cualquier cuenta de Google puede autorizarla", no que tus datos
> salgan a ningún lado.

**⚠️ Si _Internal_ aparece en gris y no se puede elegir:** perfecto, es
exactamente lo esperado con una cuenta de Gmail personal. Elegí *External* y
seguí.

---

## Paso 14 — Tu correo de contacto

Te pide *Contact Information* / *Información de contacto*: un correo donde
Google te avisaría si hay algún problema.

Escribí **tu mismo correo de Gmail**.

Hacé clic en **_Next_ / _Siguiente_**.

---

## Paso 15 — Aceptá y creá

Última pantalla del formulario. Hay una casilla ☐ que dice algo como
*I agree to the Google API Services: User Data Policy* / *Acepto la Política de
Datos del Usuario*.

**Marcá la casilla** ☑ y hacé clic en **_Continue_ / _Continuar_**.

Después, hacé clic en el botón **_Create_ / _Crear_**.

[CAPTURA 11 — la casilla de la User Data Policy marcada y el botón Create]

---

## Paso 16 — Verificá que quedó

**✅ Lo hiciste bien si:** ahora ves un **menú a la izquierda** con estas
opciones (o sus traducciones):

- *Overview* / *Descripción general*
- *Branding* / *Personalización*
- *Audience* / *Público*
- *Clients* / *Clientes*
- *Data Access* / *Acceso a los datos*

**Ese menú de la izquierda es tu mapa para los próximos pasos.** Si en algún
momento te perdés, volvé a mirarlo.

**⚠️ Si no ves ese menú:** volvé al **Paso 10** y buscá *Google Auth Platform*
otra vez. Puede que la página haya quedado a medio cargar.

[CAPTURA 12 — el menú lateral izquierdo completo, con las cinco secciones
visibles]

---

# PARTE 4 — Pedir el permiso de lectura

Ahora le decimos exactamente **qué** va a poder hacer el wallet: leer correos.
Nada más.

## Paso 17 — Abrí el acceso a datos

En el **menú de la izquierda**, hacé clic en **_Data Access_ / _Acceso a los
datos_**.

**✅ Lo hiciste bien si:** ves una página con una tabla vacía y un botón que
dice *Add or remove scopes* / *Agregar o quitar permisos*.

---

## Paso 18 — Abrí la lista de permisos

Hacé clic en **_Add or remove scopes_ / _Agregar o quitar permisos_**.

Se abre un panel del lado derecho con una tabla larga y un buscador arriba.

[CAPTURA 13 — el panel lateral de scopes recién abierto, con el buscador
arriba]

---

## Paso 19 — Buscá el permiso exacto

En el buscador **de ese panel** (no el de arriba de todo — el que está *dentro*
del panel, suele decir *Filter* / *Filtrar*), escribí exactamente:

```
gmail.readonly
```

y apretá `Enter`.

**✅ Lo hiciste bien si:** la tabla se achicó y quedó **una sola fila**, o muy
pocas.

**⚠️ Si no aparece nada:** borrá lo que escribiste y probá con solo `gmail`.
Van a aparecer varias filas; buscá a mano la que termina en `gmail.readonly`.

---

## Paso 20 — Marcá el permiso correcto

Fijate en la columna que dice *Scope* / *Permiso*. Tenés que encontrar la fila
que dice **exactamente esto**:

```
https://www.googleapis.com/auth/gmail.readonly
```

En la descripción, a la derecha, va a decir algo como *"Read all resource
metadata..."* o *"Ver los mensajes y la configuración de tu correo"*.

**Marcá la casilla ☑ que está al principio de esa fila.**

[CAPTURA 14 — la fila de gmail.readonly con su casilla marcada, señalando la
columna Scope donde se lee la URL completa]

> **⚠️ Cuidado con las hermanas.** Hay permisos parecidos que dicen
> `gmail.modify`, `gmail.compose`, `gmail.send` o `mail.google.com`. **Ninguno
> de esos.** Esos permiten *escribir*, *enviar* o *borrar* correo. El wallet
> solo necesita `gmail.readonly`, que es de **solo lectura**: aunque quisiera,
> no puede mandar ni borrar nada. Si marcaste otro por error, desmarcalo.

**✅ Antes de seguir, contá:** tiene que haber **exactamente una** casilla
marcada, y su texto tiene que terminar en `gmail.readonly`.

---

## Paso 21 — Guardá el permiso

Bajá hasta el final del panel de la derecha y hacé clic en **_Update_ /
*Actualizar*_**.

El panel se cierra. Ahora, en la página que quedó detrás, hacé clic en
**_Save_ / _Guardar_**.

> **Son dos botones distintos, en dos lugares distintos.** Primero *Update*
> (dentro del panel), después *Save* (en la página). Es muy fácil hacer el
> primero y olvidarse del segundo — y si te olvidás, el permiso no queda
> guardado.

**✅ Lo hiciste bien si:** en la tabla de la página ahora aparece una fila con
`.../auth/gmail.readonly`. Quedó grabado.

**⚠️ Si la tabla sigue vacía:** te faltó el *Save*. Volvé al **Paso 18** y
rehacé la parte.

[CAPTURA 15 — la tabla de Data Access mostrando la fila gmail.readonly ya
guardada]

---

# PARTE 5 — Crear las llaves (acá salen 2 de los 3 códigos)

Este es **el paso más importante de toda la guía**. Acá Google te va a dar dos
códigos, y uno de ellos **se muestra una sola vez en la vida**.

## Paso 22 — Preparate ANTES de hacer clic

En serio, hacé esto primero:

1. **Abrí el Bloc de notas** (o Notas, o donde vayas a pegar).
2. Escribí estas dos líneas ahí, vacías:

```
ID:
CLAVE:
```

3. Dejá esa ventana abierta al lado.

**Por qué:** en el Paso 27 va a aparecer una ventanita con dos códigos. Si la
cerrás sin copiar la clave, **no hay forma de recuperarla** — hay que borrar
todo y crear otra. Con el Bloc de notas abierto, es imposible que te pase.

---

## Paso 23 — Andá a "Clients"

En el **menú de la izquierda**, hacé clic en **_Clients_ / _Clientes_**.

**✅ Lo hiciste bien si:** ves una página con una lista vacía y un botón que
dice *Create client* / *Crear cliente*.

---

## Paso 24 — Creá el cliente

Hacé clic en **_Create client_ / _Crear cliente_**.

(Si tu pantalla es de una versión más vieja, el botón puede decir
*+ Create credentials* / *+ Crear credenciales* y después tenés que elegir
*OAuth client ID* / *ID de cliente de OAuth*.)

[CAPTURA 16 — la página Clients vacía con el botón "Create client" resaltado]

---

## Paso 25 — Elegí el tipo: "Desktop app"

Ahora ves una lista desplegable que dice *Application type* / *Tipo de
aplicación*. Hacé clic para abrirla.

Te va a mostrar varias opciones: *Web application*, *Android*, *iOS*,
*Chrome Extension*, *TVs and Limited Input devices*, *Desktop app*...

**Elegí exactamente: _Desktop app_ / _Aplicación de escritorio_.**

[CAPTURA 17 — la lista desplegable "Application type" abierta, con "Desktop
app" resaltado]

> **Esto NO es opcional y no hay reemplazo.** Tiene que ser *Desktop app*. Si
> elegís *Web application*, la página te va a pedir que escribas una
> "dirección de redirección" — y **no existe una dirección fija que puedas
> escribir**: el wallet usa un número de puerto distinto cada vez que corre.
> Con *Desktop app*, Google no te pide ninguna dirección, y por eso funciona.

**✅ Lo hiciste bien si:** debajo aparece un campo *Name* / *Nombre*, y **NO**
aparece ningún campo que hable de *Authorized redirect URIs* / *URIs de
redireccionamiento*.

**⚠️ Si SÍ te aparece un campo pidiendo una dirección de redirección:**
elegiste el tipo equivocado. Volvé a abrir la lista desplegable y elegí
*Desktop app*.

---

## Paso 26 — Ponele nombre y creá

En *Name* / *Nombre*, escribí:

```
wallet-local
```

Este nombre es solo para que vos lo reconozcas en la lista. No afecta nada.

Hacé clic en **_Create_ / _Crear_**.

---

## Paso 27 — 🔴 COPIÁ LOS DOS CÓDIGOS AHORA

Se abrió una ventanita que dice algo como *OAuth client created* / *Cliente de
OAuth creado*.

**Adentro hay dos códigos. Copiá los dos, ahora, antes de tocar nada más.**

[CAPTURA 18 — la ventana emergente "OAuth client created" mostrando Client ID
y Client secret, con los valores reales tapados/borroneados]

**Código 1 — _Client ID_ / _ID de cliente_**

Es un texto largo que **empieza con un montón de números** y **termina en**
`.apps.googleusercontent.com`. Tiene esta forma:

```
(doce números)-(veinte y pico de letras y números).apps.googleusercontent.com
```

Hacé clic en el iconito de copiar 📋 que está al lado, y **pegalo en el Bloc de
notas** después de donde escribiste `ID:`.

**Código 2 — _Client secret_ / _Secreto del cliente_**

Es más corto y **empieza con** `GOCSPX-`. Tiene esta forma:

```
GOCSPX-(un revoltijo de letras y números)
```

Hacé clic en su iconito de copiar 📋 y **pegalo en el Bloc de notas** después
de `CLAVE:`.

**✅ Antes de cerrar esa ventanita, mirá tu Bloc de notas y confirmá:**

- [ ] La línea de `ID:` termina en `.apps.googleusercontent.com`
- [ ] La línea de `CLAVE:` empieza con `GOCSPX-`
- [ ] Ninguna de las dos quedó vacía
- [ ] No copiaste espacios de más al principio o al final

**Recién cuando las cuatro estén ✅**, cerrá la ventanita con *OK*.

**⚠️ Si cerraste la ventana sin copiar la clave:** no te preocupes, tiene
arreglo, pero hay que rehacerlo. En la lista de *Clients*, borrá el cliente
`wallet-local` (icono de tacho 🗑) y volvé al **Paso 24** para crear uno nuevo.
La clave **no se puede volver a ver**, solo se puede crear otra.

> **¿Esto es peligroso de tener anotado?** El *client secret* es como la llave
> de tu casa: no lo publiques ni lo mandes por chat a nadie. Pero solo sirve
> combinado con tu autorización personal — nadie puede leer tu correo solo con
> ese código. Cuando termines la guía, borralo del Bloc de notas.

---

# PARTE 6 — Publicar la app (el paso que todos se saltean)

## Paso 28 — Andá a "Audience"

En el **menú de la izquierda**, hacé clic en **_Audience_ / _Público_**.

---

## Paso 29 — Buscá el estado de publicación

En esa página, buscá una parte que diga *Publishing status* / *Estado de
publicación*. Debajo va a decir una de dos cosas:

- **_Testing_ / _Prueba_** ← lo más probable
- **_In production_ / _En producción_**

[CAPTURA 19 — la sección "Publishing status" mostrando el estado "Testing" y
el botón "Publish app"]

---

## Paso 30 — Publicá

**Si dice _Testing_:** hacé clic en el botón **_Publish app_ / _Publicar
aplicación_**.

Va a salir una ventanita de confirmación. Hacé clic en **_Confirm_ /
_Confirmar_**.

**Si ya dice _In production_:** no hagas nada, ya estás. Seguí al Paso 31.

---

## Paso 31 — Verificá

**✅ Lo hiciste bien si:** donde antes decía *Testing*, ahora dice
**_In production_ / _En producción_**.

**⚠️ Si sigue diciendo _Testing_:** volvé al Paso 30. Este paso importa de
verdad (leé el recuadro).

> ## Por qué este paso no es opcional
>
> Si dejás la app en **Testing**, el permiso que le des a tu Gmail
> **se vence a los 7 días**. Cada semana el wallet dejaría de traer
> movimientos y tendrías que rehacer toda la Parte 7 de esta guía.
>
> En **In production**, el permiso no se vence nunca (salvo que vos lo
> revoques a propósito).
>
> **Es un clic ahora, o un clic cada semana para siempre.**

**⚠️ Google va a mostrar un aviso** tipo *"Your app requires verification"* /
*"Tu app necesita verificación"*, o va a hablar de mandar la app a revisión.
**Ignoralo. No mandes nada a revisión.** Ese trámite existe para apps que se
publican a miles de usuarios desconocidos. La tuya la vas a usar vos con tu
propia cuenta, y funciona perfecto sin verificar.

---

# PARTE 7 — Pegar los códigos en tu computadora

Se terminó Google. Ahora vamos a tu computadora. Podés cerrar el navegador de
la consola (dejá abierto el Bloc de notas con los dos códigos).

## Paso 32 — Encontrá la carpeta del wallet

Es la carpeta donde instalaste el wallet. Adentro hay archivos como
`setup.bat`, `iniciar.bat`, `package.json` y una carpeta `docs`.

Si no sabés cuál es: es la misma donde hiciste doble clic en `setup.bat`.

---

## Paso 33 — Encontrá el archivo `.env`

Dentro de esa carpeta, buscá un archivo llamado **`.env`** — así, empezando
con un punto y sin nada antes.

**⚠️ Si no lo ves:**

- **En Windows**, el Explorador a veces esconde estos archivos. Andá a la
  pestaña *Vista* / *View* de arriba y marcá la casilla *Elementos ocultos* /
  *Hidden items*.
- **Si sigue sin aparecer**, es que todavía no existe. Se crea solo: en la
  ventana negra de comandos, dentro de esa carpeta, escribí
  `npm run onboard -- --init-env` y apretá `Enter`. (O simplemente pedile al
  asistente que te lo cree.)

---

## Paso 34 — Abrilo con el Bloc de notas

**No le hagas doble clic** — Windows no sabe con qué abrirlo y te va a
preguntar cosas raras.

Hacé **clic derecho** sobre `.env` → *Abrir con* / *Open with* → **Bloc de
notas** / **Notepad**.

**✅ Lo hiciste bien si:** se abre una ventana de texto con muchas líneas, la
mayoría empezando con `#`, y algunas con nombres en mayúsculas.

---

## Paso 35 — Encontrá las dos líneas de Gmail

Buscá (podés usar `Ctrl+B` / `Ctrl+F` para buscar la palabra `GMAIL`) estas
tres líneas. Están juntas, debajo de un comentario que habla de Gmail:

```
GMAIL_OAUTH_CLIENT_ID=
GMAIL_OAUTH_CLIENT_SECRET=
GMAIL_OAUTH_REFRESH_TOKEN=
```

Están vacías: no hay nada después del `=`.

---

## Paso 36 — Pegá los dos códigos

Poné el cursor **justo después del `=`** de la primera línea, y pegá el
**Client ID** (el que termina en `.apps.googleusercontent.com`).

Hacé lo mismo en la segunda con el **Client secret** (el que empieza con
`GOCSPX-`).

**La tercera línea, `GMAIL_OAUTH_REFRESH_TOKEN=`, la dejás vacía por ahora.**
Se completa en el Paso 44.

Te tiene que quedar así — donde dice "(tu ...)" van tus códigos de verdad,
pegados enteros:

```
GMAIL_OAUTH_CLIENT_ID=(tu código largo).apps.googleusercontent.com
GMAIL_OAUTH_CLIENT_SECRET=GOCSPX-(tu clave)
GMAIL_OAUTH_REFRESH_TOKEN=
```

[CAPTURA 20 — el archivo .env abierto en el Bloc de notas con las tres líneas
GMAIL_OAUTH_*, las dos primeras completadas y valores de ejemplo tapados]

**✅ Repasá estas cinco cosas antes de guardar:**

- [ ] **No hay espacios** alrededor del `=`. Tiene que ser
      `GMAIL_OAUTH_CLIENT_ID=123...`, **no** `GMAIL_OAUTH_CLIENT_ID = 123...`
- [ ] **No pusiste comillas** `"` ni `'` alrededor de los códigos
- [ ] Cada código está **todo en una sola línea**, sin cortes
- [ ] No borraste sin querer el nombre de la variable
- [ ] La línea del `REFRESH_TOKEN` sigue ahí, aunque esté vacía

---

## Paso 37 — Guardá

`Ctrl+G` (Guardar) o menú *Archivo* → *Guardar*. Cerrá el Bloc de notas.

**⚠️ Si al guardar te ofrece cambiar el nombre a `.env.txt`:** ¡no! Elegí
*Guardar* normal, sin cambiar el nombre. El archivo tiene que llamarse
exactamente `.env`.

---

# PARTE 8 — Autorizar (acá sale el tercer código)

Este último tramo lo hace tu computadora, no Google Cloud. Es corto.

## Paso 38 — Corré el comando de autorización

Si estás con el asistente (Claude Code), **decile simplemente:**

> *"Ya puse el client id y el secret en el .env. Corré `npm run gmail-auth`."*

Si lo hacés vos: abrí una ventana de comandos **en la carpeta del wallet** y
escribí:

```
npm run gmail-auth
```

y apretá `Enter`.

---

## Paso 39 — Se abre el navegador

El programa imprime unas líneas y **abre tu navegador solo**.

**Lo primero que vas a ver en la ventana de comandos es esto**, y está bien
que aparezca:

```
Permisos que se van a pedir:
  https://www.googleapis.com/auth/gmail.readonly
```

Ese es el único permiso que se está pidiendo: **solo lectura**. Ahí lo podés
verificar con tus propios ojos.

**⚠️ Si el navegador NO se abre solo:** no pasa nada. En la ventana de
comandos hay una dirección larguísima que empieza con
`https://accounts.google.com/...`. **Copiala entera** (desde la `h` hasta el
final) y pegala en tu navegador a mano.

**⚠️ Si en vez de eso ves un error que dice
_"Faltan GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET en .env"_:** los
códigos no quedaron guardados. Volvé al **Paso 33** y revisá el archivo —
casi siempre es un espacio de más alrededor del `=`, o que el archivo se
guardó como `.env.txt`.

---

## Paso 40 — Elegí tu cuenta y pasá la advertencia

En el navegador, Google te pide elegir una cuenta.

**Elegí la cuenta de Gmail donde llegan los correos de tu banco.** La misma de
siempre.

Después va a aparecer una pantalla que dice:

> ⚠️ **Google hasn't verified this app** / **Google no verificó esta
> aplicación**

**Esto es normal y es tu propia app.** Para pasar:

1. Hacé clic en **_Advanced_ / _Configuración avanzada_** (está chiquito,
   abajo a la izquierda).
2. Se despliega un texto. Al final hay un enlace que dice
   **_Go to Mi Wallet (unsafe)_ / _Ir a Mi Wallet (no seguro)_**.
3. Hacé clic en ese enlace.

[CAPTURA 21 — la pantalla "Google hasn't verified this app", con flechas
señalando primero "Advanced" y después el enlace "Go to ... (unsafe)"]

> **¿Por qué dice "no seguro"?** Porque Google no revisó la app — y no la
> revisó porque no se la mandamos a revisar, ya que es tuya y solo la usás vos.
> Ese cartel está pensado para cuando un desconocido te manda un enlace. Acá la
> app la creaste vos hace 10 minutos, con tu cuenta, y corre en tu computadora.

---

## Paso 41 — Dale el permiso

Ahora sí, la pantalla de permiso. Va a decir algo como:

> **Mi Wallet quiere acceder a tu cuenta de Google**
> ☑ *Ver los mensajes y la configuración de tu correo electrónico*

**Fijate que diga "Ver" / "Read".** Si dijera "Enviar", "Modificar" o
"Eliminar", algo se hizo mal en la Parte 4 — pará y volvé al **Paso 20**.

Hacé clic en **_Continue_ / _Continuar_** (o *Allow* / *Permitir*).

[CAPTURA 22 — la pantalla de consentimiento mostrando el permiso de lectura y
el botón Continue]

---

## Paso 42 — Confirmá en el navegador

La página del navegador va a cambiar y mostrar, en texto simple:

```
Autorizado. Puedes cerrar esta pestana.
```

**✅ Si ves eso:** salió todo bien. Cerrá la pestaña.

**⚠️ Si ves _"Autorizacion fallida"_:** cancelaste sin querer o no pasaste la
advertencia. Volvé al **Paso 38** y repetí.

---

## Paso 43 — 🔴 Copiá el tercer código

Volvé a la **ventana de comandos** (la negra, donde corriste el comando).

Ahí abajo de todo vas a ver:

```
Autorizacion exitosa. Copia este valor a GMAIL_OAUTH_REFRESH_TOKEN en .env:

1//0(un texto largo de letras, números y guiones)
```

Ese texto largo de la última línea (el que empieza con `1//`) es tu
**refresh token** — el tercer y último código.

**Seleccionalo con el mouse y copialo** (`Ctrl+C`).

[CAPTURA 23 — la ventana de comandos con el mensaje de éxito y el token
tapado/borroneado]

**⚠️ Si en vez de eso ves _"Google no devolvio refresh_token"_:** significa
que ya habías autorizado esta app antes. Solución:

1. Andá a `https://myaccount.google.com/permissions`
2. Buscá **Mi Wallet** en la lista
3. Hacé clic y elegí *Quitar acceso* / *Remove access*
4. Volvé al **Paso 38** y repetí

---

## Paso 44 — Pegá el tercer código en `.env`

Abrí `.env` otra vez con el Bloc de notas (**Paso 34**), y pegá el token
después del `=` de la tercera línea:

```
GMAIL_OAUTH_REFRESH_TOKEN=1//0(el texto largo que copiaste)
```

Mismas reglas: **sin espacios**, **sin comillas**, **todo en una línea**.

Guardá (`Ctrl+G`) y cerrá.

---

# PARTE 9 — Comprobar que quedó todo

## Paso 45 — Preguntale al wallet

Si estás con el asistente, decile:

> *"Ya está el refresh token. Verificá el estado del onboarding."*

Si lo hacés vos, en la ventana de comandos:

```
npm run onboard -- --status
```

**✅ Lo hiciste bien si:** en la respuesta aparece el paso `gmail` con
`"done": true`.

**⚠️ Si dice `"done": false`:** falta alguno de los tres códigos en el `.env`.
Abrilo (Paso 34) y revisá que las tres líneas `GMAIL_OAUTH_*` tengan algo
después del `=`.

---

## Paso 46 — Terminaste

Ya está. **Este proceso no se repite.** Los tres códigos quedan guardados en tu
computadora y sirven para siempre.

Lo que sigue es traer tu historial de correos, y de eso se encarga el
asistente. Volvé a [onboarding-para-humanos.md](onboarding-para-humanos.md),
Paso 4.

**Última cosa:** borrá del Bloc de notas los códigos que anotaste. Ya no los
necesitás, están guardados en el `.env`.

---

# Si algo salió mal

| Lo que ves | Qué pasó | Qué hacer |
|---|---|---|
| *"Faltan GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET en .env"* | El archivo no tiene los códigos, o tiene un espacio de más | Paso 33 al 37 de nuevo. Ojo con `.env.txt` |
| Google me pide una "dirección de redirección" | Elegiste *Web application* en vez de *Desktop app* | Paso 25 |
| Cerré la ventanita sin copiar la clave | La clave no se puede volver a ver | Borrá el cliente en *Clients* y volvé al Paso 24 |
| *"Google no devolvio refresh_token"* | Ya habías autorizado antes | Quitá el acceso en `myaccount.google.com/permissions` y repetí el Paso 38 |
| *"access_denied"* al autorizar | No pasaste el *Advanced → Go to (unsafe)*, o falta el permiso | Paso 40; si insiste, revisá el Paso 20 |
| El wallet dejó de traer movimientos después de una semana | La app quedó en *Testing* | Paso 28 al 31, y después repetí desde el Paso 38 |
| *"invalid_grant"* | Lo mismo de arriba: el permiso se venció | Igual que la fila anterior |
| El navegador no se abrió solo | Pasa en algunas computadoras | Copiá la dirección `https://accounts.google.com/...` de la ventana de comandos y pegala a mano |
| El paso `gmail` sigue en `done: false` | Falta uno de los tres códigos | Paso 35: las tres líneas tienen que tener valor |
| El sync trae 0 movimientos | El OAuth está bien, pero es otro problema | Puede ser que tu banco no tenga lector todavía, o que los correos estén en otra cuenta de Gmail. Ver [multibanco.md](multibanco.md) |

---

# Cómo sacarle el permiso cuando quieras

En cualquier momento, sin pedirle permiso a nadie:

1. Andá a `https://myaccount.google.com/permissions`
2. Buscá **Mi Wallet**
3. *Quitar acceso* / *Remove access*

Desde ese momento el wallet no lee más nada. Si además querés borrar los
códigos, abrí el `.env` y dejá las tres líneas `GMAIL_OAUTH_*` vacías.

---

# Diccionario de palabras raras

No hace falta que sepas nada de esto para seguir la guía. Está por si te da
curiosidad.

| Palabra | Qué significa, en criollo |
|---|---|
| **API** | La "puerta de servicio" de un programa: por dónde otro programa le pide cosas. Prender la *Gmail API* es abrir esa puerta. |
| **OAuth** | El sistema de "dar permiso sin dar la contraseña". Es lo mismo que pasa cuando entrás a una app "con tu cuenta de Google": nunca le diste tu clave a esa app. |
| **Scope** | El *alcance* del permiso. `gmail.readonly` significa "solo puede leer". Existen otros que dejan enviar o borrar — el wallet no pide ninguno de esos. |
| **Cliente OAuth** | La ficha que identifica a tu programa ante Google. Los dos códigos del Paso 27 son eso. |
| **Client ID** | El "nombre" público de tu programa. No es secreto. |
| **Client secret** | La "contraseña" de tu programa. Esta sí es secreta. |
| **Refresh token** | El comprobante de que vos diste permiso. Con eso el wallet puede seguir leyendo sin molestarte cada vez. |
| **Desktop app** | El tipo de programa que corre en tu computadora (no en una página web). El wallet es de ese tipo. |
| **localhost / 127.0.0.1** | "Esta misma computadora". Cuando el navegador va ahí, no sale a internet: le habla al programa que tenés corriendo. |
| **Publicar la app** | Sacarla del modo prueba. No la publica en ningún lado ni la hace visible para nadie: solo hace que el permiso no se venza cada 7 días. |

---

# Anexo — Lista de capturas a tomar

Para quien vaya a completar la guía con imágenes reales. Están numeradas en el
orden en que aparecen en el texto.

| # | Paso | Qué mostrar | Nombre de archivo sugerido |
|---|---|---|---|
| 01 | 1 | Pantalla inicial de Google Cloud Console | `oauth-01-consola-inicio.png` |
| 02 | 2 | Barra superior con el selector de proyecto | `oauth-02-selector-proyecto.png` |
| 03 | 4 | Formulario de proyecto nuevo con el nombre puesto | `oauth-03-proyecto-nuevo.png` |
| 04 | 5 | Barra superior con `mi-wallet` como proyecto activo | `oauth-04-proyecto-activo.png` |
| 05 | 6 | Buscador con "Gmail API" escrito y sugerencias | `oauth-05-buscar-gmail-api.png` |
| 06 | 8 | Página de Gmail API con el botón *Enable* | `oauth-06-enable-gmail-api.png` |
| 07 | 10 | Búsqueda de "Google Auth Platform" | `oauth-07-buscar-auth-platform.png` |
| 08 | 11 | Pantalla de bienvenida con *Get started* | `oauth-08-get-started.png` |
| 09 | 12 | Formulario *App Information* completado | `oauth-09-app-info.png` |
| 10 | 13 | Opciones Internal/External, con External elegido | `oauth-10-external.png` |
| 11 | 15 | Casilla de la User Data Policy marcada | `oauth-11-user-data-policy.png` |
| 12 | 16 | Menú lateral con las cinco secciones | `oauth-12-menu-lateral.png` |
| 13 | 18 | Panel de scopes recién abierto | `oauth-13-panel-scopes.png` |
| 14 | 20 | Fila de `gmail.readonly` marcada | `oauth-14-scope-readonly.png` |
| 15 | 21 | Tabla de Data Access con el scope guardado | `oauth-15-scope-guardado.png` |
| 16 | 24 | Página *Clients* con el botón *Create client* | `oauth-16-create-client.png` |
| 17 | 25 | Desplegable *Application type* con *Desktop app* | `oauth-17-desktop-app.png` |
| 18 | 27 | Ventana con Client ID y secret (**valores tapados**) | `oauth-18-credenciales.png` |
| 19 | 29 | *Publishing status* en *Testing* con *Publish app* | `oauth-19-publish.png` |
| 20 | 36 | `.env` en el Bloc de notas (**valores tapados**) | `oauth-20-env.png` |
| 21 | 40 | Advertencia "Google hasn't verified this app" | `oauth-21-no-verificada.png` |
| 22 | 41 | Pantalla de consentimiento con el permiso de lectura | `oauth-22-consentimiento.png` |
| 23 | 43 | Ventana de comandos con el éxito (**token tapado**) | `oauth-23-refresh-token.png` |

Van en `docs/assets/img/`. Y una regla que no se negocia:

> **Tapá todo dato personal antes de guardar la imagen.** El correo, el Client
> ID, el secret, el refresh token, el nombre del proyecto si tiene tu apellido.
> Las capturas 18, 20 y 23 muestran credenciales reales en pantalla: esas
> **tienen** que ir borroneadas. El repositorio no lleva datos de nadie.
