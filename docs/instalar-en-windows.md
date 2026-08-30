# Instalar el wallet en Windows

Esta guía es para **vos**, la persona que va a usar el wallet. No hace falta
saber programar ni escribir comandos: son tres dobles clics.

> Si sos un agente o alguien técnico haciendo la instalación, mirá también
> [onboarding.md](onboarding.md) (el flujo completo) y
> [pruebas-windows.md](pruebas-windows.md) (qué hay que probar del instalador).

---

## Lo que vas a necesitar

| Qué | Para qué |
|---|---|
| Una computadora con **Windows 10 u 11** | Por ahora el instalador es sólo para Windows |
| **Internet** | Para bajar el wallet y sus piezas |
| Una **cuenta de Gmail** | Es donde llegan los avisos de tu banco |
| Una **cuenta de Claude** (Pro o Max) | Es la que lee y clasifica esos avisos |
| Un **banco que te mande un correo por cada movimiento** | Es la única fuente de datos |

Si te falta alguna de las últimas tres, avisá antes de empezar: sin eso el
wallet no se puede terminar de configurar.

---

## Los tres pasos

### 1. Bajar el wallet

Descargá el proyecto y descomprimilo en una carpeta tuya, por ejemplo en
`Documentos`.

> **Importante:** si bajaste un archivo ZIP, hacé clic derecho → **Extraer
> todo**. No entres "adentro" del ZIP a ejecutar los archivos desde ahí: el
> instalador no funciona así, y te lo va a avisar.

Evitá dejarlo en el Escritorio si tu Escritorio está sincronizado con OneDrive
— OneDrive a veces bloquea archivos mientras se instalan.

### 2. Instalar — doble clic en `setup.bat`

Abrí la carpeta y hacé doble clic en **`setup.bat`**.

Se abre una ventana negra con letras. **Eso es normal**, no es un error. La
ventana te va contando en qué paso va, del 1 al 5:

1. Revisa si tenés **Node.js** (el motor que hace funcionar el wallet). Si no
   lo tenés, te pregunta si lo instala él. Decile que sí.
2. Instala las **piezas** que el wallet necesita. Es el paso más largo.
3. **Prepara** el wallet.
4. Instala el **asistente** que te va a guiar después.
5. Crea tu **archivo de configuración** y te muestra qué falta.

Tarda entre 5 y 20 minutos según tu internet. Podés dejarlo trabajando.

**Windows puede pedirte permiso** un par de veces (una ventana azul que dice
"¿Querés permitir que esta aplicación haga cambios?"). Dale que **Sí**: es para
instalar Node.js.

**Si Windows dice "Windows protegió tu PC"**: hacé clic en *Más información* y
después en *Ejecutar de todos modos*. Aparece porque el archivo lo bajaste de
internet, no porque tenga algo malo.

Cuando termina, te dice **"La instalación terminó bien"** y qué hacer después.

### 3. Configurar — doble clic en `configurar.bat`

Acá es donde el wallet aprende de vos. Se abre el asistente y **le escribís
esto**:

```
Ayudame a terminar de configurar mi wallet.
Segui docs/onboarding.md paso a paso.
```

A partir de ahí él te va preguntando y vos contestás. Te va a pedir:

- Conectar tu **cuenta de Claude**.
- Conectar tu **Gmail** en modo **solo lectura** (no puede enviar, modificar ni
  borrar nada, y lo cortás cuando quieras desde tu cuenta de Google).
- Tu **nombre**, cada cuánto **cobrás** y qué días.
- **A qué categoría va cada comercio** donde gastás ("¿el supermercado es
  comida?"). Estas son las preguntas importantes: es *tu* clasificación, no hay
  respuestas correctas ni incorrectas.

Son unos 30 a 40 minutos. **Podés cortar y seguir otro día**: volvés a hacer
doble clic en `configurar.bat` y el asistente retoma donde quedó.

Qué te va a preguntar exactamente está contado en
[onboarding-para-humanos.md](onboarding-para-humanos.md).

---

## Usarlo, de ahí en adelante

Doble clic en **`iniciar.bat`**. Se abre solo el navegador con tu dashboard.

Dejá la ventana negra abierta mientras lo usás. Para cerrar el wallet, cerrá
esa ventana.

---

## Si algo sale mal

El instalador está hecho para que **puedas volver a ejecutarlo cuantas veces
quieras**: no rompe nada y retoma donde quedó. Ante la duda, cerrá todo y hacé
doble clic en `setup.bat` de nuevo.

| Lo que ves | Qué pasa | Qué hacer |
|---|---|---|
| "Node.js se instaló, pero esta ventana todavía no lo ve" | Windows necesita una ventana nueva para reconocerlo | Cerrá la ventana y hacé doble clic en `setup.bat` otra vez |
| "Falta un componente de Windows" | Tu combinación de Windows y Node necesita compilar una pieza | Decile que sí y esperá (son 15-30 min y varios GB), o seguí el link que te da |
| "Esta no parece ser la carpeta del wallet" | Estás ejecutándolo desde adentro del ZIP | Extraé el ZIP completo y ejecutalo desde la carpeta extraída |
| "No se pudieron instalar las piezas del wallet" | Casi siempre es internet cortado o el antivirus | Probá de nuevo con internet estable |
| La ventana se cierra sola al instante | Windows bloqueó el archivo | Clic derecho en `setup.bat` → Propiedades → tildá *Desbloquear* → Aceptar |

Cuando el instalador falla te dice **la ruta de un archivo de log**. Ese
archivo tiene el detalle técnico del error: si tenés que pedir ayuda,
mandá ese archivo. No contiene datos tuyos, sólo mensajes del instalador.

---

## Qué NO hace el instalador

Para que quede claro qué toca y qué no:

- **No toca tus datos.** Si ya tenías el wallet configurado, tu `.env` y tu
  base de datos quedan intactos: el paso 5 nunca pisa una configuración que ya
  existe.
- **No manda nada a internet** más allá de descargar Node.js desde
  `nodejs.org` y las piezas del wallet desde el registro público de npm.
- **No configura nada tuyo.** Ni tu correo, ni tu sueldo, ni tus categorías.
  Eso es todo el paso 3, y siempre te pregunta antes de escribir.
