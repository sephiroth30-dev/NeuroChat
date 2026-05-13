'use strict';

import { renderDiagResults } from './diagnostics.js';

// Avatar icons — 5 categories, 2 per category (white on colored bg)
const AVATAR_CATEGORIES = [
  {
    cat: 'Asistencial',
    icons: [
      {
        id: 'medCross',
        label: 'Asistencia',
        svg: `<svg viewBox="0 0 24 24" fill="white"><rect x="9" y="2" width="6" height="20" rx="2"/><rect x="2" y="9" width="20" height="6" rx="2"/></svg>`,
      },
      {
        id: 'care',
        label: 'Cuidador/a',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="4"/><path d="M2 21v-1a8 8 0 0 1 12.93-6.35"/><line x1="19" y1="13" x2="19" y2="19"/><line x1="16" y1="16" x2="22" y2="16"/></svg>`,
      },
    ],
  },
  {
    cat: 'Servicio al cliente',
    icons: [
      {
        id: 'headset',
        label: 'Soporte',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14a9 9 0 0 1 18 0"/><rect x="2" y="14" width="4" height="6" rx="1"/><rect x="18" y="14" width="4" height="6" rx="1"/><path d="M22 20v1a2 2 0 0 1-2 2h-2"/></svg>`,
      },
      {
        id: 'chatBubble',
        label: 'Atención',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="12" y2="14"/></svg>`,
      },
    ],
  },
  {
    cat: 'Especialistas',
    icons: [
      {
        id: 'gradCap',
        label: 'Especialista',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 9 12 16 2 9"/><path d="M5 11.5V17a7 7 0 0 0 14 0v-5.5"/><line x1="22" y1="9" x2="22" y2="14"/></svg>`,
      },
      {
        id: 'award',
        label: 'Reconocimiento',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/></svg>`,
      },
    ],
  },
  {
    cat: 'Administrativo',
    icons: [
      {
        id: 'briefcase',
        label: 'Administrativo',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="2" y1="13" x2="22" y2="13"/></svg>`,
      },
      {
        id: 'fileText',
        label: 'Documentación',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
      },
    ],
  },
  {
    cat: 'IT',
    icons: [
      {
        id: 'laptop',
        label: 'Tecnología',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>`,
      },
      {
        id: 'server',
        label: 'Infraestructura',
        svg: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="white" stroke="none"/><circle cx="6" cy="18" r="1" fill="white" stroke="none"/></svg>`,
      },
    ],
  },
];

