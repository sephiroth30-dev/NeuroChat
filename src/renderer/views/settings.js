'use strict';

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

  const avatarGalleryHtml = AVATAR_CATEGORIES.map(({ cat, icons }) => {
    const iconHtml = icons
      .map(({ id, label, svg }) => {
        const selected = profile?.avatar === `nc-avatar:${id}`;
        return `<div class="avatar-option${selected ? ' selected' : ''}" data-avatar-id="${id}" style="background:${color}" title="${label}">${svg}</div>`;
      })
      .join('');
    return `<div class="avatar-cat"><span class="avatar-cat-label">${cat}</span><div class="avatar-cat-icons">${iconHtml}</div></div>`;
  }).join('');

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
            <div class="avatar-gallery" id="avatar-gallery">
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
          <h3>Acerca de</h3>
          <div class="card">
            <div class="settings-row">
              <div class="settings-row-label">
                <span>NeuroChat</span>
                <small>by Neurofic · v<span id="s-version">—</span></small>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>`;

  // Back
  container.querySelector('#back-btn').onclick = onBack;

  // Avatar selection — update gallery colors when color changes, save on click
  let selectedAvatarId = profile?.avatar?.startsWith('nc-avatar:')
    ? profile.avatar.slice(10)
    : null;

  const gallery = container.querySelector('#avatar-gallery');
  const colorInput = container.querySelector('#s-color');

  colorInput.oninput = () => {
    gallery
      .querySelectorAll('.avatar-option')
      .forEach(el => (el.style.background = colorInput.value));
  };

  gallery.addEventListener('click', e => {
    const opt = e.target.closest('.avatar-option');
    if (!opt) return;
    selectedAvatarId = opt.dataset.avatarId;
    gallery.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
    opt.classList.add('selected');
  });

  // Save profile (name + mood + color + avatar)
  container.querySelector('#save-profile-btn').onclick = async () => {
    const name = container.querySelector('#s-name').value.trim();
    const mood = container.querySelector('#s-mood').value.trim();
    const col = container.querySelector('#s-color').value;
    if (!name) return;
    const updated = await nc.saveProfile({
      ...profile,
      name,
      color: col,
      status_message: mood,
      avatar: selectedAvatarId ? `nc-avatar:${selectedAvatarId}` : profile?.avatar || null,
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
}

function statusOption(value, icon, label, current) {
  return `<div class="status-option${current === value ? ' active' : ''}" data-status="${value}">
    <span>${icon}</span><span>${label}</span>
  </div>`;
}

function renderDiagResults(container, r) {
  container.innerHTML = '';
  const rows = [
    { label: 'Interfaz de red', ok: r.ip.ok, value: r.ip.value || '—' },
    { label: 'Puerto UDP 45678', ok: r.udpPort.ok, value: '' },
    { label: 'Puerto TCP 45679', ok: r.wsPort.ok, value: '' },
    { label: 'Puerto TCP 45680', ok: r.filePort.ok, value: '' },
    {
      label: 'Usuarios en red',
      ok: r.usersDetected.ok,
      warn: !r.usersDetected.ok,
      value: `${r.usersDetected.count} detectados`,
    },
    {
      label: 'Múltiples interfaces',
      ok: !r.multipleInterfaces.warn,
      warn: r.multipleInterfaces.warn,
      value: r.multipleInterfaces.count > 1 ? `${r.multipleInterfaces.count} interfaces` : '',
    },
  ];
  rows.forEach(row => {
    const el = document.createElement('div');
    el.className = 'diag-row';
    el.innerHTML = `
      <span class="diag-icon">${row.ok ? '✅' : row.warn ? '⚠️' : '❌'}</span>
      <span class="diag-label">${row.label}</span>
      <span class="diag-value">${esc(row.value)}</span>`;
    container.appendChild(el);
  });

  if (!r.udpPort.ok || !r.wsPort.ok || !r.filePort.ok) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.style.marginTop = '8px';
    btn.textContent = 'Añadir excepción de firewall automáticamente';
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = 'Aplicando…';
      await window.neurochat.addFirewallRules();
      btn.textContent = '✓ Reglas aplicadas (reinicia NeuroChat)';
    };
    container.appendChild(btn);
  }
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
