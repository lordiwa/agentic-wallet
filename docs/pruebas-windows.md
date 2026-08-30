# Probar el instalador de Windows

El instalador (`setup.bat` + `tools/windows/setup.ps1`) **se escribió y se
verificó desde Linux**. Eso deja una parte comprobada y otra que sólo se puede
comprobar en una máquina Windows real. Este documento separa las dos, para que
nadie asuma que está probado lo que no lo está.

---

## Ya verificado (automatizable, sin Windows)

| Qué | Cómo se comprobó | Resultado |
|---|---|---|
| `setup.ps1` es sintácticamente válido | Se parseó con el parser real de PowerShell (`[Parser]::ParseFile`) | 0 errores |
| No llama funciones inexistentes | Se recorrió el AST comparando cada `CommandAst` contra las 23 funciones definidas y los cmdlets disponibles | Sólo `winget` queda fuera, y está protegido por `Existe-Comando` en sus 2 usos |
| Detección de versión de Node | Se ejecutó `Obtener-NodeMajor` contra un Node real | Devuelve `22` para `v22.23.2` |
| Detección de fallo de compilación nativa | Se ejecutó `Log-Menciona-CompilacionNativa` contra un log real de `node-gyp` sin Build Tools **y** contra un log de error de red que menciona `better-sqlite3` | Detecta el primero, **no** confunde el segundo |
| URL del instalador de Node 22 | Se ejecutó `Resolver-UrlMsiNode22` contra `nodejs.org` en vivo, y se pidió el `HEAD` del resultado | Resuelve `node-v22.23.2-x64.msi`, HTTP 200, 30.3 MB |
| Propagación del código de salida de npm | Se ejecutó `Invocar-Npm` con un comando que funciona y con uno que falla | `0` y `1` respectivamente, y el log queda escrito |
| Los comandos que invoca existen | Se contrastó cada `npm run …` contra `package.json` | `build`, `onboard`, `dev` existen; `--init-env` está implementado en `onboard/cli.ts:214` |
| El asistente existe en el registro | `npm view @anthropic-ai/claude-code version` | `2.1.251` |
| Codificación de los archivos | `setup.ps1` es UTF-8 **con BOM** (PowerShell 5.1 lee ANSI sin BOM y rompe los acentos); los `.bat` son ASCII puro y CRLF; `.gitattributes` fuerza `eol=crlf` | OK |
| Suite y build del proyecto | `npm run build` y `npm test` | 71 archivos, 858 tests, en verde |

---

## Pendiente de probar en Windows real

**Nada de esto se ejecutó.** Es la lista de lo que hay que verificar a mano.

### Preparación

Idealmente una **máquina virtual limpia** (Windows 10 u 11 sin Node instalado),
con un snapshot antes de empezar para poder repetir los escenarios.

### Escenario A — Windows limpio, sin Node (el caso de Kevin)

1. Copiar el repo a `C:\Users\<usuario>\Documents\wallet` (o bajar el ZIP y
   extraerlo).
2. Doble clic en `setup.bat`.
3. **Verificar:** se abre una ventana y los acentos se ven bien (`instalación`,
   no `instalaciÃ³n`). Si se ven mal, revisar el BOM de `setup.ps1` y el
   `chcp 65001` de `setup.bat`.
4. **Verificar:** el paso 1 dice que Node no está y ofrece instalarlo.
5. Contestar `S`.
6. **Verificar:** aparece el prompt de UAC (ventana azul). Aceptar.
7. **Verificar:** Node queda instalado. Es esperable que el script termine
   pidiendo cerrar y reabrir la ventana (el PATH nuevo no llega a un proceso ya
   abierto). Ese mensaje debe aparecer, no un error críptico.
8. Volver a hacer doble clic en `setup.bat`.
9. **Verificar:** ahora el paso 1 pasa, y sigue con `npm install`.
10. **Verificar:** `better-sqlite3` instala sin pedir Build Tools (debería bajar
    un binario ya compilado). Si pide Build Tools, ver escenario C.
11. **Verificar:** `npm run build` termina bien.
12. **Verificar:** ofrece instalar Claude Code; aceptar y que quede instalado.
13. **Verificar:** se crea `.env` y se imprime el checklist.
14. **Verificar:** la pantalla final dice "La instalación terminó bien" y
    manda a `configurar.bat`.

### Escenario B — Ya tiene Node, pero viejo (18 o 20)

