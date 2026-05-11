# PROMPT MAESTRO — NeuroChat
## Para usar en Claude Code (VS Code)

---

> **Cómo usarlo:** Abre Claude Code en VS Code, crea una carpeta vacía llamada `neurochat`, ábrela como workspace y pega este prompt completo. Claude Code construirá todo el proyecto desde cero.

---

## CONTEXTO DEL PROYECTO

Eres el arquitecto y desarrollador principal de **NeuroChat**, una aplicación de mensajería instantánea para red local (LAN) desarrollada para la empresa **Neurofit**. La aplicación forma parte de la familia de herramientas internas de Neurofit, junto con Neurotex (sistema de tickets de soporte).

NeuroChat es un **chat corporativo interno** que funciona exclusivamente dentro de la red local de la empresa, sin necesidad de internet, sin servidor central dedicado, y con descubrimiento automático de usuarios. Se distribuye como instalador `.exe` para Windows 10 y Windows 11.

---

## OBJETIVO

Construir NeuroChat completo: una aplicación Electron empaquetada como instalador `.exe` para Windows, con arquitectura P2P (peer-to-peer) sobre red local, interfaz moderna inspirada en WhatsApp/Telegram, y sin requerir ninguna configuración manual del usuario.

---

## STACK TECNOLÓGICO

```
Runtime:        Electron (última versión estable)
Backend:        Node.js (proceso principal de Electron)
Frontend:       HTML + CSS + Vanilla JS (proceso renderer)
Base de datos:  better-sqlite3 (SQLite local por equipo)
WebSockets:     ws (librería Node.js)
Descubrimiento: dgram (UDP nativo de Node.js)
Archivos:       net (TCP nativo de Node.js)
Empaquetado:    electron-builder con target NSIS (instalador .exe Windows)
Fuentes:        DM Sans + DM Mono (Google Fonts, incluidas localmente)
```

**No usar:** React, Vue, Angular, ni ningún framework de UI. Solo HTML/CSS/JS vanilla en el renderer para mantener el bundle ligero y el control total.

---

## ARQUITECTURA TÉCNICA

### Puertos utilizados
| Puerto | Protocolo | Uso |
|--------|-----------|-----|
| 45678  | UDP       | Descubrimiento de usuarios (broadcast) |
| 45679  | TCP/WS    | Chat en tiempo real (WebSocket) |
| 45680  | TCP       | Transferencia de archivos |

### Descubrimiento de usuarios (UDP Broadcast)
- Al arrancar, cada instancia genera o carga un **UUID único** guardado en disco (nunca cambia, identidad permanente del equipo)
- Emite un broadcast UDP cada **30 segundos** con payload JSON:
  ```json
  {
    "type": "NEUROCHAT_ANNOUNCE",
    "uuid": "uuid-unico-del-equipo",
    "name": "NombreUsuario",
    "avatar": "inicial-o-ruta",
    "color": "#HEX",
    "status": "available|away|dnd|invisible",
    "wsPort": 45679,
    "ip": "192.168.x.x",
    "version": "1.0.0"
  }
  ```
- Escucha broadcasts entrantes en UDP 45678
- Si no recibe señal de un UUID en **90 segundos** → ese usuario pasa a offline
- Un usuario con `status: "invisible"` no emite broadcasts pero sí escucha

### Comunicación (WebSocket)
- Cada instancia levanta un servidor WebSocket en TCP 45679
- Los mensajes van **directamente de PC a PC** (sin intermediario)
- Para canales: el remitente envía el mensaje a **todos los miembros online** del canal simultáneamente
- Formato de mensaje WebSocket (JSON):
  ```json
  {
    "type": "MESSAGE|FILE_OFFER|FILE_ACCEPT|FILE_REJECT|REACTION|EDIT|DELETE|PIN|TYPING|READ_RECEIPT|CHANNEL_SYNC",
    "id": "uuid-del-mensaje",
    "channelId": "canal-id o null si es privado",
    "toUuid": "uuid-destinatario o null si es canal",
    "fromUuid": "uuid-remitente",
    "content": "texto del mensaje",
    "replyTo": "id-mensaje-original o null",
    "timestamp": 1700000000000,
    "edited": false,
    "deleted": false
  }
  ```

