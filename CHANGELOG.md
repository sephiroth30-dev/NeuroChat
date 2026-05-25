# CHANGELOG — NeuroChat

Todas las mejoras notables se documentan aquí.
Formato: `[version] — fecha — descripción`

---

## [2.2.3] — 2026-05-25 — Actualizaciones 100 % silenciosas + reducción de tamaño

### Actualizaciones silenciosas
- **Descarga completamente invisible**: ya no se muestra ninguna notificación ni indicador mientras la actualización se descarga en segundo plano.
- **Una sola notificación al final**: cuando la descarga termina, aparece una notificación informativa discreta ("NeuroChat vX.X.X se instalará en 10 minutos"). No requiere ninguna acción del usuario.
- **Instalación automática a los 10 minutos** sin tocar nada. En Windows se reinstala con `/S` (modo silencioso del instalador NSIS) y relanza la app.
- El panel de Ajustes → Actualizaciones sigue mostrando el progreso si el usuario lo abre voluntariamente.

### Instalador más pequeño y sin wizard (Windows)
- **`oneClick: true`**: el instalador NSIS ya no muestra ningún asistente de instalación (ni inicial ni en actualizaciones). Se instala de forma transparente en la carpeta del usuario sin pedir contraseña ni confirmación.
- **`compression: maximum`**: compresión LZMA en el asar y en el instalador. El ejecutable final es ~25-35 % más pequeño.
- **Assets del bundle reducidos**: se eliminan del paquete los archivos que solo son necesarios en tiempo de compilación (iconset de PNG, SVGs). Solo se incluyen los iconos de bandeja de sistema que se usan en tiempo de ejecución.

### Modificado
- `src/main/updater.js` — lógica de actualización simplificada y silenciosa.
- `electron-builder.yml` — `compression: maximum`, `oneClick: true`, `files` con solo los assets de runtime.
- `package.json` — bump v2.2.3.

---

## [2.2.2] — 2026-05-25 — Compatibilidad universal macOS (Intel + Apple Silicon)

### Corregido
- **macOS universal binary**: el instalador DMG ahora contiene código nativo para **x64 (Intel, MacBook Air 2017 y anteriores)** y **arm64 (Apple Silicon M1/M2/M3/M4)** en un solo archivo. La versión 2.2.0 solo incluía arm64 porque el runner de GitHub Actions es Apple Silicon.
- **`minimumSystemVersion: 10.15.0`**: compatible con macOS Catalina, Big Sur, Monterey, Ventura y Sonoma.
- **`robotjs` → `optionalDependencies`**: en macOS la compilación de robotjs es opcional (Mac actúa siempre como viewer, nunca como host de input). El build ya no falla si robotjs no puede compilarse para arm64/x64 en macOS.

### Modificado
- `electron-builder.yml` — mac target: `arch: universal`, `minimumSystemVersion: '10.15.0'`.
- `.github/workflows/build-release.yml` — macOS job simplificado; restaurado trigger `branches: releases/**`; robotjs excluido del rebuild manual en macOS.
- `package.json` — robotjs movido de `dependencies` a `optionalDependencies`.

---

## [2.2.1] — 2026-05-25 — Auto-aceptación de soporte remoto por dominio Windows

### Añadido
- **Confianza por dominio**: las solicitudes de soporte remoto de usuarios en el mismo dominio de Windows (`USERDOMAIN`) se aceptan automáticamente, sin modal de confirmación.
- **Ajuste `remoteSupportMode`** en Configuración → Soporte Remoto:
  - `Preguntar siempre` (predeterminado): muestra el modal para cada solicitud.
  - `Aceptar automáticamente (mismo dominio)`: auto-acepta si el solicitante pertenece al mismo dominio Windows.
  - `Aceptar siempre sin preguntar`: auto-acepta cualquier solicitud.