1. Instalar Node 20 a mano.
2. Doble clic en `setup.bat`.
3. **Verificar:** dice "Tenés Node.js 20, y hace falta la versión 22 o más
   nueva" y ofrece actualizarlo, en vez de seguir de largo y fallar después.

### Escenario C — Falla la compilación nativa

Es el escenario difícil de forzar. Si en el escenario A `better-sqlite3` instala
sin problema, esta rama **queda sin probar en la práctica** — dejarlo anotado.

Para forzarlo: instalar un Node cuya versión no tenga binario precompilado para
`better-sqlite3@11`, en una máquina sin Visual Studio Build Tools.

1. **Verificar:** el instalador identifica que es un problema de compilación (y
   no lo confunde con uno de red).
2. **Verificar:** ofrece instalar Build Tools, avisando del tamaño y el tiempo.
3. Aceptar. **Verificar:** `winget` instala el workload `VCTools`.
4. **Verificar:** después reintenta `npm install` solo y esta vez funciona.
5. Repetir contestando `N`: **verificar** que muestra el link de
   `visualstudio.microsoft.com` con los 6 pasos manuales y la ruta del log.

### Escenario D — Errores del usuario

| Qué hacer | Qué tiene que pasar |
|---|---|
| Ejecutar `setup.bat` desde adentro del ZIP sin extraer | Mensaje "Esta no parece ser la carpeta del wallet" con la explicación de extraer |
| Borrar `tools\windows\setup.ps1` y ejecutar `setup.bat` | Mensaje de carpeta incompleta, no un error de PowerShell |
| Doble clic en `configurar.bat` sin haber corrido `setup.bat` | "Todavía no está instalado el wallet. Hacé primero doble clic en setup.bat" |
| Doble clic en `iniciar.bat` sin `.env` | "Todavía no está configurado el wallet" |
| Cortar `setup.bat` con Ctrl+C a mitad de `npm install` | Volver a ejecutarlo tiene que retomar sin dejar nada roto |
| Ejecutar `setup.bat` dos veces seguidas completo | La segunda pasa rápido y **no pisa el `.env`** |

### Escenario E — Rutas hostiles

| Caso | Por qué importa |
|---|---|
| Carpeta con espacios (`C:\Mis Documentos\wallet`) | Todas las rutas del `.bat` y del `.ps1` van entre comillas; hay que confirmarlo en la práctica |
| Carpeta con acentos o `ñ` (`C:\Documentos\configuración`) | Es lo que va a tener una máquina en español |
| Carpeta dentro de OneDrive | OneDrive puede bloquear archivos mientras npm escribe |
| Ruta muy profunda | `node_modules` puede pasarse del límite de 260 caracteres de Windows |

### Escenario F — El flujo completo, de punta a punta

Con una cuenta de Gmail de prueba:

1. `setup.bat` → `configurar.bat` → completar el onboarding entero.
2. `iniciar.bat`.
3. **Verificar:** el navegador se abre solo en `http://localhost:3000` y se ve
   el dashboard. Si tarda más de 12 segundos en levantar, el navegador va a
   abrir sobre un puerto todavía muerto: ajustar la espera de `iniciar.bat`.
4. **Verificar:** cerrar la ventana negra detiene el wallet.

---

## Riesgos conocidos, en orden de probabilidad

1. **La espera fija de 12 segundos de `iniciar.bat`.** En una máquina lenta o
   en el primer arranque (Vite compilando), el navegador puede abrir antes de
   que el puerto escuche y mostrar un error de conexión. Se arregla recargando,
   pero conviene medirlo y, si hace falta, cambiarlo por un sondeo del puerto.
2. **Los acentos en la consola.** Se mitigó con BOM + `chcp 65001` +
   `[Console]::OutputEncoding`, pero la consola de Windows tiene suficientes
   variantes como para que haya que confirmarlo visualmente.
3. **`winget` puede no estar.** En Windows 10 sin actualizar no existe. Los dos
   caminos que lo usan están protegidos, y el de Node cae al MSI directo; pero
   el de Build Tools se queda sólo con las instrucciones manuales.
4. **`OpenJS.NodeJS.LTS` (camino winget) puede traer una versión mayor a 22**,
   y una Node muy nueva puede no tener binario precompilado de
   `better-sqlite3@11`, cayendo al escenario C. Por eso el camino principal es
   el MSI de la última 22.x, y winget es sólo el plan B.
5. **El prompt de UAC.** Si el usuario aprieta "No", `msiexec` devuelve un
   código distinto de cero y se cae al mensaje manual. Verificar que ese
   mensaje se entienda.