### Transferencia de archivos (TCP directo)
- Puerto TCP 45680
- Flujo:
  1. Remitente envía `FILE_OFFER` por WebSocket (nombre, tamaño, tipo MIME, hash SHA-256)
  2. Receptor ve diálogo "Juan quiere enviarte ventas_Q1.xlsx (245 KB) — Aceptar / Rechazar"
  3. Si acepta: conexión TCP directa en puerto 45680, transferencia chunked con progreso
  4. Si rechaza: mensaje `FILE_REJECT` por WebSocket
- Límite por defecto: **500 MB** por archivo (configurable)
- Archivos guardados en carpeta configurable (default: `C:\Users\%USERNAME%\NeuroChat\Archivos`)

---

## ESTRUCTURA DE CARPETAS DEL PROYECTO

```
neurochat/
├── package.json
├── electron-builder.yml
├── .gitignore
│
├── src/
│   ├── main/
│   │   ├── index.js              ← Entry point Electron (proceso principal)
│   │   ├── windowManager.js      ← Gestión de ventanas
│   │   ├── discovery.js          ← UDP broadcast y listener
│   │   ├── wsServer.js           ← Servidor WebSocket
│   │   ├── wsClient.js           ← Cliente WebSocket (conexiones salientes)
│   │   ├── fileTransfer.js       ← TCP file transfer server/client
│   │   ├── database.js           ← SQLite con better-sqlite3
│   │   ├── store.js              ← Estado en memoria (usuarios online, canales)
│   │   ├── notifier.js           ← Notificaciones nativas de Windows
│   │   ├── tray.js               ← Ícono en system tray
│   │   ├── ipcHandlers.js        ← Todos los handlers IPC main↔renderer
│   │   └── diagnostics.js        ← Sistema de diagnóstico de red
│   │
│   └── renderer/
│       ├── index.html            ← Shell principal de la app
│       ├── app.js                ← Lógica principal del renderer
│       ├── router.js             ← Navegación entre vistas
│       ├── ipc.js                ← Llamadas IPC al proceso main
│       │
│       ├── views/
│       │   ├── chat.js           ← Vista de chat (canal o privado)
│       │   ├── settings.js       ← Vista de ajustes de usuario
│       │   └── diagnostics.js    ← Vista de diagnóstico de red
│       │
│       ├── components/
│       │   ├── sidebar.js        ← Lista de canales y usuarios
│       │   ├── messageList.js    ← Renderizado de mensajes
│       │   ├── messageInput.js   ← Barra de entrada + adjuntos + emoji
│       │   ├── userAvatar.js     ← Componente de avatar
│       │   ├── filePreview.js    ← Preview de archivos adjuntos
│       │   └── toastNotif.js     ← Notificaciones in-app
│       │
│       └── styles/
│           ├── main.css          ← Variables CSS + reset + layout
│           ├── sidebar.css       ← Estilos del sidebar
│           ├── chat.css          ← Estilos del área de chat
│           ├── components.css    ← Avatares, burbujas, archivos
│           └── settings.css      ← Vista de ajustes
│
├── assets/
│   ├── icon.ico                  ← Ícono de la app (Windows)
│   ├── icon.png                  ← Ícono PNG 512x512
│   ├── tray-icon.ico             ← Ícono para system tray
│   └── fonts/
│       ├── DMSans-Light.woff2
│       ├── DMSans-Regular.woff2
│       ├── DMSans-Medium.woff2
│       ├── DMSans-SemiBold.woff2
│       └── DMMono-Regular.woff2
│
└── build/                        ← Generado por electron-builder (no en git)
```

---

## BASE DE DATOS (SQLite local — better-sqlite3)

Archivo ubicado en: `%APPDATA%\NeuroChat\neurochat.db`

