<#
    Agentic Wallet — instalador para Windows.

    Lo lanza setup.bat (que está en la raíz del proyecto). No se ejecuta suelto:
    calcula la raíz del repo desde su propia ubicación, así que tiene que
    quedarse en tools\windows\.

    Qué hace, en orden:
      1. Node.js 22 o superior (lo instala si falta)
      2. npm install  (better-sqlite3 es nativo: hay un plan B si falla)
      3. npm run build
      4. Claude Code (opcional, es quien guía el resto)
      5. .env + checklist de configuración

    Todo es reanudable: si algo falla, arreglás eso y volvés a correr
    setup.bat. Los pasos ya hechos se detectan y se saltean.

    Parámetros:
      -Auto            responde que sí a las preguntas opcionales
      -SaltarBuild     no compila (para diagnosticar una instalación rota)
#>

[CmdletBinding()]
param(
    [switch]$Auto,
    [switch]$SaltarBuild
)

# Los comandos externos (node, npm, winget) nunca deben tirar una excepción:
# el flujo entero depende de mirar el código de salida y ofrecer un plan B.
# En PowerShell 7.3+ eso hay que apagarlo explícitamente.
$ErrorActionPreference = 'Continue'
if (Get-Variable -Name 'PSNativeCommandUseErrorActionPreference' -Scope Global -ErrorAction SilentlyContinue) {
    $global:PSNativeCommandUseErrorActionPreference = $false
}

# La consola de Windows arranca en una codificación vieja que rompe los
# acentos. Sin esto los mensajes en español salen ilegibles.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    # Consola sin soporte: los acentos se van a ver mal, pero el instalador
    # funciona igual. No es motivo para abortar.
}

# PowerShell 5.1 en Windows 10 todavía negocia TLS 1.0 por defecto, y
# nodejs.org lo rechaza.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch { }

$NODE_MAJOR_MINIMO = 22
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# GetTempPath() en vez de $env:TEMP: si la variable llegara vacía, Join-Path
# tira y el instalador muere antes de imprimir el primer mensaje.
$LogDir = Join-Path ([System.IO.Path]::GetTempPath()) 'agentic-wallet-setup'
$Npm = 'npm.cmd'

# ---------------------------------------------------------------------------
# Presentación
# ---------------------------------------------------------------------------

function Escribir-Titulo {
    param([string]$Texto)
    Write-Host ''
    Write-Host ('  ' + ('=' * 68)) -ForegroundColor DarkCyan
    Write-Host "   $Texto" -ForegroundColor Cyan
    Write-Host ('  ' + ('=' * 68)) -ForegroundColor DarkCyan
}

function Escribir-Paso {
    param([int]$Numero, [string]$Texto)
    Write-Host ''
    Write-Host "  PASO $Numero de 5 — $Texto" -ForegroundColor Cyan
    Write-Host '  ------------------------------------------------------------------' -ForegroundColor DarkGray
}

function Escribir-Ok    { param([string]$T) Write-Host "  [ok]  $T" -ForegroundColor Green }
function Escribir-Aviso { param([string]$T) Write-Host "  [!]   $T" -ForegroundColor Yellow }
function Escribir-Falla { param([string]$T) Write-Host "  [X]   $T" -ForegroundColor Red }
function Escribir-Info  { param([string]$T) Write-Host "        $T" -ForegroundColor Gray }

function Confirmar {
    param([string]$Pregunta)
    if ($Auto) {
        Write-Host "  ?     $Pregunta  -> si (modo automatico)" -ForegroundColor Yellow
        return $true
    }
    while ($true) {
        Write-Host ''
        $respuesta = Read-Host "  ?     $Pregunta  [S = si / N = no]"
        if ($respuesta -eq '' -or $respuesta -match '^\s*[sSyY]') { return $true }
        if ($respuesta -match '^\s*[nN]') { return $false }
        Escribir-Info 'Escribí S para sí, o N para no, y apretá Enter.'
    }
}

function Terminar-Con-Error {
    param([string]$Titulo, [string[]]$Lineas)
    Write-Host ''
    Escribir-Falla $Titulo
    foreach ($linea in $Lineas) { Escribir-Info $linea }
    Write-Host ''
    Escribir-Info 'Cuando lo resuelvas, volvé a ejecutar setup.bat.'
    exit 1
}

# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------

# Un instalador recién corrido escribe el PATH en el registro, pero esta
# ventana ya arrancó con el PATH viejo. Sin esto, `node` sigue sin existir
# aunque Node acabe de instalarse.
function Actualizar-Path {
    $maquina = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $usuario = [Environment]::GetEnvironmentVariable('Path', 'User')
    $partes = @($maquina, $usuario) | Where-Object { $_ }
    if ($partes.Count -gt 0) { $env:Path = ($partes -join ';') }
}

function Existe-Comando {
    param([string]$Nombre)
    return [bool](Get-Command $Nombre -ErrorAction SilentlyContinue)
}

function Obtener-NodeMajor {
    if (-not (Existe-Comando 'node')) { return 0 }
    $version = & node --version 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $version) { return 0 }
    if ("$version".Trim() -match '^v(\d+)\.') { return [int]$Matches[1] }
    return 0
}

# Corre npm mostrando la salida en vivo y guardándola en un log. Se convierte
# cada línea a texto a propósito: con `2>&1` crudo, PowerShell pinta de rojo
# todo lo que npm manda por stderr (que incluye sus warnings normales) y
# parece que explotó cuando en realidad salió bien.
function Invocar-Npm {
    param([string[]]$Argumentos, [string]$Log)
    Escribir-Info "> npm $($Argumentos -join ' ')"
    & $Npm @Argumentos 2>&1 | ForEach-Object {
        $linea = [string]$_
        Write-Host "        $linea" -ForegroundColor DarkGray
        $linea
    } | Out-File -FilePath $Log -Encoding utf8
    return $LASTEXITCODE
}

function Log-Menciona-CompilacionNativa {
    param([string]$Log)
    if (-not (Test-Path $Log)) { return $false }
    $contenido = Get-Content -Path $Log -Raw -ErrorAction SilentlyContinue
    if (-not $contenido) { return $false }
    # Marcas deliberadamente estrechas. Mandar a alguien a instalar 6 GB de
    # Visual Studio porque se le cortó internet bajando better-sqlite3 es peor
    # que no detectar nada: por eso acá NO va el nombre del paquete suelto ni
    # "prebuild-install" a secas, que aparecen también en un error de red.
    $marcas = @(
        'gyp ERR',
        'node-gyp',
        'MSB[0-9]{4}',
        'No prebuilt binaries found',
        'Could not find any Visual Studio installation',
        'msvs_version',
        'requires Visual Studio'
    )
    foreach ($marca in $marcas) {
        if ($contenido -match $marca) { return $true }
    }
    return $false
}

# ---------------------------------------------------------------------------
# Paso 1 — Node.js
# ---------------------------------------------------------------------------

function Resolver-UrlMsiNode22 {
    # Se pide el listado oficial de la última 22.x en vez de clavar un número
    # de versión: así el instalador no caduca cuando sale un parche de Node.
    $arquitectura = switch ($env:PROCESSOR_ARCHITECTURE) {
        'ARM64' { 'arm64' }
        'x86'   { 'x86' }
        default { 'x64' }
    }
    $indice = 'https://nodejs.org/dist/latest-v22.x/'
    try {
        $html = (Invoke-WebRequest -Uri $indice -UseBasicParsing -TimeoutSec 60).Content
    } catch {
        return $null
    }
    $patron = "node-v22\.\d+\.\d+-$arquitectura\.msi"
    $encontrado = [regex]::Match($html, $patron)
    if (-not $encontrado.Success) { return $null }
    return ($indice + $encontrado.Value)
}