- **Campo `domain`** en el paquete UDP de anuncio (`NEUROCHAT_ANNOUNCE`) — valor de `USERDOMAIN` en Windows.
- **Campo `fromDomain`** en el mensaje WebSocket `REMOTE_REQUEST` — permite comparación de dominio en el host.
- **Detección de dominio** en la UI de Ajustes: muestra el dominio detectado o un aviso si no hay dominio.

### Modificado
- `src/main/discovery.js` — `buildPayload()` añade `domain`.
- `src/main/remoteDesktop.js` — `REMOTE_REQUEST` handler evalúa `remoteSupportMode` y llama a `_autoAccept()` si corresponde; nueva función `_autoAccept()`.
- `src/main/ipcHandlers.js` — `settings:get` devuelve `remoteSupportMode` y `remoteDomain`.
- `src/renderer/views/settings.js` — nueva sección "Soporte Remoto" con selector de modo y info de dominio.

---

## [2.2.0] — 2026-05-25 — Soporte remoto P2P nativo (sin herramientas externas)

### Añadido

#### Control remoto integrado — sin VNC, AnyDesk ni herramientas externas

Se incorpora un sistema completo de escritorio remoto propio, construido 100 % sobre tecnologías nativas de Electron y la infraestructura de red ya existente en NeuroChat. No requiere instalar ni configurar ningún software adicional en ninguna máquina.

**Funcionamiento general:**
1. Al abrir un chat directo (DM) con un compañero, aparece el nuevo botón **"Soporte remoto"** en la barra superior del chat (icono de monitor con tick).
2. El solicitante envía la solicitud a través del WebSocket ya existente (puerto 45679).
3. El host (máquina remota) recibe un **modal de aceptación/rechazo** con aviso de seguridad: acepta solo si reconoce al solicitante.
4. Al aceptar, se establece automáticamente una conexión **WebRTC P2P directa** entre las dos máquinas dentro de la LAN — sin intermediarios, sin servidores de relay.
5. El solicitante ve la pantalla del host en tiempo real. Puede mover el mouse, hacer clic, hacer scroll y escribir.
6. Cualquiera de los dos puede terminar la sesión en cualquier momento.

**Arquitectura técnica (`src/main/remoteDesktop.js`):**

| Capa | Tecnología | Rol |
|------|-----------|-----|
| Captura de pantalla | `desktopCapturer` + `setDisplayMediaRequestHandler` (API nativa Electron 29) | Captura el escritorio completo del host sin mostrar selector al usuario |
| Transmisión de video | **WebRTC P2P** (H.264 hardware-accelerated) | Stream de video directo entre las máquinas, con control de congestión automático (REMB/TWCC/GCC) |
| Eventos de input | **WebRTC DataChannel** (unordered, maxRetransmits=0) | Canal sin latencia de ACK — máxima velocidad para mouse y teclado |
| Simulación de input | **robotjs** (nativo Windows) | Ejecuta los eventos de mouse/teclado recibidos en el sistema operativo del host |
| Señalización WebRTC | WebSocket ya existente (puerto 45679) | Nuevos tipos de mensaje: `REMOTE_REQUEST`, `REMOTE_ACCEPT`, `REMOTE_REJECT`, `REMOTE_SDP`, `REMOTE_ICE`, `REMOTE_END` |

**Ventana del host (`src/renderer/remote-host.html/.js`):**
- Widget flotante pequeño (380×150 px) siempre visible encima de todas las ventanas mientras dura la sesión
- Muestra: nombre del solicitante, duración de sesión, FPS actual y bitrate de salida
- Botón "Terminar sesión" accesible en todo momento
- No interfiere con el flujo de trabajo — no bloquea la pantalla ni requiere interacción adicional

**Ventana del viewer — quien da soporte (`src/renderer/remote-viewer.html/.js`):**
- Ventana independiente que muestra la pantalla remota a escala completa preservando el aspect ratio
- **Barra flotante inferior** (auto-ocultable a los 3 segundos de inactividad):
  - Botón "Terminar"
  - Selector de **calidad adaptable**:

    | Preset | Bitrate máx | FPS máx | Escala de resolución |
    |--------|-------------|---------|----------------------|
    | Auto   | Sin límite  | 30      | 1× (WebRTC decide)   |
    | HD     | 8 Mb/s      | 30      | 1×                   |
    | Balanceado | 3 Mb/s  | 20      | 1×                   |
    | Rendimiento | 1.2 Mb/s | 15   | 1.5×                 |
    | Baja   | 600 kb/s    | 10      | 2×                   |

  - Botón pantalla completa
  - Contador de FPS y Mb/s en tiempo real
