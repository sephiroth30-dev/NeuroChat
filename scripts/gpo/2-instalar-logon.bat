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

set "INSTALADOR=\\SERVIDOR\NeuroChat\NeuroChat-Setup-2.3.9.exe"
set "VERSION_OBJETIVO=2.3.9"

set "APPDIR=%LOCALAPPDATA%\Programs\NeuroChat"
set "MARCA=%APPDIR%\gpo-version.txt"
set "LOG=%TEMP%\neurochat-gpo-install.log"

call :log "=== Inicio (usuario %USERNAME%, equipo %COMPUTERNAME%) ==="

rem --- Ya instalada esta version por GPO Y el ejecutable sigue presente?
rem     Si el marcador existe pero el .exe desaparecio (instalacion corrupta
rem     o borrada a mano), se ignora el marcador y se reinstala igual. ---
set "INSTALADA="
if exist "%MARCA%" set /p INSTALADA=<"%MARCA%"
if "%INSTALADA%"=="%VERSION_OBJETIVO%" if exist "%APPDIR%\NeuroChat.exe" (
  call :log "Ya instalada %VERSION_OBJETIVO% y NeuroChat.exe presente - nada que hacer."
  goto :fin
)
if "%INSTALADA%"=="%VERSION_OBJETIVO%" if not exist "%APPDIR%\NeuroChat.exe" (
  call :log "Marcador dice %VERSION_OBJETIVO% pero NeuroChat.exe no existe - reinstalando."
)

rem --- Instalador accesible? ---
if not exist "%INSTALADOR%" (
  call :log "ERROR: instalador no accesible en %INSTALADOR%"
  goto :fin
)

rem --- Cerrar la app e instalar en silencio (por-usuario, sin UAC) ---
call :log "Instalando %VERSION_OBJETIVO% desde %INSTALADOR%..."
taskkill /F /IM NeuroChat.exe /T >nul 2>&1
start /wait "" "%INSTALADOR%" /S

rem --- Registrar version instalada y arrancar la app ---
if exist "%APPDIR%\NeuroChat.exe" (
  >"%MARCA%" echo %VERSION_OBJETIVO%
  call :log "Instalacion OK - NeuroChat.exe presente."
  start "" "%APPDIR%\NeuroChat.exe"
) else (
  call :log "ERROR: instalacion silenciosa termino pero NeuroChat.exe no aparece en %APPDIR%"
)

:fin
endlocal
exit /b 0

:log
rem %~1 strips the caller's quotes, so keep it quoted here — otherwise a
rem literal &, |, <, >, or ^ inside the text (e.g. from %USERNAME%) would be
rem parsed as a batch operator instead of logged as plain text.
>>"%LOG%" echo [%DATE% %TIME%] "%~1"
exit /b 0
