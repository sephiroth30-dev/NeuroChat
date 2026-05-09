# CHANGELOG — NeuroChat

Todas las mejoras notables se documentan aquí.
Formato: `[version] — fecha — descripción`

---

## [1.0.0] — 2026-05-08 — Fase 1: Esqueleto del proyecto

### Añadido
- Estructura de carpetas completa del proyecto (`src/main/`, `src/renderer/`, `assets/`)
- `package.json` con dependencias: `better-sqlite3`, `ws`, `electron`, `electron-builder`, `@electron/rebuild`
- `electron-builder.yml` configurado para generar instalador `.exe` NSIS (Windows)
- `.gitignore` con exclusiones estándar
- `installer-script.nsh` — script NSIS para añadir reglas de firewall automáticamente al instalar

#### Proceso principal (Electron Main)
- `src/main/index.js` — Entry point con ciclo de vida completo de la app
- `src/main/preload.js` — `contextBridge` con toda la API IPC expuesta al renderer de forma segura (`contextIsolation: true`, `nodeIntegration: false`)
- `src/main/windowManager.js` — Gestión de ventana principal (minimiza a tray al cerrar, instancia única)
- `src/main/database.js` — SQLite local con `better-sqlite3`: todas las tablas (`my_profile`, `users`, `channels`, `messages`, `reactions`, `files`, `pinned_messages`, `settings`), índices y métodos CRUD completos
- `src/main/ipcHandlers.js` — Todos los handlers IPC: perfil, usuarios, canales, mensajes, archivos, búsqueda, ajustes, diagnóstico
- `src/main/store.js` — Estado en memoria: mapa de usuarios online, cola de mensajes pendientes, transferencias activas
- `src/main/tray.js` — Ícono en bandeja del sistema con menú contextual
- `src/main/notifier.js` — Notificaciones nativas del SO
- `src/main/diagnostics.js` — Sistema de diagnóstico de red (puertos UDP/TCP, IP local, reglas de firewall)
- Stubs para fases futuras: `discovery.js`, `wsServer.js`, `wsClient.js`, `fileTransfer.js`

#### Renderer (Frontend)
- `src/renderer/index.html` — Shell de la app: sidebar, área de chat, barra de entrada, modales, setup de primer arranque
- `src/renderer/app.js` — Lógica principal: sidebar de canales/DMs, renderizado de mensajes, contexto, reacciones, emoji picker, búsqueda, drag & drop de archivos
- `src/renderer/views/settings.js` — Vista de ajustes completa: perfil, estado, notificaciones, carpeta de descarga, diagnóstico de red, arranque con Windows
- Placeholders: `views/chat.js`, `views/diagnostics.js`, todos los componentes en `components/`

#### Estilos CSS
- `styles/main.css` — Variables CSS completas (modo claro y oscuro), reset, layout, utilidades, modales, toasts
- `styles/sidebar.css` — Sidebar: header de perfil, buscador, lista de canales y DMs, badges de no leídos
- `styles/chat.css` — Área de chat: header, mensajes, burbujas entrantes/salientes, metadatos, reacciones, input de mensaje, emoji picker
- `styles/components.css` — Avatar, file bubble, image thumbnail, barra de progreso de transferencia
- `styles/settings.css` — Vista de ajustes: toggle switches, galería de avatares, selector de estado, resultados de diagnóstico

### Técnico
- `better-sqlite3` compilado con `@electron/rebuild` para las cabeceras de Electron (no las de Node.js)
- Script `npm start` con `ELECTRON_RUN_AS_NODE=` para neutralizar variable de entorno del shell
- Tema claro/oscuro automático via `nativeTheme.shouldUseDarkColors` de Electron
- Paleta de colores Neurofit: teal primario `#4A9E8F`, tipografía DM Sans + DM Mono

---

## [Próximo] — Fase 2: Descubrimiento UDP

### Planeado
- Implementar `discovery.js`: generación/persistencia de UUID, broadcast UDP cada 30s, listener
- Detectar usuarios online automáticamente en la red local
- Evento `users:updated` via IPC para actualizar el sidebar en tiempo real
- Timeout de 90s para marcar usuarios como offline
- Soporte de estado `invisible` (escucha pero no emite)