- Input capturado:
  - **Mouse**: movimiento, clic izquierdo/derecho/centro, doble clic, scroll — coordenadas normalizadas 0–1 para independencia de resolución
  - **Teclado**: todas las teclas incluidas F1–F12, flechas, combinaciones con Ctrl/Alt/Shift/Meta — interceptadas antes de que el OS las consuma localmente
  - Cursor local oculto (`cursor: none`) — solo se ve el cursor en el host

**Calidad adaptable en tiempo real:**
- El preset se envía via DataChannel al host como `{ type: 'quality', preset: 'low' }`
- El host llama a `RTCRtpSender.setParameters()` directamente sobre el encoder de video WebRTC — cambio sin cortar la sesión, efectivo en ~1 segundo
- En modo **Auto**, el WebRTC controla el bitrate mediante GCC (Google Congestion Control): si la LAN tiene congestión sube calidad, si hay pérdida la baja — comportamiento idéntico a herramientas profesionales

**Seguridad:**
- El host siempre ve el modal y debe aceptar explícitamente — no hay acceso sin consentimiento
- La sesión es P2P dentro de la LAN — ningún dato de pantalla o input sale de la red local
- El host puede terminar la sesión en cualquier momento con un clic

**Archivos nuevos:**
- `src/main/remoteDesktop.js` — módulo principal: gestión de sesiones, creación de ventanas, simulación de input vía robotjs, enrutamiento de señalización WebRTC
- `src/renderer/remote-host.html` + `remote-host.js` — ventana del host (overlay flotante, captura de pantalla, RTCPeerConnection offerer, DataChannel receiver)
- `src/renderer/remote-viewer.html` + `remote-viewer.js` — ventana del viewer (video display, captura y reenvío de input, control de calidad, stats)
- `src/renderer/remote-host-preload.js` + `remote-viewer-preload.js` — contextBridge para ambas ventanas remotas
- `src/renderer/styles/remote.css` — estilos del widget host y del toolbar del viewer

**Archivos modificados:**
- `src/main/index.js` — inicializa `remoteDesktop.init()` en el arranque
- `src/main/wsServer.js` — `handleIncoming` enruta los 6 nuevos tipos `REMOTE_*` a `remoteDesktop.handleSignaling()`
- `src/main/preload.js` — expone `requestRemote`, `acceptRemote`, `rejectRemote`, `endRemote` + 4 nuevos eventos IPC al renderer principal
- `src/renderer/index.html` — botón "Soporte remoto" en el header del chat (visible solo en DMs)
- `src/renderer/app.js` — lógica del botón, modal de aceptación/rechazo, listeners de eventos remotos
- `package.json` — dependencia `robotjs ^0.6.0`; script `rebuild` actualizado para incluir robotjs
- `electron-builder.yml` — `asarUnpack` extendido para incluir `node_modules/robotjs/**/*` (módulo nativo, debe estar fuera del asar)

### Nota para el build

Después de `npm install` en un entorno de desarrollo, compilar robotjs para Electron antes de iniciar:
```
npm run rebuild
```
El build de producción con `electron-builder` recompila los módulos nativos automáticamente.

---

---

## [2.1.12] — 2026-05-16 — Taskbar Windows sin abrir ventana + instalación macOS corregida