function Instalar-Node-Desde-Msi {
    $url = Resolver-UrlMsiNode22
    if (-not $url) {
        Escribir-Aviso 'No se pudo averiguar cuál es el instalador de Node 22 en nodejs.org.'
        return $false
    }

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $msi = Join-Path $LogDir (Split-Path $url -Leaf)

    Escribir-Info "Descargando Node.js desde $url"
    Escribir-Info 'Son unos 30 MB. Puede tardar un par de minutos.'
    try {
        Invoke-WebRequest -Uri $url -OutFile $msi -UseBasicParsing -TimeoutSec 600
    } catch {
        Escribir-Aviso "La descarga falló: $($_.Exception.Message)"
        return $false
    }

    Write-Host ''
    Escribir-Aviso 'Windows va a pedirte permiso para instalar Node.js.'
    Escribir-Info  'Cuando aparezca la ventana azul, apretá "Sí".'
    Write-Host ''

    try {
        $proceso = Start-Process -FilePath 'msiexec.exe' `
            -ArgumentList @('/i', "`"$msi`"", '/passive', '/norestart') `
            -Verb RunAs -Wait -PassThru
    } catch {
        Escribir-Aviso "No se pudo lanzar el instalador: $($_.Exception.Message)"
        return $false
    }

    if ($proceso.ExitCode -ne 0) {
        Escribir-Aviso "El instalador de Node terminó con el código $($proceso.ExitCode)."
        return $false
    }

    Actualizar-Path
    return $true
}

