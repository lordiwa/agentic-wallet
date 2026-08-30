@echo off
REM ---------------------------------------------------------------------------
REM  Agentic Wallet - instalador para Windows.
REM
REM  Este archivo es a proposito un lanzador minimo: toda la logica real vive en
REM  tools\windows\setup.ps1. Batch no sabe comparar versiones, descargar
REM  archivos ni leer un log; PowerShell si, y viene instalado en todo Windows
REM  10 y 11. Manteniendo este .bat en ASCII y sin ramas complicadas se evita
REM  la clase de error que nadie puede depurar por telefono.
REM
REM  Uso: doble clic, o desde una terminal:  setup.bat
REM ---------------------------------------------------------------------------
setlocal
chcp 65001 >nul 2>&1
title Instalador de Agentic Wallet
cd /d "%~dp0"

set "PS_SCRIPT=%~dp0tools\windows\setup.ps1"

if not exist "%PS_SCRIPT%" (
    echo.
    echo  No se encontro el archivo tools\windows\setup.ps1
    echo.
    echo  Parece que la carpeta se copio incompleta. Volve a descargar el
    echo  proyecto entero y asegurate de descomprimir TODO el ZIP.
    echo.
    pause
    exit /b 1
)

where powershell.exe >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Esta computadora no tiene PowerShell y el instalador lo necesita.
    echo  PowerShell viene incluido en Windows 10 y Windows 11.
    echo.
    echo  Si estas en una version mas vieja de Windows, actualiza Windows
    echo  primero y volve a intentar.
    echo.
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
set "CODIGO=%ERRORLEVEL%"

echo.
if not "%CODIGO%"=="0" (
    echo  ---------------------------------------------------------------
    echo   La instalacion NO termino. Arriba dice que paso y que hacer.
    echo   Podes volver a ejecutar setup.bat cuantas veces quieras: no
    echo   rompe nada y retoma donde quedo.
    echo  ---------------------------------------------------------------
)

echo.
pause
exit /b %CODIGO%