export async function render(container, profile, { onBack, onProfileSaved }) {
  const nc = window.neurochat;
  const settings = await nc.getSettings();

  const color = profile?.color || '#4A9E8F';

  const allIconsHtml = AVATAR_CATEGORIES.flatMap(({ icons }) => icons)
    .map(({ id, label, svg }) => {
      const selected = profile?.avatar === `nc-avatar:${id}`;
      return `<div class="avatar-option${selected ? ' selected' : ''}" data-avatar-id="${id}" style="background:${color}" title="${label}">${svg}</div>`;
    }).join('');
  const avatarGalleryHtml = allIconsHtml;

  container.innerHTML = `
    <div class="settings-view">
      <div class="settings-header">
        <button class="icon-btn settings-back" id="back-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m15 18-6-6 6-6"/>
          </svg>
        </button>
        <h2>Ajustes</h2>
      </div>
      <div class="settings-body">

        <div class="settings-section">
          <h3>Perfil</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Nombre de usuario</span>
                <small>Visible para todos en la red</small>
              </div>
              <input class="form-input" id="s-name" value="${esc(profile?.name || '')}" style="max-width:200px" />
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Estado de ánimo</span>
                <small>Mensaje visible debajo de tu nombre</small>
              </div>
              <input class="form-input" id="s-mood" value="${esc(profile?.status_message || '')}" placeholder="Ej: Disponible en 10 min…" style="max-width:220px" maxlength="100" />
            </div>
            <div class="settings-row">
              <div class="settings-row-label"><span>Color de perfil</span></div>
              <input type="color" id="s-color" value="${color}" style="width:40px;height:32px;border:none;cursor:pointer;border-radius:6px;padding:0" />
            </div>
            <div class="settings-row" style="justify-content:flex-end">
              <button class="btn btn-primary" id="save-profile-btn">Guardar perfil</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Avatar</h3>
          <div class="card">
            <div class="avatar-preview-row" id="avatar-preview-row">
              <div class="avatar-preview" id="avatar-preview" style="background:${color}">
                ${profile?.avatar?.startsWith('data:')
                  ? `<img src="${profile.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />`
                  : profile?.avatar?.startsWith('nc-avatar:')
                    ? AVATAR_CATEGORIES.flatMap(c=>c.icons).find(i=>i.id===profile.avatar.slice(10))?.svg || ''
                    : `<span style="font-size:22px;font-weight:700;color:#fff">${(profile?.name||'?').charAt(0).toUpperCase()}</span>`}
              </div>
              <div style="display:flex;flex-direction:column;gap:6px">
                <span class="avatar-preview-hint">Selecciona un ícono o sube una foto</span>
                <button class="btn btn-ghost" id="upload-avatar-btn" style="font-size:12px;padding:5px 12px">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  Subir foto
                </button>
              </div>
            </div>
            <div class="avatar-gallery avatar-gallery-flat" id="avatar-gallery">
              ${avatarGalleryHtml}
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Apariencia</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Tema</span>
                <small>Modo de color de la interfaz</small>
              </div>
              <div class="theme-selector" id="theme-selector">
                <button class="theme-btn${(settings.theme || 'auto') === 'auto' ? ' active' : ''}" data-theme="auto">Auto</button>
                <button class="theme-btn${(settings.theme || 'auto') === 'light' ? ' active' : ''}" data-theme="light">Claro</button>
                <button class="theme-btn${(settings.theme || 'auto') === 'dark' ? ' active' : ''}" data-theme="dark">Oscuro</button>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Estado</h3>
          <div class="card">
            <div class="status-selector">
              ${statusOption('available', '🟢', 'Disponible', profile?.status)}
              ${statusOption('away', '🟡', 'Ausente', profile?.status)}
              ${statusOption('dnd', '🔴', 'No molestar', profile?.status)}
              ${statusOption('invisible', '⚫', 'Invisible', profile?.status)}
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Notificaciones</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Notificaciones del sistema</span>
              </div>
              <label class="toggle">
                <input type="checkbox" id="s-notif" ${settings.notificationsEnabled ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="settings-row">
              <div class="settings-row-label"><span>Sonido</span></div>
              <label class="toggle">
                <input type="checkbox" id="s-sound" ${settings.soundEnabled ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Archivos</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Carpeta de descarga</span>
                <small id="s-dir-label">${esc(settings.downloadDir || '')}</small>
              </div>
              <button class="btn btn-ghost" id="change-dir-btn">Cambiar</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Red</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Dirección IP local</span>
                <small id="s-ips-value">Cargando…</small>
              </div>
              <code class="netinfo-ports">UDP 45678 · TCP 45679/80</code>
            </div>
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Diagnóstico de red</span>
                <small>Verifica puertos y conectividad</small>
              </div>
              <button class="btn btn-ghost" id="diag-btn">Ejecutar</button>
            </div>
            <div id="diag-results" class="diag-results" style="padding:0 16px 12px"></div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Sistema</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>Iniciar con Windows</span>
              </div>
              <label class="toggle">
                <input type="checkbox" id="s-startup" ${settings.startWithWindows ? 'checked' : ''} />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Actualizaciones</h3>
          <div class="card">
            <div class="settings-row" style="flex-wrap:wrap;gap:10px">
              <div class="settings-row-label">
                <span>Versión actual</span>
                <small>v<span id="s-version">—</span> · <span id="s-update-info" style="color:var(--nc-text-2)">Haz clic para buscar</span></small>
              </div>
              <div style="display:flex;gap:8px;align-items:center">
                <button class="btn btn-ghost" id="s-check-update" style="font-size:12px;padding:5px 12px">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/></svg>
                  Buscar actualizaciones
                </button>
                <button class="btn btn-primary hidden" id="s-download-update" style="font-size:12px;padding:5px 12px">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px"><path d="M12 3v13M5 14l7 7 7-7"/><path d="M3 21h18"/></svg>
                  Descargar
                </button>
                <button class="btn btn-primary hidden" id="s-install-update" style="font-size:12px;padding:5px 12px;background:var(--nc-online)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-right:4px"><path d="m5 12 5 5L20 7"/></svg>
                  Instalar y reiniciar
                </button>
              </div>
            </div>
            <div id="s-update-progress" class="hidden" style="padding:0 20px 14px">
              <div style="height:4px;background:var(--nc-border);border-radius:2px;overflow:hidden">
                <div id="s-update-bar" style="height:100%;background:var(--nc-primary);width:0%;transition:width .3s"></div>
              </div>
              <span id="s-update-pct" style="font-size:11px;color:var(--nc-text-2);margin-top:4px;display:block">0%</span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>Acerca de</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>NeuroChat</span>
                <small>by Neurofic</small>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>`;

  // Back
  container.querySelector('#back-btn').onclick = onBack;

  // Avatar selection
  let selectedAvatarId = profile?.avatar?.startsWith('nc-avatar:')
    ? profile.avatar.slice(10)
    : null;
  let customAvatarDataUrl = profile?.avatar?.startsWith('data:') ? profile.avatar : null;

  const gallery = container.querySelector('#avatar-gallery');
  const colorInput = container.querySelector('#s-color');
  const avatarPreview = container.querySelector('#avatar-preview');

  function updatePreview() {
    const c = colorInput.value;
    avatarPreview.style.background = c;
    gallery.querySelectorAll('.avatar-option').forEach(el => (el.style.background = c));
    if (customAvatarDataUrl) {
      avatarPreview.innerHTML = `<img src="${customAvatarDataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" />`;
    } else if (selectedAvatarId) {
      const icon = AVATAR_CATEGORIES.flatMap(cat => cat.icons).find(i => i.id === selectedAvatarId);
      avatarPreview.innerHTML = icon ? icon.svg : '';
    }
  }

  colorInput.oninput = () => updatePreview();

  gallery.addEventListener('click', e => {
    const opt = e.target.closest('.avatar-option');
    if (!opt) return;
    selectedAvatarId = opt.dataset.avatarId;
    customAvatarDataUrl = null;
    gallery.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    opt.classList.add('selected');
    updatePreview();
  });

  container.querySelector('#upload-avatar-btn').onclick = async () => {
    const dataUrl = await nc.chooseAvatar();
    if (!dataUrl) return;
    customAvatarDataUrl = dataUrl;
    selectedAvatarId = null;
    gallery.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    updatePreview();
  };

  // Save profile (name + mood + color + avatar)
  container.querySelector('#save-profile-btn').onclick = async () => {
    const name = container.querySelector('#s-name').value.trim();
    const mood = container.querySelector('#s-mood').value.trim();
    const col = container.querySelector('#s-color').value;
    if (!name) return;
    const avatarVal = customAvatarDataUrl
      ? customAvatarDataUrl
      : selectedAvatarId
        ? `nc-avatar:${selectedAvatarId}`
        : profile?.avatar || null;
    const updated = await nc.saveProfile({
      ...profile,
      name,
      color: col,
      status_message: mood,
      avatar: avatarVal,
    });
    if (mood !== (profile?.status_message || '')) await nc.setStatusMessage(mood);
    onProfileSaved(updated);
  };

  // Status
  container.querySelectorAll('.status-option').forEach(el => {
    el.onclick = async () => {
      const status = el.dataset.status;
      await nc.setStatus(status);
      container.querySelectorAll('.status-option').forEach(o => o.classList.remove('active'));
      el.classList.add('active');
    };
  });

  // Theme
  container.querySelector('#theme-selector').addEventListener('click', async e => {
    const btn = e.target.closest('.theme-btn');
    if (!btn) return;
    const theme = btn.dataset.theme;
    await nc.saveSettings({ theme });
    container
      .querySelectorAll('.theme-btn')
      .forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  });

  // Notifications
  container.querySelector('#s-notif').onchange = e =>
    nc.saveSettings({ notificationsEnabled: e.target.checked });
  container.querySelector('#s-sound').onchange = e =>
    nc.saveSettings({ soundEnabled: e.target.checked });

  // Download dir
  container.querySelector('#change-dir-btn').onclick = async () => {
    const dir = await nc.chooseDownloadDir();
    if (dir) {
      await nc.saveSettings({ downloadDir: dir });
      container.querySelector('#s-dir-label').textContent = dir;
    }
  };

  // Startup with Windows
  container.querySelector('#s-startup').onchange = e => nc.setStartupWithWindows(e.target.checked);

  // Diagnostics
  container.querySelector('#diag-btn').onclick = async () => {
    const results = await nc.runDiagnostics();
    renderDiagResults(container.querySelector('#diag-results'), results);
  };

  // Version
  nc.getVersion().then(v => {
    const el = container.querySelector('#s-version');
    if (el) el.textContent = v;
  });

  // Network info
  nc.getNetworkInfo().then(info => {
    const el = container.querySelector('#s-ips-value');
    if (!el) return;
    el.textContent = info.ips.length
      ? info.ips.map(i => i.address).join(' · ')
      : 'Sin interfaz detectada';
  });

  // Updates
  const checkBtn = container.querySelector('#s-check-update');
  const downloadBtn = container.querySelector('#s-download-update');
  const installBtn = container.querySelector('#s-install-update');
  const updateInfo = container.querySelector('#s-update-info');
  const progressWrap = container.querySelector('#s-update-progress');
  const progressBar = container.querySelector('#s-update-bar');
  const progressPct = container.querySelector('#s-update-pct');

  function setUpdateState(state, data = {}) {
    checkBtn.classList.remove('hidden');
    downloadBtn.classList.add('hidden');
    installBtn.classList.add('hidden');
    progressWrap.classList.add('hidden');
    checkBtn.disabled = false;

    if (state === 'checking') {
      updateInfo.textContent = 'Buscando…';
      checkBtn.disabled = true;
    } else if (state === 'available') {
      updateInfo.textContent = `Nueva versión disponible: v${data.version}`;
      updateInfo.style.color = 'var(--nc-primary)';
      downloadBtn.classList.remove('hidden');
    } else if (state === 'latest') {
      updateInfo.textContent = `Tienes la versión más reciente`;
      updateInfo.style.color = 'var(--nc-online)';
    } else if (state === 'downloading') {
      updateInfo.textContent = `Descargando…`;
      checkBtn.classList.add('hidden');
      progressWrap.classList.remove('hidden');
      const pct = data.percent || 0;
      progressBar.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
    } else if (state === 'ready') {
      updateInfo.textContent = `v${data.version} lista para instalar`;
      updateInfo.style.color = 'var(--nc-online)';
      checkBtn.classList.add('hidden');
      installBtn.classList.remove('hidden');
    } else if (state === 'error') {
      updateInfo.textContent = `Error: ${data.message || 'No se pudo verificar'}`;
      updateInfo.style.color = 'var(--nc-error, #e74c3c)';
    }
  }

  checkBtn.onclick = () => nc.checkForUpdates();
  downloadBtn.onclick = () => nc.downloadUpdate();
  installBtn.onclick = () => nc.installUpdate();

  const unsubUpdate = nc.on('update:status', status => {
    setUpdateState(status.state, status);
  });

  // Clean up listener when settings panel is closed (back button)
  const origBack = container.querySelector('#back-btn').onclick;
  container.querySelector('#back-btn').onclick = () => {
    if (typeof unsubUpdate === 'function') unsubUpdate();
    if (typeof origBack === 'function') origBack();
  };
}

function statusOption(value, icon, label, current) {
  return `<div class="status-option${current === value ? ' active' : ''}" data-status="${value}">
    <span>${icon}</span><span>${label}</span>
  </div>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