```sql
-- Perfil propio del usuario
CREATE TABLE IF NOT EXISTS my_profile (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  color TEXT DEFAULT '#4A9E8F',
  status TEXT DEFAULT 'available'
);

-- Usuarios conocidos (online o vistos antes)
CREATE TABLE IF NOT EXISTS users (
  uuid TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  color TEXT,
  last_seen INTEGER,
  is_online INTEGER DEFAULT 0
);

-- Canales
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT,
  created_at INTEGER,
  is_default INTEGER DEFAULT 0
);

-- Mensajes (canales y privados)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  private_chat_uuid TEXT,
  from_uuid TEXT NOT NULL,
  content TEXT,
  type TEXT DEFAULT 'text',
  reply_to TEXT,
  timestamp INTEGER NOT NULL,
  edited INTEGER DEFAULT 0,
  deleted INTEGER DEFAULT 0,
  delivered INTEGER DEFAULT 0,
  read_by TEXT DEFAULT '[]'
);

-- Reacciones
CREATE TABLE IF NOT EXISTS reactions (
  message_id TEXT NOT NULL,
  user_uuid TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_uuid)
);

-- Archivos compartidos
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  original_name TEXT,
  local_path TEXT,
  size INTEGER,
  mime_type TEXT,
  sha256 TEXT,
  timestamp INTEGER
);

-- Mensajes anclados por canal
CREATE TABLE IF NOT EXISTS pinned_messages (
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  pinned_by TEXT,
  pinned_at INTEGER,
  PRIMARY KEY (channel_id, message_id)
);
```

---

## IDENTIDAD VISUAL Y DISEÑO

### Nombre y marca
- **Nombre de la app:** NeuroChat
- **Tagline:** "by Neurofit"
- **Familia de productos:** Neurofit · Neurotex · NeuroChat

### Tipografía
- **Principal:** DM Sans (weights: 300, 400, 500, 600)
- **Monoespaciada:** DM Mono (weight: 400, 500) — para código y hashes

### Paleta de colores — Modo claro (default)
```css
--nc-primary:      #4A9E8F;   /* Teal — color principal */
--nc-primary-lt:   #6BBDAF;   /* Teal claro — hover */
--nc-primary-dk:   #2E7A6D;   /* Teal oscuro — activo */
--nc-bubble-out:   #DCF0ED;   /* Burbuja mensajes salientes */
--nc-bubble-in:    #FFFFFF;   /* Burbuja mensajes entrantes */
--nc-bg:           #F4F6F8;   /* Fondo del área de chat */
--nc-sidebar:      #FFFFFF;   /* Fondo del sidebar */
--nc-text:         #1A2530;   /* Texto principal */
--nc-text-2:       #6B7B8A;   /* Texto secundario / timestamps */
--nc-border:       #E2E8EE;   /* Bordes y divisores */
--nc-online:       #3CB371;   /* Estado disponible */
--nc-away:         #F0A500;   /* Estado ausente */
--nc-dnd:          #E05A5A;   /* Estado no molestar */
--nc-unread:       #4A9E8F;   /* Badge mensajes no leídos */
--nc-input-bg:     #F4F6F8;   /* Fondo campo de texto */
```

### Paleta — Modo oscuro (automático según Windows)
```css
--nc-primary:      #4A9E8F;
--nc-primary-lt:   #6BBDAF;
--nc-bubble-out:   #2B5278;
--nc-bubble-in:    #182533;
--nc-bg:           #0E1621;
--nc-sidebar:      #17212B;
--nc-text:         #FFFFFF;
--nc-text-2:       #8E9BAB;
--nc-border:       #232E3C;
--nc-input-bg:     #232E3C;
```

**El tema se detecta automáticamente** con `nativeTheme.shouldUseDarkColors` de Electron y se aplica añadiendo/quitando la clase `dark` en `<html>`. No hay toggle manual — sigue al sistema operativo.

### Principios de diseño
- **Minimalista y limpio:** sin elementos decorativos innecesarios
- **Familiar:** layout idéntico al de WhatsApp/Telegram Desktop (sidebar izquierdo + área de chat derecha)
- **Sin bordes agresivos:** border-radius generoso (8–16px)
- **Densidad media:** ni demasiado compacto ni demasiado espacioso
- **Sin colores estridentes:** toda la paleta es suave y corporativa
- **Sombras sutiles:** `box-shadow: 0 1px 3px rgba(0,0,0,0.06)` máximo

### Logo (SVG inline)
```svg
<svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="80" height="80" rx="20" fill="#4A9E8F"/>
  <path d="M22 28C22 25.8 23.8 24 26 24H54C56.2 24 58 25.8 58 28V46C58 48.2 56.2 50 54 50H44L36 58V50H26C23.8 50 22 48.2 22 46V28Z" fill="white"/>
  <circle cx="32" cy="37" r="3" fill="#4A9E8F"/>
  <circle cx="40" cy="37" r="3" fill="#4A9E8F"/>
  <circle cx="48" cy="37" r="3" fill="#4A9E8F"/>
</svg>
```

---

