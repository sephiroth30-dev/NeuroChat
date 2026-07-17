@echo off
setlocal
rem ============================================================================
rem NeuroChat - Instalacion/actualizacion silenciosa (Script de INICIO DE SESION)
rem
rem Asignar como "Logon Script" de USUARIO en la GPO (corre como el usuario,
rem SIN permisos de administrador - la instalacion es por-usuario en
rem %%LOCALAPPDATA%%\Programs\NeuroChat, no requiere UAC).
rem
rem IMPORTANTE - CONFIGURAR ESTAS DOS LINEAS ANTES DE USAR:
rem   INSTALADOR       = ruta UNC del .exe en el recurso compartido del servidor
rem   VERSION_OBJETIVO = version del instalador copiado en esa ruta
rem
rem Despues de la primera instalacion la app se actualiza SOLA en segundo
rem plano (electron-updater, sin UAC). Solo hay que cambiar VERSION_OBJETIVO
rem si se necesita forzar una reinstalacion (p.ej. una version danada que no
rem puede auto-actualizarse).
rem ============================================================================

set "INSTALADOR=\\SERVIDOR\NeuroChat\NeuroChat-Setup-2.3.8.exe"
set "VERSION_OBJETIVO=2.3.8"

set "APPDIR=%LOCALAPPDATA%\Programs\NeuroChat"
set "MARCA=%APPDIR%\gpo-version.txt"

rem --- Ya instalada esta version por GPO? No hacer nada. ---
set "INSTALADA="
if exist "%MARCA%" set /p INSTALADA=<"%MARCA%"
if "%INSTALADA%"=="%VERSION_OBJETIVO%" goto :fin

rem --- Instalador accesible? ---
if not exist "%INSTALADOR%" goto :fin

rem --- Cerrar la app e instalar en silencio (por-usuario, sin UAC) ---
taskkill /F /IM NeuroChat.exe /T >nul 2>&1
start /wait "" "%INSTALADOR%" /S

rem --- Registrar version instalada y arrancar la app ---
if exist "%APPDIR%\NeuroChat.exe" (
  >"%MARCA%" echo %VERSION_OBJETIVO%
  start "" "%APPDIR%\NeuroChat.exe"
)

:fin
endlocal
exit /b 0