function Instalar-Node-Con-Winget {
    if (-not (Existe-Comando 'winget')) { return $false }
    Escribir-Info 'Intentando con winget (la tienda de programas de Windows)...'
    # OpenJS.NodeJS.LTS puede traer una versión mayor a 22, y eso está bien:
    # el requisito es 22 O SUPERIOR.
    & winget install --id OpenJS.NodeJS.LTS --exact --source winget `
        --accept-package-agreements --accept-source-agreements --silent 2>&1 |
        ForEach-Object { Escribir-Info ([string]$_) }
    Actualizar-Path
    return ($LASTEXITCODE -eq 0)
}

function Asegurar-Node {
    Escribir-Paso 1 'Revisar si tenés Node.js (el motor que hace funcionar el wallet)'

    $major = Obtener-NodeMajor
    if ($major -ge $NODE_MAJOR_MINIMO) {
        Escribir-Ok "Node.js $(& node --version) ya está instalado."
        return
    }

    if ($major -eq 0) {
        Escribir-Aviso 'Node.js no está instalado en esta computadora.'
    } else {
        Escribir-Aviso "Tenés Node.js $major, y hace falta la versión $NODE_MAJOR_MINIMO o más nueva."
    }
    Escribir-Info 'Node.js es un programa gratuito y oficial (nodejs.org). El wallet no funciona sin él.'

    if (Confirmar '¿Lo instalo yo ahora?') {
        $listo = Instalar-Node-Desde-Msi
        if (-not $listo) {
            Escribir-Aviso 'Probando por otro camino...'
            $listo = Instalar-Node-Con-Winget
        }

        if ($listo) {
            $major = Obtener-NodeMajor
            if ($major -ge $NODE_MAJOR_MINIMO) {
                Escribir-Ok "Node.js $(& node --version) quedó instalado."
                return
            }
            # Caso típico: la instalación anduvo, pero esta ventana no ve el
            # PATH nuevo. Cerrar y reabrir lo resuelve siempre.
            Terminar-Con-Error 'Node.js se instaló, pero esta ventana todavía no lo ve.' @(
                'No es un error: Windows necesita una ventana nueva para reconocerlo.',
                '',
                '1. Cerrá esta ventana.',
                '2. Volvé a hacer doble clic en setup.bat.',
                '',
                'El instalador va a seguir desde donde quedó.'
            )
        }
    }

    Terminar-Con-Error 'Hay que instalar Node.js a mano.' @(
        '1. Abrí este link en tu navegador:',
        '       https://nodejs.org/en/download',
        '2. Elegí la version "LTS" para Windows (archivo .msi).',
        '3. Ejecutá el archivo descargado y apretá "Siguiente" hasta el final.',
        '4. Cerrá esta ventana y volvé a hacer doble clic en setup.bat.'
    )
}

# ---------------------------------------------------------------------------
# Paso 2 — Dependencias (better-sqlite3 es nativo)
# ---------------------------------------------------------------------------

function Instalar-BuildTools {
    if (-not (Existe-Comando 'winget')) { return $false }
    Escribir-Info 'Instalando las Herramientas de Compilación de Visual Studio...'
    Escribir-Info 'Esto tarda entre 15 y 30 minutos. Podés dejarlo corriendo.'
    Write-Host ''
    & winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --source winget `
        --accept-package-agreements --accept-source-agreements `
        --override '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended' 2>&1 |
        ForEach-Object { Escribir-Info ([string]$_) }
    Actualizar-Path
    return ($LASTEXITCODE -eq 0)
}

function Instalar-Dependencias {
    Escribir-Paso 2 'Instalar las piezas que el wallet necesita'
    Escribir-Info 'La primera vez tarda varios minutos. Es normal que parezca trabado.'

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $log = Join-Path $LogDir 'npm-install.log'

    $codigo = Invocar-Npm -Argumentos @('install', '--no-fund', '--no-audit') -Log $log
    if ($codigo -eq 0) {
        Escribir-Ok 'Listo, todas las piezas quedaron instaladas.'
        return
    }

    # Un solo reintento: la causa más común de un fallo aislado es la red.
    Escribir-Aviso 'Falló el primer intento. Probando una vez más...'
    $codigo = Invocar-Npm -Argumentos @('install', '--no-fund', '--no-audit') -Log $log
    if ($codigo -eq 0) {
        Escribir-Ok 'Listo, en el segundo intento funcionó.'
        return
    }

    if (Log-Menciona-CompilacionNativa -Log $log) {
        # El wallet guarda tus datos en SQLite, y esa pieza (better-sqlite3)
        # trae binarios ya compilados para Windows. Cuando no hay uno para tu
        # combinación de Windows/Node, npm intenta compilarla en tu máquina, y
        # para eso Windows necesita un compilador que no viene de fábrica.
        Write-Host ''
        Escribir-Aviso 'Falta un componente de Windows para terminar la instalación.'
        Escribir-Info 'Se llama "Herramientas de Compilación de Visual Studio". Es de Microsoft, gratuito.'
        Escribir-Info 'Ocupa entre 3 y 6 GB de disco y tarda entre 15 y 30 minutos.'

        if (Confirmar '¿Lo instalo yo ahora?') {
            if (Instalar-BuildTools) {
                Escribir-Info 'Reintentando la instalación del wallet...'
                $codigo = Invocar-Npm -Argumentos @('install', '--no-fund', '--no-audit') -Log $log
                if ($codigo -eq 0) {
                    Escribir-Ok 'Listo, ahora sí quedaron instaladas todas las piezas.'
                    return
                }
            } else {
                Escribir-Aviso 'No se pudo instalar automáticamente.'
            }
        }

        Terminar-Con-Error 'Falta instalar las Herramientas de Compilación de Visual Studio.' @(
            '1. Abrí este link:',
            '       https://visualstudio.microsoft.com/visual-cpp-build-tools/',
            '2. Descargá y ejecutá "Build Tools para Visual Studio".',
            '3. En la lista de opciones, tildá "Desarrollo para el escritorio con C++".',
            '4. Apretá Instalar y esperá a que termine (15-30 minutos).',
            '5. Reiniciá la computadora.',
            '6. Volvé a hacer doble clic en setup.bat.',
            '',
            "El detalle tecnico del error quedó guardado en:",
            "       $log"
        )
    }

    Terminar-Con-Error 'No se pudieron instalar las piezas del wallet.' @(
        'Las causas más comunes son:',
        '  - La conexión a internet se cortó a mitad de la descarga.',
        '  - Un antivirus bloqueó la escritura de archivos en esta carpeta.',
        '',
        'Probá de nuevo con internet estable. Si vuelve a fallar, el detalle',
        'técnico del error está en este archivo:',
        "       $log",
        '',
        'Mandale ese archivo a quien te pasó el wallet: ahí se ve la causa exacta.'
    )
}

# ---------------------------------------------------------------------------
# Paso 3 — Compilar
# ---------------------------------------------------------------------------

function Compilar {
    Escribir-Paso 3 'Preparar el wallet para usarlo'

    if ($SaltarBuild) {
        Escribir-Aviso 'Salteado porque se usó -SaltarBuild.'
        return
    }

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $log = Join-Path $LogDir 'npm-build.log'

    $codigo = Invocar-Npm -Argumentos @('run', 'build') -Log $log
    if ($codigo -ne 0) {
        Terminar-Con-Error 'No se pudo preparar el wallet.' @(
            'Las piezas se instalaron bien, pero falló el armado final.',
            'Esto casi siempre significa que la instalación quedó incompleta.',
            '',
            'Probá esto, en orden:',
            '  1. Volvé a ejecutar setup.bat (a veces alcanza).',
            '  2. Si vuelve a fallar, borrá la carpeta "node_modules" que está',
            '     dentro de esta misma carpeta, y ejecutá setup.bat otra vez.',
            '',
            'El detalle técnico del error está en:',
            "       $log"
        )
    }
    Escribir-Ok 'El wallet quedó armado y listo.'
}

# ---------------------------------------------------------------------------
# Paso 4 — Claude Code (quien guía el resto)
# ---------------------------------------------------------------------------

function Asegurar-ClaudeCode {
    Escribir-Paso 4 'Instalar el asistente que te va a guiar'

    if (Existe-Comando 'claude') {
        Escribir-Ok 'El asistente (Claude Code) ya está instalado.'
        return $true
    }

    Escribir-Aviso 'Falta el asistente que te guía en la configuración.'
    Escribir-Info 'Se llama Claude Code. Es el que te va a ir preguntando tus datos'
    Escribir-Info 'y conectando tu correo, sin que tengas que escribir comandos.'

    if (-not (Confirmar '¿Lo instalo yo ahora? (tarda un par de minutos)')) {
        Escribir-Aviso 'Sin el asistente vas a tener que configurar el wallet a mano.'
        Escribir-Info 'Está explicado paso a paso en docs\onboarding.md.'
        return $false
    }

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $log = Join-Path $LogDir 'npm-claude.log'

    $codigo = Invocar-Npm -Argumentos @('install', '-g', '@anthropic-ai/claude-code', '--no-fund', '--no-audit') -Log $log
    Actualizar-Path

    if ($codigo -eq 0 -and (Existe-Comando 'claude')) {
        Escribir-Ok 'El asistente quedó instalado.'
        return $true
    }

    # No es motivo para abortar: el wallet ya está instalado y funcionando.
    Escribir-Aviso 'No se pudo instalar el asistente automáticamente.'
    Escribir-Info 'El wallet quedó instalado igual. Para instalar el asistente después,'
    Escribir-Info 'abrí este link y seguí las instrucciones para Windows:'
    Escribir-Info '       https://docs.claude.com/en/docs/claude-code/setup'
    return $false
}

# ---------------------------------------------------------------------------
# Paso 5 — Configuración
# ---------------------------------------------------------------------------

function Preparar-Configuracion {
    Escribir-Paso 5 'Crear tu archivo de configuración y ver qué falta'

    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

    # --init-env NUNCA pisa un .env que ya existe (ahí vive el permiso de
    # Gmail). Por eso es seguro correrlo en cada instalación.
    $log = Join-Path $LogDir 'onboard-init-env.log'
    $codigo = Invocar-Npm -Argumentos @('run', 'onboard', '--', '--init-env') -Log $log
    if ($codigo -eq 0) {
        Escribir-Ok 'Tu archivo de configuración está listo.'
    } else {
        Escribir-Aviso 'No se pudo crear el archivo de configuración automáticamente.'
        Escribir-Info "Detalle en: $log"
    }

    Write-Host ''
    Escribir-Info 'Esto es lo que falta para que el wallet empiece a funcionar:'
    Write-Host ''

    # El checklist legible (sin --status, que imprime JSON crudo). El objetivo
    # de esta pantalla es que la lea una persona, no un programa.
    $logChecklist = Join-Path $LogDir 'onboard-checklist.log'
    Invocar-Npm -Argumentos @('run', 'onboard') -Log $logChecklist | Out-Null
}

# ---------------------------------------------------------------------------
# Cierre
# ---------------------------------------------------------------------------

function Escribir-Cierre {
    param([bool]$TieneAsistente)

    Escribir-Titulo 'La instalación terminó bien'

    Write-Host ''
    Write-Host '  Falta la parte donde el wallet aprende de vos: conectar tu correo' -ForegroundColor White
    Write-Host '  y contarle tus datos. Eso NO se hace acá: te lo va a ir preguntando' -ForegroundColor White
    Write-Host '  el asistente, una cosa a la vez.' -ForegroundColor White
    Write-Host ''
    Write-Host '  QUÉ HACER AHORA:' -ForegroundColor Cyan
    Write-Host ''

    if ($TieneAsistente) {
        Write-Host '   1. Cerrá esta ventana.' -ForegroundColor White
        Write-Host ''
        Write-Host '   2. Volvé a abrir esta misma carpeta y hacé doble clic en:' -ForegroundColor White
        Write-Host '          configurar.bat' -ForegroundColor Yellow
        Write-Host ''
        Write-Host '   3. Cuando se abra el asistente, escribile exactamente esto:' -ForegroundColor White
        Write-Host ''
        Write-Host '          Ayudame a terminar de configurar mi wallet.' -ForegroundColor Yellow
        Write-Host '          Segui docs/onboarding.md paso a paso.' -ForegroundColor Yellow
        Write-Host ''
        Write-Host '   4. Contestá lo que te vaya preguntando. Tené a mano:' -ForegroundColor White
        Write-Host '          - tu cuenta de Gmail (la que recibe los avisos del banco)' -ForegroundColor Gray
        Write-Host '          - tu cuenta de Claude (Pro o Max)' -ForegroundColor Gray
        Write-Host ''
        Write-Host '      Son unos 30 a 40 minutos, y podés cortar y seguir después.' -ForegroundColor Gray
    } else {
        Write-Host '   1. Instalá el asistente (Claude Code) desde:' -ForegroundColor White
        Write-Host '          https://docs.claude.com/en/docs/claude-code/setup' -ForegroundColor Yellow
        Write-Host ''
        Write-Host '   2. Volvé a hacer doble clic en setup.bat.' -ForegroundColor White
        Write-Host ''
        Write-Host '   Si preferís hacerlo sin asistente, el paso a paso completo' -ForegroundColor Gray
        Write-Host '   está en el archivo docs\onboarding.md.' -ForegroundColor Gray
    }

    Write-Host ''
    Write-Host '  ------------------------------------------------------------------' -ForegroundColor DarkGray
    Write-Host '  Cuando termines de configurarlo, para USAR el wallet hacés doble' -ForegroundColor White
    Write-Host '  clic en:  iniciar.bat  — y se abre solo en el navegador.' -ForegroundColor White
    Write-Host ''
}

# ---------------------------------------------------------------------------
# Principal
# ---------------------------------------------------------------------------

Escribir-Titulo 'Agentic Wallet — instalación'
Write-Host ''
Write-Host '  Esto instala tu wallet en esta computadora. Son 5 pasos y los hace' -ForegroundColor White
Write-Host '  el programa solo. Puede tardar entre 5 y 20 minutos.' -ForegroundColor White
Write-Host ''
Write-Host '  Nada de esto sale de tu computadora, y no borra nada de lo que ya' -ForegroundColor White
Write-Host '  tengas. Si algo falla, te dice exactamente qué hacer.' -ForegroundColor White

# Verificación temprana: si esto no es la carpeta del wallet, todo lo que
# sigue fallaría con errores de npm que no le dicen nada al usuario.
$paquete = Join-Path $RepoRoot 'package.json'
if (-not (Test-Path $paquete)) {
    Terminar-Con-Error 'Esta no parece ser la carpeta del wallet.' @(
        'El archivo setup.bat tiene que quedar dentro de la carpeta del',
        'proyecto, junto al archivo package.json.',
        '',
        'Si descargaste un ZIP: descomprimilo entero (clic derecho ->',
        'Extraer todo) y ejecutá setup.bat desde la carpeta extraída, no',
        'desde adentro del ZIP.'
    )
}

Set-Location $RepoRoot
Escribir-Info "Carpeta del wallet: $RepoRoot"

Asegurar-Node

if (-not (Existe-Comando $Npm)) {
    Terminar-Con-Error 'Node.js está instalado pero falta npm.' @(
        'npm viene junto con Node.js, así que esto suele significar que la',
        'instalación de Node quedó a medias.',
        '',
        '1. Abrí https://nodejs.org/en/download',
        '2. Descargá la version LTS para Windows (.msi) e instalala de nuevo.',
        '3. Cerrá esta ventana y volvé a hacer doble clic en setup.bat.'
    )
}

Instalar-Dependencias
Compilar
$tieneAsistente = Asegurar-ClaudeCode
Preparar-Configuracion
Escribir-Cierre -TieneAsistente $tieneAsistente

exit 0