### Corregido
- **Ventana se abría encima al llegar un mensaje en Windows** (`windowManager.js`, `tray.js`): `showInactive()` no respetaba el estado minimizado y mostraba la ventana a tamaño completo sobre lo que el usuario estaba haciendo. Solución: se reemplaza completamente el enfoque por `setSkipTaskbar`:
  - X ahora hace `minimize()` + `setSkipTaskbar(true)` — la ventana queda minimizada pero invisible en el taskbar (solo el tray icon).
  - Al llegar un mensaje, `setSkipTaskbar(false)` hace reaparecer el botón minimizado en el taskbar — **sin mostrar ninguna ventana** — y `flashFrame(true)` lo hace parpadear naranja de forma persistente.
  - Al abrir la app (tray o botón taskbar), `setSkipTaskbar(false)` + `restore()` muestra la ventana normalmente.
  - Al limpiar los unreads con la ventana aún minimizada, `setSkipTaskbar(true)` la vuelve a ocultar al tray.
- **Actualización macOS no se instalaba** (`updater.js`): `quitAndInstall()` de Squirrel.Mac falla silenciosamente en apps sin firma de código. Nuevo flujo: extrae el ZIP descargado a `~/Downloads/NeuroChat-Update/`, ejecuta `xattr -cr` para quitar la cuarentena de macOS, y abre el directorio junto con `/Applications` para que el usuario arrastre el ícono y complete la instalación con un solo gesto. Si la extracción falla, muestra el ZIP en Finder como fallback.

---

## [2.1.11] — 2026-05-16 — Notificaciones persistentes en Windows: icono naranja parpadeante en barra de tareas

### Corregido
- **Icono no parpadeaba en la barra de tareas de Windows cuando la ventana estaba oculta** (`windowManager.js`, `tray.js`): al usar `win.hide()` la ventana desaparecía completamente del taskbar, haciendo que `flashFrame` no tuviera dónde actuar. La notificación llegaba, sonaba una vez y desaparecía sin dejar ningún indicador visual persistente.

  **Solución implementada:**
  - `windowManager.js`: al presionar X, el proceso ahora es `minimize()` → `hide()`. Esto guarda el estado de la ventana como "minimizada" antes de ocultarla del taskbar.
  - `tray.js` `updateTaskbarUnread`: cuando llega un mensaje nuevo en Windows y la ventana está oculta, se llama `showInactive()` para traerla de vuelta al taskbar **en estado minimizado** (sin que aparezca la ventana completa, sin robar el foco). Luego `flashFrame(true)` hace parpadear el botón en naranja de forma persistente, igual que Discord o Teams.
  - Cuando el usuario abre la app (desde el taskbar o el tray), el foco dispara `clearUnread()` → `flashFrame(false)` → el parpadeo se detiene.
  - Si el usuario no tiene mensajes pendientes y la ventana sigue minimizada en el taskbar, se oculta automáticamente de vuelta al tray.

---

## [2.1.10] — 2026-05-16 — Corrección de errores al cerrar y auto-instalación de actualizaciones

### Corregido
- **Error al cerrar la app** (`updater.js`, `index.js`): el auto-updater tenía revisiones periódicas y descargas en vuelo que al cancelarse por el cierre de la app disparaban `error` → `notifyRenderer` intentaba mandar a ventanas ya destruidas, generando errores en consola visibles para el usuario. Se agrega bandera `_shuttingDown` que se activa en `before-quit` y suprime todos los eventos y notificaciones del updater durante el apagado.
- **Actualización no se instalaba en macOS** (`updater.js`): el flujo manual de extracción ZIP + abrir Finder para drag-and-drop era confuso y los usuarios no sabían qué hacer. Se reemplaza por `autoUpdater.quitAndInstall(true, true)` que `electron-updater` maneja vía Squirrel.Mac para instalación automática en ambas plataformas. Si falla (ej. sin firma de código), cae a `shell.showItemInFolder` como fallback.
- **`window-all-closed` en macOS** (`index.js`): se corrige para respetar la convención de macOS — el proceso no cierra al cerrar todas las ventanas (permite cmd+Q y tray "Salir" como únicas salidas). En Windows/Linux sí cierra como antes.
- **Timers no se cancelaban al salir** (`updater.js`): el timer de revisión periódica (`setInterval`) y el timer de instalación forzada (`setTimeout`) no se limpiaban en `before-quit`, pudiendo dispararse después del cierre. Ahora `setShuttingDown()` los cancela explícitamente.