## FUNCIONALIDADES COMPLETAS

### Gestión de usuario propio
- [ ] Al primer arranque: solicitar nombre (pre-rellenado con `os.userInfo().username`)
- [ ] Cambiar nombre de usuario
- [ ] Cambiar avatar: galería de 12 avatares predefinidos o subir imagen propia (se recorta a círculo)
- [ ] Si no hay avatar: inicial del nombre con color de fondo asignado aleatoriamente del set de colores corporativos
- [ ] Cambiar estado: Disponible / Ausente / No molestar / Invisible
- [ ] Ausente automático tras 10 minutos de inactividad (sin escritura ni clics en la app)
- [ ] Recupera estado "Disponible" al volver a interactuar

### Canales
- [ ] Canal `# general` creado automáticamente en la primera instalación y propagado a la red
- [ ] Cualquier usuario puede crear un canal (nombre, descripción opcional)
- [ ] Los canales se sincronizan automáticamente: al detectar un usuario nuevo, se intercambia la lista de canales conocidos
- [ ] El creador del canal es administrador (puede renombrarlo, eliminarlo, anclar mensajes)
- [ ] Cualquier usuario puede unirse o salir de un canal (excepto `# general`)
- [ ] Indicador de usuarios online en cada canal

### Mensajería
- [ ] Texto con soporte de formato básico: **negrita** (`**texto**`), _cursiva_ (`_texto_`), `código` (backtick)
- [ ] Panel de emojis (emoji-picker integrado, sin librerías externas — usar el nativo del OS o un picker HTML simple)
- [ ] **Responder** a mensaje específico (muestra preview del mensaje original en la burbuja)
- [ ] **Reaccionar** con emoji: 👍 ❤️ 😂 😮 😢 — click en mensaje → menú de reacciones
- [ ] **Editar** mensaje propio (máximo 24h después) — muestra etiqueta "editado"
- [ ] **Eliminar** mensaje propio — muestra "Mensaje eliminado"
- [ ] **Copiar** texto de mensaje (opción en menú contextual)
- [ ] **Anclar** mensaje en canal (solo admin del canal) — aparece banner en la parte superior del chat
- [ ] **Indicador de escritura** ("Juan está escribiendo...") — enviado por WebSocket con debounce de 2s
- [ ] **Confirmaciones de entrega:** ✓ enviado → ✓✓ recibido → ✓✓ (azul) leído
- [ ] **Mensajes offline:** si el destinatario no está online, el mensaje se guarda localmente y se entrega cuando el destinatario se conecta
- [ ] Timestamps relativos: "ahora", "hace 5 min", "10:30", "Ayer 10:30", "Lun 10:30"