---

## [Próximo] — Fase 3: Base de datos

### Planeado
- Completar métodos CRUD pendientes
- Sistema de migración de esquema con versión
- Canal `# general` creado automáticamente en el primer arranque

---

## [Próximo] — Fase 4: WebSocket (Chat)

### Planeado
- Servidor WebSocket en puerto TCP 45679
- Cliente WebSocket para conexiones salientes
- Chat privado entre dos usuarios
- Canales: envío simultáneo a múltiples destinatarios

---

## [Próximo] — Fase 5: Interfaz de usuario (polish)

### Planeado
- Componentes separados para sidebar, lista de mensajes, input
- Fuentes DM Sans locales desde `assets/fonts/`
- Timestamps relativos ("ahora", "hace 5 min", "Ayer 10:30")
- Confirmaciones de entrega: ✓ → ✓✓ → ✓✓ (azul)

---

## [Próximo] — Fase 6: Transferencia de archivos

### Planeado
- Servidor TCP en puerto 45680
- Flujo completo: oferta → aceptar/rechazar → transferencia chunked → progreso
- Preview inline de imágenes
- Límite de 500 MB

---

## [Próximo] — Fase 7: Funciones avanzadas de mensajería

### Planeado
- Responder a mensajes (con preview del original)
- Reacciones con emoji
- Editar / eliminar mensajes
- Anclar mensajes (banner en canal)
- Indicador de escritura ("Juan está escribiendo…")
- Cola de mensajes offline

---

## [Próximo] — Fase 8: Notificaciones y tray

### Planeado
- Notificaciones nativas de Windows con click para navegar
- Badge de mensajes no leídos en ícono del taskbar
- Ícono de tray cambia según estado (verde/amarillo/rojo/gris)

---

## [Próximo] — Fase 9: Ajustes y diagnóstico

### Planeado
- Vista de ajustes completamente conectada al IPC
- Diagnóstico de red interactivo
- Excepción de firewall automática con elevación UAC

---

## [1.0.0] — 2026-05-09 — Fase 10: Empaquetado Windows

### Añadido
- `assets/icon.ico` y `assets/tray-icon.ico` — ícono multi-resolución (16/32/48/256 px)
  generado con PNG-in-ICO puro Python, sin dependencias externas
- `electron-builder.yml` mejorado:
  - `asar: true` + `asarUnpack` para `better-sqlite3` (native module fuera del archive)
  - `requestedExecutionLevel: asInvoker` — la app ya no pide UAC en cada arranque;
    el instalador NSIS gestiona las reglas de firewall en el momento de la instalación
  - Documentación inline de cada sección
- Scripts de versión en `package.json`:
  - `npm run release:patch` — bump `1.0.0 → 1.0.1`, commit, tag `v1.0.1`, push
  - `npm run release:minor` — bump `1.0.0 → 1.1.0`
  - `npm run release:major` — bump `1.0.0 → 2.0.0`
- GitHub Actions `release.yml` ya configurado: al hacer push del tag `v*` ejecuta
  quality gate (lint + format + tests) → build Windows en `windows-latest` →
  crea GitHub Release con el `.exe`

### Cómo generar el instalador
```bash
# Localmente (requiere Windows o Wine+NSIS en macOS/Linux)
npm run build:win        # → build/NeuroChat Setup 1.0.0.exe

# Crear release vía CI (recomendado)
npm run release:patch    # sube tag v1.0.1 → GitHub Actions genera el .exe
```

### Técnico
- ICO válido verificado: tipo=1, 4 imágenes, todas PNG firmadas (`\x89PNG`)
- `better-sqlite3` marcado como `asarUnpack` para que Electron pueda cargar el
  módulo nativo `.node` que está fuera del asar archive
- `installer-script.nsh` ya incluido: elimina y re-añade las 3 reglas de firewall
  (UDP 45678, TCP 45679, TCP 45680) en instalación/desinstalación