---

## [2.1.9] — 2026-05-15 — Mensajes encolados, tray obligatorio, eliminación de contactos y notificaciones visibles

### Corregido
- **Mensajes perdidos al escribir a usuarios desconectados** (`wsServer.js`): `setUserOffline()` marcaba al usuario con `isOnline: false` pero lo dejaba en el Map; `getOnlineUsers()` lo devolvía igual, el broadcast lo encontraba como "presente" y mandaba el mensaje por WebSocket —que fallaba silenciosamente— en lugar de encolarlo. Se agrega filtro `u.isOnline !== false` en el lookup del broadcast DM.
- **Mensajes perdidos cuando el WebSocket falla en tránsito** (`wsClient.js`): al fallar la conexión WebSocket, los mensajes pendientes en `_queue` se descartaban sin re-encolarlos. Ahora los handlers `on('error')` y `on('close')` devuelven cada mensaje a `store.queueMessage()` para entregarlos cuando el destinatario vuelva a estar en línea. Los mensajes se almacenan como objetos (no strings) para permitir el re-encolado.
- **Botón X cerraba la app completamente** (`windowManager.js`): el diálogo de confirmación permitía salir con un clic accidental. Ahora el botón X siempre minimiza al tray sin mostrar diálogo. La única salida es "Salir" en el menú del ícono de bandeja.

### Añadido
- **Eliminación completa de contactos** (`database.js`, `ipcHandlers.js`, `preload.js`, `app.js`): al hacer clic derecho sobre un contacto y seleccionar "Eliminar contacto":
  - **Si está desconectado**: elimina el contacto de la BD, borra toda la conversación, descarta mensajes pendientes en cola y lo remueve de la lista de ocultos. Si el usuario vuelve a conectarse a la red, reaparecerá automáticamente.
  - **Si está conectado**: muestra aviso de que no puede eliminarse el contacto mientras está en línea, y ofrece eliminar solo la conversación. Si el usuario se conectó entre el clic y la confirmación, el backend lo detecta y hace fallback automático a borrado de conversación.
  - Handler `user:delete` en IPC con verificación de estado online en el main process (fuente de verdad), evitando race conditions.

### Mejorado — Notificaciones y visibilidad
- **Taskbar flashea siempre** (`ipcHandlers.js`): se removió el guard `!win.isFocused()` en `app:flash`. Ahora el ícono de la barra de tareas flashea con color naranja incluso cuando la app está abierta en primer plano pero el usuario está en otro chat.
- **Mensajes de canal con popup visible** (`app.js`): los mensajes de canal ya no muestran solo un toast discreto abajo. Ahora usan el mismo popup deslizante que los DMs, con nombre del remitente, preview del texto y botón "Ver" para ir al canal directamente.
- **Notificaciones apilables** (`app.js`): el popup soporta hasta 3 tarjetas simultáneas apiladas verticalmente. Si llega una cuarta, se elimina la más antigua. Al cerrar una tarjeta, las demás se reposicionan automáticamente.
- **Animación de entrada desde la derecha** (`main.css`): el popup ahora desliza desde el borde derecho de la pantalla con un rebote suave (`notifPop`), más llamativo que el deslizamiento vertical anterior.
- **Borde de acento izquierdo** (`main.css`): cada tarjeta muestra un borde izquierdo de 4px en el color del contacto (DM) o el color corporativo (canal), haciendo la fuente del mensaje inmediatamente reconocible.
- **Sombra más prominente** (`main.css`): `box-shadow` con tres capas para mayor profundidad y contraste contra el fondo de la app.
- **Autostart por defecto** (`ipcHandlers.js`): ya activo desde versiones anteriores — en el primer arranque, `openAtLogin: true` se establece automáticamente vía `app.setLoginItemSettings` sin que el usuario tenga que activarlo manualmente.

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