### Compartir archivos
- [ ] Adjuntar archivo: botón 📎 o **drag & drop** al área de chat
- [ ] Preview inline de imágenes (JPG, PNG, GIF, WebP) antes de enviar
- [ ] El receptor ve diálogo con nombre, tamaño y tipo — puede Aceptar o Rechazar
- [ ] Barra de progreso durante la transferencia (con velocidad en KB/s)
- [ ] Cancelar transferencia en curso
- [ ] Al hacer click en archivo recibido → abre con la aplicación predeterminada de Windows
- [ ] Límite: 500 MB por archivo
- [ ] Carpeta de destino configurable (default: `C:\Users\%USERNAME%\NeuroChat\Archivos\`)

### Búsqueda
- [ ] Buscar en historial de la conversación activa
- [ ] Buscar en todos los canales y chats
- [ ] Los resultados muestran contexto y al hacer click navega al mensaje
- [ ] Filtrar por tipo: todo / mensajes / archivos

### Notificaciones
- [ ] Notificación nativa de Windows (toast) con nombre del remitente y preview del mensaje
- [ ] Click en notificación → abre NeuroChat y navega a esa conversación
- [ ] Badge con número de mensajes no leídos en el ícono del taskbar
- [ ] Sonido de notificación configurable (activar/desactivar)
- [ ] Las notificaciones se silencian si el canal/chat está abierto y la ventana tiene foco
- [ ] Estado "No molestar" desactiva notificaciones de todos los canales excepto menciones directas `@nombre`

### System Tray
- [ ] NeuroChat se minimiza a la bandeja del sistema (system tray) al cerrar la ventana
- [ ] Ícono en tray cambia según estado propio: verde/amarillo/rojo/gris
- [ ] Menú contextual en tray: Abrir / Estado → [submenu] / Salir
- [ ] Doble click en tray → restaura ventana

### Ajustes
- [ ] Perfil: nombre, avatar, color
- [ ] Estado: selector de estado
- [ ] Notificaciones: activar/desactivar sonido, activar/desactivar notificaciones de sistema
- [ ] Archivos: cambiar carpeta de descarga
- [ ] Red: ver IP actual, puertos en uso, botón "Ejecutar diagnóstico"
- [ ] Arranque con Windows: toggle (usar electron-store o registro)
- [ ] Acerca de: versión, nombre de la app, Neurofit

### Diagnóstico de red
Pantalla accesible desde Ajustes > Red > "Ejecutar diagnóstico":

| Check | Éxito | Fallo |
|-------|-------|-------|
| Interfaz de red | ✅ IP detectada: 192.168.x.x | ❌ No se detectó interfaz de red activa |
| Puerto UDP 45678 | ✅ Puerto libre y escuchando | ❌ Puerto bloqueado — [Botón: Añadir excepción automáticamente] |
| Puerto TCP 45679 | ✅ WebSocket server activo | ❌ Puerto en uso por otra aplicación |
| Puerto TCP 45680 | ✅ File transfer server activo | ❌ Puerto bloqueado |
| Usuarios en red | ✅ X usuarios detectados | ⚠️ 0 usuarios — verifica que otros equipos tengan NeuroChat abierto |
| Nombre duplicado | ✅ Nombre único en la red | ⚠️ Hay otro usuario con tu mismo nombre — tu UUID los diferencia |
| Múltiples interfaces | ✅ Una sola interfaz activa | ⚠️ Múltiples interfaces — selecciona cuál usar: [dropdown] |

El botón "Añadir excepción automáticamente" ejecuta (requiere elevación UAC):
```
netsh advfirewall firewall add rule name="NeuroChat UDP" protocol=UDP localport=45678 action=allow dir=in
netsh advfirewall firewall add rule name="NeuroChat WS" protocol=TCP localport=45679 action=allow dir=in
netsh advfirewall firewall add rule name="NeuroChat File" protocol=TCP localport=45680 action=allow dir=in
```

---

## INSTALADOR (.exe)

Configuración `electron-builder.yml`:
```yaml
appId: com.neurofit.neurochat
productName: NeuroChat
copyright: © 2025 Neurofit
directories:
  output: build
win:
  target: nsis
  icon: assets/icon.ico
  requestedExecutionLevel: requireAdministrator
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  installerIcon: assets/icon.ico
  uninstallerIcon: assets/icon.ico
  installerHeaderIcon: assets/icon.ico
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: NeuroChat
  include: installer-script.nsh
```

El instalador debe:
1. Instalar la app en `C:\Program Files\NeuroChat\` (o carpeta elegida)
2. Crear acceso directo en escritorio y menú inicio
3. Añadir automáticamente las excepciones de firewall de Windows (los 3 puertos)
4. Registrar el desinstalador en "Agregar o quitar programas"
5. Opción de arrancar con Windows (checkbox en el installer)

---

## FASES DE DESARROLLO — Construir en este orden

### FASE 1 — Esqueleto del proyecto
1. Inicializar proyecto con `package.json` correcto
2. Configurar Electron con `contextIsolation: true` y `preload.js`
3. Crear estructura de carpetas completa
4. Configurar `electron-builder.yml`
5. Script `npm start` para desarrollo y `npm run build` para producción

### FASE 2 — Descubrimiento UDP
1. Implementar `discovery.js`: generación de UUID, broadcast cada 30s, listener
2. Implementar `store.js`: mapa en memoria de usuarios online
3. Exponer eventos al renderer via IPC: `users:updated`
4. Prueba: al arrancar dos instancias en la misma red, ambas se ven

### FASE 3 — Base de datos
1. Implementar `database.js` con todas las tablas definidas arriba
2. Métodos CRUD para: perfil propio, usuarios, canales, mensajes, reacciones, archivos, mensajes anclados
3. Migración automática de esquema en futuras versiones (guardar versión de DB)

### FASE 4 — WebSocket (chat)
1. Implementar `wsServer.js`: servidor WebSocket en 45679
2. Implementar `wsClient.js`: conexiones salientes a otros usuarios
3. Manejar todos los tipos de mensaje definidos
4. Chat privado funcional entre dos usuarios
5. Canales: envío a múltiples destinatarios

### FASE 5 — Interfaz de usuario
1. Layout principal: sidebar + área de chat
2. Componente sidebar: canales, usuarios directos, estado propio
3. Componente lista de mensajes: burbujas, avatares, timestamps, confirmaciones
4. Componente input: texto, emoji picker, adjuntar archivo
5. Modo claro / oscuro automático con `nativeTheme`
6. Aplicar paleta de colores y tipografía DM Sans completa

### FASE 6 — Transferencia de archivos
1. Implementar `fileTransfer.js`: servidor TCP 45680
2. Flujo completo: oferta → aceptar/rechazar → transferencia → progreso
3. Preview de imágenes inline
4. Guardado en carpeta de usuario

### FASE 7 — Funciones avanzadas de mensajería
1. Responder a mensajes
2. Reacciones con emoji
3. Editar / eliminar mensajes
4. Anclar mensajes (banner en canal)
5. Indicador de escritura
6. Confirmaciones de lectura (✓✓ azul)
7. Mensajes offline (queue local)

### FASE 8 — Notificaciones y tray
1. Notificaciones nativas de Windows
2. Badge de mensajes no leídos
3. System tray con menú y cambio de estado
4. Minimizar a tray al cerrar

### FASE 9 — Ajustes y diagnóstico
1. Vista de ajustes completa
2. Sistema de diagnóstico de red
3. Añadir excepción de firewall automática

### FASE 10 — Empaquetado
1. Generar ícono `icon.ico` de 256x256 con el logo de NeuroChat
2. Script de instalador NSIS con excepciones de firewall automáticas
3. `npm run build` → genera `build/NeuroChat Setup 1.0.0.exe`
4. Probar instalación en Windows 10 y Windows 11

---

## REGLAS DE DESARROLLO

1. **Seguridad Electron:** Siempre `contextIsolation: true`, `nodeIntegration: false`, usar `preload.js` para exponer APIs al renderer via `contextBridge`
2. **IPC:** Toda comunicación main↔renderer va por `ipcMain` / `ipcRenderer`. Nunca exponer Node.js directamente al renderer
3. **Errores:** Todos los errores de red deben ser capturados y logeados. Nunca crashear silenciosamente
4. **UUID:** Generado con `crypto.randomUUID()` (nativo de Node.js, sin dependencias)
5. **Timestamps:** Siempre en UTC (milliseconds desde epoch). La conversión a hora local la hace el renderer
6. **Compatibilidad:** Windows 10 (64-bit) mínimo, Windows 11 objetivo principal
7. **Sin dependencias innecesarias:** Evaluar cada dependencia. Preferir APIs nativas de Node.js cuando sea posible
8. **Datos de usuario:** Guardar en `app.getPath('userData')` → `%APPDATA%\NeuroChat\`

---

## DEPENDENCIAS (package.json)

```json
{
  "name": "neurochat",
  "version": "1.0.0",
  "description": "Mensajería interna LAN para Neurofit",
  "main": "src/main/index.js",
  "author": "Neurofit",
  "license": "UNLICENSED",
  "private": true,
  "scripts": {
    "start": "electron .",
    "build": "electron-builder",
    "build:win": "electron-builder --win"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "electron": "^29.0.0",
    "electron-builder": "^24.9.1"
  }
}
```

---

## CÓMO EMPEZAR

Claude Code debe ejecutar los siguientes pasos en orden:

```bash
# 1. Crear estructura de carpetas
mkdir -p src/main src/renderer/views src/renderer/components src/renderer/styles assets/fonts build

# 2. Inicializar proyecto Node.js
npm init -y

# 3. Instalar dependencias
npm install better-sqlite3 ws
npm install --save-dev electron electron-builder

# 4. Empezar por la Fase 1: configurar Electron correctamente
# Crear src/main/index.js con ventana básica
# Crear src/renderer/index.html con layout base
# Verificar que `npm start` abre la ventana

# 5. Continuar con las fases en orden
```

**Importante:** Completar y verificar cada fase antes de pasar a la siguiente. Al final de cada fase, la aplicación debe poder arrancarse con `npm start` sin errores.

---

*NeuroChat v1.0.0 — Neurofit Internal Tools*
*Prompt generado para Claude Code — Mayo 2025*
