@echo off
rem ============================================================================
rem NeuroChat - Limpieza de versiones antiguas + firewall (Script de INICIO)
rem
rem Asignar como "Startup Script" de EQUIPO en la GPO (corre como SYSTEM,
rem sin interaccion). Es idempotente: puede quedar asignado permanentemente.
rem
rem Que hace:
rem   1. Cierra NeuroChat si esta abierto
rem   2. Desinstala silenciosamente las instalaciones antiguas por-maquina
rem      (C:\Program Files\NeuroChat) que quedaron de versiones anteriores
rem   3. Borra carpetas huerfanas que el desinstalador haya dejado
rem   4. Registra las reglas de firewall a nivel maquina (asi la app nunca
rem      necesita pedir permisos de administrador para agregarlas)
rem
rem NO toca los datos de los usuarios (%%APPDATA%%\NeuroChat) - el historial
rem de conversaciones se conserva.
rem ============================================================================

rem --- 1. Cerrar la app ---
taskkill /F /IM NeuroChat.exe /T >nul 2>&1

rem --- 2. Desinstalar instalaciones por-maquina antiguas ---
if exist "%ProgramFiles%\NeuroChat\Uninstall NeuroChat.exe" (
  start /wait "" "%ProgramFiles%\NeuroChat\Uninstall NeuroChat.exe" /S
  ping -n 6 127.0.0.1 >nul
)
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\NeuroChat\Uninstall NeuroChat.exe" (
  start /wait "" "%ProgramFiles(x86)%\NeuroChat\Uninstall NeuroChat.exe" /S
  ping -n 6 127.0.0.1 >nul
)

rem --- 3. Borrar restos ---
if exist "%ProgramFiles%\NeuroChat" rd /s /q "%ProgramFiles%\NeuroChat" >nul 2>&1
if defined ProgramFiles(x86) if exist "%ProgramFiles(x86)%\NeuroChat" rd /s /q "%ProgramFiles(x86)%\NeuroChat" >nul 2>&1

rem --- 4. Reglas de firewall a nivel maquina ---
netsh advfirewall firewall delete rule name="NeuroChat UDP"  >nul 2>&1
netsh advfirewall firewall delete rule name="NeuroChat WS"   >nul 2>&1
netsh advfirewall firewall delete rule name="NeuroChat File" >nul 2>&1
netsh advfirewall firewall add rule name="NeuroChat UDP"  protocol=UDP localport=45678 action=allow dir=in profile=any >nul 2>&1
netsh advfirewall firewall add rule name="NeuroChat WS"   protocol=TCP localport=45679 action=allow dir=in profile=any >nul 2>&1
netsh advfirewall firewall add rule name="NeuroChat File" protocol=TCP localport=45680 action=allow dir=in profile=any >nul 2>&1

exit /b 0
