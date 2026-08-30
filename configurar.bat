@echo off
REM ---------------------------------------------------------------------------
REM  Agentic Wallet - abre el asistente que guia la configuracion.
REM
REM  Segundo paso, despues de setup.bat. Abre Claude Code parado en esta
REM  carpeta, que es donde estan docs\onboarding.md y el servidor MCP del
REM  wallet: con eso el asistente ve las herramientas del wallet y puede
REM  llevar adelante el onboarding entero.
REM ---------------------------------------------------------------------------
setlocal
chcp 65001 >nul 2>&1
title Configurar Agentic Wallet
cd /d "%~dp0"

if not exist "%~dp0node_modules" (
    echo.
    echo  Todavia no esta instalado el wallet.
    echo.
    echo  Hace primero doble clic en:  setup.bat
    echo.
    pause
    exit /b 1
)

where claude >nul 2>&1
if errorlevel 1 (
    echo.
    echo  No esta instalado el asistente ^(Claude Code^).
    echo.
    echo  Volve a ejecutar setup.bat y deci que SI cuando te pregunte si
    echo  lo instala, o instalalo desde:
    echo      https://docs.claude.com/en/docs/claude-code/setup
    echo.
    pause
    exit /b 1
)

echo.
echo  ====================================================================
echo    Configurar tu wallet
echo  ====================================================================
echo.
echo  Se va a abrir el asistente. Cuando aparezca, escribile esto:
echo.
echo      Ayudame a terminar de configurar mi wallet.
echo      Segui docs/onboarding.md paso a paso.
echo.
echo  Despues solo contesta lo que te vaya preguntando.
echo.
echo  Tene a mano:
echo    - tu cuenta de Gmail ^(la que recibe los avisos del banco^)
echo    - tu cuenta de Claude ^(Pro o Max^)
echo.
echo  Son unos 30 a 40 minutos. Podes cortar y seguir en otro momento:
echo  vuelve a hacer doble clic aca y el asistente retoma donde quedo.
echo.
echo  --------------------------------------------------------------------
echo.
pause

call claude

echo.
echo  El asistente se cerro.
echo.
echo  Si ya terminaste de configurar, para usar el wallet hace doble clic
echo  en:  iniciar.bat
echo.
pause
exit /b 0
