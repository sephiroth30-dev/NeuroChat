# Despliegue de NeuroChat por GPO (Windows Server 2008 R2)

Guía para desplegar NeuroChat en toda la entidad **sin que los usuarios vean
solicitudes de contraseña de administrador**, con **actualizaciones automáticas
silenciosas** y **sin perder el historial de conversaciones**.

---

## Por qué la instalación es por-usuario (y no en Program Files)

| | Por-máquina (`Program Files`) | Por-usuario (`%LOCALAPPDATA%\Programs`) |
|---|---|---|
| Instalar requiere admin | ✅ Sí (UAC/credenciales) | ❌ No |
| Auto-actualización silenciosa | ❌ Falla — el usuario no puede escribir en Program Files | ✅ Funciona |
| Desplegable por GPO | Solo con MSI (NeuroChat es NSIS .exe) | ✅ Con logon script |

**Las versiones ≤ 2.3.7 mezclaron ambos modos y por eso aparecían las
solicitudes de contraseña y las versiones viejas que no se desinstalaban.**
Desde v2.3.9 todo es por-usuario y las versiones por-máquina se limpian una
sola vez con el script de inicio.

> Nota: Server 2008 R2 solo puede desplegar software por GPO en formato MSI.
> Por eso usamos scripts (startup + logon), que sí soportan .exe.

## Dónde queda cada cosa

| Qué | Dónde | Se borra al desinstalar |
|---|---|---|
| Aplicación | `%LOCALAPPDATA%\Programs\NeuroChat` | Sí |
| Historial (BD) | `%APPDATA%\NeuroChat\neurochat.db` | No |
| Backup 1 (local) | `%APPDATA%\NeuroChat\neurochat.db.bak` | No |
| Backup 2 (a prueba de desinstalación) | `%LOCALAPPDATA%\NeuroChat-Backup\` | **Nunca** |

Si al iniciar la app la base está vacía o dañada, NeuroChat restaura
automáticamente desde los backups (cada 6 horas se refrescan).

---

## Pasos de despliegue

### 1. Publicar el instalador en un recurso compartido

Copia `NeuroChat-Setup-2.3.9.exe` (descargado del Release de GitHub) a una
carpeta compartida con permiso de **lectura para todos los usuarios**, p. ej.:

```
\\SERVIDOR\NeuroChat\NeuroChat-Setup-2.3.9.exe
```

### 2. Script de inicio de EQUIPO — limpieza (una configuración, corre siempre)

`scripts/gpo/1-limpieza-startup.bat` — corre como SYSTEM al arrancar cada PC:

- Desinstala en silencio las versiones viejas de `C:\Program Files\NeuroChat`
  (incluida la 2.3.5 dañada del error `better-sqlite3\package.json`)
- Borra carpetas huérfanas
- Registra las reglas de firewall a nivel máquina (puertos 45678/45679/45680)
  → la app ya **nunca** pide elevación para el firewall

**GPMC:** Configuración del equipo → Directivas → Configuración de Windows →
Scripts (inicio/apagado) → **Inicio** → Agregar → `1-limpieza-startup.bat`.

Es idempotente: puede quedar asignado permanentemente.

### 3. Script de inicio de SESIÓN — instalación (corre como el usuario, sin UAC)

Edita las dos primeras variables de `scripts/gpo/2-instalar-logon.bat`:

```bat
set "INSTALADOR=\\SERVIDOR\NeuroChat\NeuroChat-Setup-2.3.9.exe"
set "VERSION_OBJETIVO=2.3.9"
```

**GPMC:** Configuración de usuario → Directivas → Configuración de Windows →
Scripts (inicio/cierre de sesión) → **Inicio de sesión** → Agregar →
`2-instalar-logon.bat`.

El script instala en silencio (`/S`) por-usuario — sin ventanas, sin UAC — y
deja la app abierta. Si ya está instalada esa versión, no hace nada (termina
en milisegundos).

### 4. Reiniciar los equipos (o `gpupdate /force` + reinicio)

Orden en el primer arranque: limpieza (startup, SYSTEM) → login del usuario →
instalación por-usuario. Desde ahí en adelante todo es automático.

---

## Actualizaciones futuras

**No hay que hacer nada.** La app revisa GitHub cada hora, descarga la nueva
versión en segundo plano y se instala sola (instalación por-usuario = sin
credenciales). El usuario solo ve una notificación de "se instalará en 10
minutos".

Solo hay que volver a tocar la GPO si una versión queda tan dañada que no
arranca (y por tanto no puede auto-actualizarse): copiar el nuevo .exe al
recurso compartido y actualizar `INSTALADOR` y `VERSION_OBJETIVO` en el
logon script — eso fuerza la reinstalación en el próximo inicio de sesión.

---

## Solución de problemas

| Síntoma | Causa | Solución |
|---|---|---|
| Error `better-sqlite3\package.json` al iniciar | Instalador viejo (≤2.3.5 original) aún desplegado | Verificar que el .exe del recurso compartido sea ≥ 2.3.9; el startup script elimina la copia dañada de Program Files |
| Pide contraseña al instalar | Se está ejecutando un instalador viejo por-máquina | Usar el .exe ≥ 2.3.9 (por-usuario, no eleva) |
| Pide contraseña al abrir la app | Faltan reglas de firewall y la app intenta crearlas | Asignar el startup script (paso 2); desde v2.3.9 se intenta como máximo 3 veces (solo cuenta fallos confirmados) |
| No aparecen usuarios conectados | Firewall bloquea 45678/45679 | Verificar reglas: `netsh advfirewall firewall show rule name="NeuroChat WS"` |
| Historial desapareció | BD vacía tras reinstalación | v2.3.9 restaura solo desde `%LOCALAPPDATA%\NeuroChat-Backup`; si no, copiar ese archivo a `%APPDATA%\NeuroChat\neurochat.db` |
