@echo off
REM ---------------------------------------------------------------------------
REM  Agentic Wallet - arranca el wallet y abre el navegador.
REM
REM  Tercer paso: el de todos los dias. setup.bat se corre una sola vez,
REM  configurar.bat hasta que el checklist este completo, y este de aca cada
REM  vez que se quiera mirar el dashboard.
REM ---------------------------------------------------------------------------
setlocal
chcp 65001 >nul 2>&1
title Agentic Wallet
cd /d "%~dp0"

if not exist "%~dp0node_modules" (
    echo.
    echo  Todavia no esta instalado el wallet.
    echo  Hace primero doble clic en:  setup.bat
    echo.
    pause
    exit /b 1
)

if not exist "%~dp0.env" (
    echo.
    echo  Todavia no esta configurado el wallet.
    echo  Hace primero doble clic en:  configurar.bat
    echo.
    pause
    exit /b 1
)

echo.
echo  ====================================================================
echo    Agentic Wallet
echo  ====================================================================
echo.
echo  Arrancando... el navegador se abre solo en unos segundos.
echo.
echo  Si no se abre, entra vos a:   http://localhost:3000
echo.
echo  IMPORTANTE: deja esta ventana abierta mientras uses el wallet.
echo  Para cerrarlo, cerra esta ventana.
echo.
echo  --------------------------------------------------------------------
echo.

REM El navegador se abre en un proceso aparte para no bloquear el arranque
REM del servidor. La espera le da tiempo a compilar y escuchar el puerto.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 12; Start-Process 'http://localhost:3000'"

call npm.cmd run dev

echo.
echo  El wallet se detuvo.
echo.
pause
exit /b 0
