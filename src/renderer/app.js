'use strict';

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const nc = window.neurochat; // IPC bridge from preload

let myProfile = null;
let currentChat = null; // { type: 'channel'|'dm', id, name }

// Unread message counts per chatId (in-memory, resets on restart)
const unreadCounts = new Map();
// Cached sidebar data for notification navigation
let cachedChannels = [];
let cachedUsers = [];

let soundEnabled = true;
let _audioCtx = null;

// ── Avatar icons — 5 categories, 2 per category (white on colored bg) ────────
const AVATAR_SVGS = {
  // Asistencial
  medCross: `<svg viewBox="0 0 24 24" fill="white"><rect x="9" y="2" width="6" height="20" rx="2"/><rect x="2" y="9" width="20" height="6" rx="2"/></svg>`,
  care: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="4"/><path d="M2 21v-1a8 8 0 0 1 12.93-6.35"/><line x1="19" y1="13" x2="19" y2="19"/><line x1="16" y1="16" x2="22" y2="16"/></svg>`,
  // Servicio al cliente
  headset: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14a9 9 0 0 1 18 0"/><rect x="2" y="14" width="4" height="6" rx="1"/><rect x="18" y="14" width="4" height="6" rx="1"/><path d="M22 20v1a2 2 0 0 1-2 2h-2"/></svg>`,
  chatBubble: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="12" y2="14"/></svg>`,
  // Especialistas
  gradCap: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 9 12 16 2 9"/><path d="M5 11.5V17a7 7 0 0 0 14 0v-5.5"/><line x1="22" y1="9" x2="22" y2="14"/></svg>`,
  award: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/></svg>`,
  // Administrativo
  briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="2" y1="13" x2="22" y2="13"/></svg>`,
  fileText: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
  // IT
  laptop: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>`,
  server: `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><circle cx="6" cy="6" r="1" fill="white" stroke="none"/><circle cx="6" cy="18" r="1" fill="white" stroke="none"/></svg>`,
};

const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  myProfile = await nc.getProfile();

  // First-run: no name set (OS username is default but show welcome screen)
  const isFirstRun = !myProfile || myProfile.name === require_os_username();
  if (isFirstRun) {
    showSetup();
    return;
  }

  await boot();
}

function require_os_username() {
  // preload doesn't expose os — check if name looks like a never-customized login
  return null; // always skip first-run in Phase 1 for quick testing
}

async function boot() {
  await nc.seedUsers(); // idempotent — seeds test data on first run only
  renderOwnProfile();
  await loadSidebar();
  nc.getVersion().then(v => {
    const el = $('app-version');
    if (el) el.textContent = `v${v}`;
  });
  setupTheme();
  nc.getSettings().then(s => {
    soundEnabled = s.soundEnabled !== false;
  });
  bindEvents();
  subscribeIPCEvents();
  setupAutoAway();
}

// ── Auto-away (10 min inactivity) ─────────────────────────────────────────────
function setupAutoAway() {
  const AUTO_AWAY_MS = 10 * 60 * 1000;
  let awayTimer = null;
  let wasAutoAway = false;

  function onActivity() {
    // Restore to available if auto-away was applied
    if (wasAutoAway && myProfile?.status === 'away') {
      wasAutoAway = false;
      nc.setStatus('available').then(() => {
        myProfile = { ...myProfile, status: 'available' };
        renderOwnProfile();
      });
    }
    resetTimer();
  }

  function resetTimer() {
    clearTimeout(awayTimer);
    // Only schedule if user hasn't manually set dnd/invisible
    if (myProfile?.status !== 'dnd' && myProfile?.status !== 'invisible') {
      awayTimer = setTimeout(() => {
        if (myProfile?.status === 'available') {
          wasAutoAway = true;
          nc.setStatus('away').then(() => {
            myProfile = { ...myProfile, status: 'away' };
            renderOwnProfile();
          });
        }
      }, AUTO_AWAY_MS);
    }
  }

  document.addEventListener('mousemove', onActivity, { passive: true });
  document.addEventListener('keydown', onActivity, { passive: true });
  document.addEventListener('click', onActivity, { passive: true });
  resetTimer();
}

// ── Sound notification ────────────────────────────────────────────────────────
function playNotifSound() {
  if (!soundEnabled) return;
  try {
    if (!_audioCtx) _audioCtx = new AudioContext();
    const ctx = _audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch {}
}

// ── First-run setup ───────────────────────────────────────────────────────────
function showSetup() {
  const overlay = $('setup-overlay');
  const nameInput = $('setup-name');
  const btn = $('setup-confirm-btn');

  if (myProfile) nameInput.value = myProfile.name || '';
  overlay.classList.remove('hidden');
  nameInput.focus();

  btn.onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    myProfile = await nc.saveProfile({ ...myProfile, name });
    overlay.classList.add('hidden');
    await boot();
  };

  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') btn.click();
  });
}

// ── Own profile render ────────────────────────────────────────────────────────
function renderOwnProfile() {
  if (!myProfile) return;
  $('own-name').textContent = myProfile.name;

  const moodEl = $('own-mood');
  if (moodEl) moodEl.textContent = myProfile.status_message || '';

  const dot = $('own-status-dot');
  if (dot) {
    const STATUS_TITLES = {
      available: 'Disponible',
      away: 'Ausente',
      dnd: 'No molestar',
      invisible: 'Invisible',
    };
    dot.className = `own-status-dot ${myProfile.status || 'available'}`;
    dot.title = `Estado: ${STATUS_TITLES[myProfile.status] || 'Disponible'} — clic para cambiar`;
  }

  renderAvatar($('own-avatar'), myProfile);
}

// ── Avatar helper ─────────────────────────────────────────────────────────────
function renderAvatar(el, user) {
  el.style.background = user.color || '#4A9E8F';
  if (user.avatar && user.avatar.startsWith('nc-avatar:')) {
    const key = user.avatar.slice(10);
    const svg = AVATAR_SVGS[key];
    if (svg) {
      el.innerHTML = svg;
      return;
    }
  }
  if (user.avatar && user.avatar.startsWith('data:')) {
    el.innerHTML = `<img src="${user.avatar}" alt="${user.name}" />`;
    return;
  }
  const initials = (user.name || '?').charAt(0).toUpperCase();
  el.dataset.initials = initials;
  el.textContent = initials;
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// nativeTheme.themeSource drives prefers-color-scheme in Chromium.
// CSS @media (prefers-color-scheme: dark) applies instantly — no JS class toggling needed.
function setupTheme() {}

// ── Sidebar ───────────────────────────────────────────────────────────────────
async function loadSidebar() {
  const [channels, users] = await Promise.all([nc.getChannels(), nc.getUsers()]);
  renderChannelList(channels);
  renderDMList(users);
}

function renderChannelList(channels) {
  const list = $('channel-list');
  list.innerHTML = '';
  if (!channels.length) {
    list.innerHTML =
      '<li class="nav-item" style="color:var(--nc-text-2);font-size:12px;padding:6px 10px;">Sin canales</li>';
    return;
  }
  cachedChannels = channels;
  channels.forEach(ch => {
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.dataset.id = ch.id;
    const count = unreadCounts.get(ch.id) || 0;
    li.innerHTML = `
      <span class="channel-hash">#</span>
      <span class="nav-label">${escHtml(ch.name)}</span>
      ${count > 0 ? `<span class="unread-badge">${count > 99 ? '99+' : count}</span>` : ''}
    `;
    li.onclick = () => openChat({ type: 'channel', id: ch.id, name: ch.name });
    li.addEventListener('contextmenu', e => {
      e.preventDefault();
      showChannelMenu(e, ch);
    });
    list.appendChild(li);
  });
}

function renderDMList(users) {
  const list = $('dm-list');
  const myUuid = myProfile?.uuid;
  list.innerHTML = '';
  const others = users.filter(u => u.uuid !== myUuid);
  cachedUsers = others;
  if (!others.length) {
    list.innerHTML =
      '<li class="nav-item" style="color:var(--nc-text-2);font-size:12px;padding:6px 10px;">Sin usuarios detectados</li>';
    return;
  }
  others.forEach(user => {
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.dataset.uuid = user.uuid;

    const statusClass = user.is_online ? user.status || 'available' : 'offline';

    const avatarWrap = document.createElement('div');
    avatarWrap.className = 'avatar-wrap';
    const avatarEl = document.createElement('div');
    avatarEl.className = 'avatar small';
    renderAvatar(avatarEl, user);
    const statusDot = document.createElement('span');
    statusDot.className = `avatar-status ${statusClass}`;
    avatarWrap.appendChild(avatarEl);
    avatarWrap.appendChild(statusDot);

    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = user.name;

    li.appendChild(avatarWrap);
    li.appendChild(label);
    const dmCount = unreadCounts.get(user.uuid) || 0;
    if (dmCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'unread-badge';
      badge.textContent = dmCount > 99 ? '99+' : dmCount;
      li.appendChild(badge);
    }
    li.onclick = () => openChat({ type: 'dm', id: user.uuid, name: user.name });
    list.appendChild(li);
  });
}

// ── Unread badge management ───────────────────────────────────────────────────
function updateBadge() {
  const total = Array.from(unreadCounts.values()).reduce((a, b) => a + b, 0);
  const dataUrl = total > 0 ? createBadgeDataUrl(total) : null;
  nc.setBadge(total, dataUrl);
  // Re-render sidebar lists to reflect new counts
  if (cachedChannels.length) renderChannelList(cachedChannels);
  if (cachedUsers.length) renderDMList([...cachedUsers, ...(myProfile ? [myProfile] : [])]);
}

function createBadgeDataUrl(count) {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#E05A5A';
  ctx.beginPath();
  ctx.arc(8, 8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'white';
  ctx.font = 'bold 9px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(count > 99 ? '99+' : String(count), 8, 8.5);
  return canvas.toDataURL('image/png');
}

// ── Open chat ─────────────────────────────────────────────────────────────────
async function openChat(chat) {
  currentChat = chat;

  // Clear unread count for this chat
  if (unreadCounts.has(chat.id)) {
    unreadCounts.delete(chat.id);
    updateBadge();
  }

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  if (chat.type === 'channel') {
    document.querySelector(`#channel-list [data-id="${chat.id}"]`)?.classList.add('active');
  } else {
    document.querySelector(`#dm-list [data-uuid="${chat.id}"]`)?.classList.add('active');
  }

  // Show chat view
  $('empty-state').classList.add('hidden');
  $('chat-view').classList.remove('hidden');

  // Header
  $('chat-title').textContent = chat.type === 'channel' ? `# ${chat.name}` : chat.name;
  $('chat-subtitle').textContent = chat.type === 'channel' ? 'Canal' : 'Mensaje directo';

  // Avatar header
  const avatarEl = $('chat-avatar');
  avatarEl.textContent = chat.name.charAt(0).toUpperCase();

  // Load messages
  await loadMessages();

  // Focus input
  $('message-input').focus();
}

async function loadMessages() {
  if (!currentChat) return;
  const opts =
    currentChat.type === 'channel'
      ? { channelId: currentChat.id }
      : { privateChatUuid: currentChat.id };

  const messages = await nc.getMessages(opts);
  renderMessages(messages);

  // Send read receipts for unread incoming messages
  if (myProfile) {
    messages
      .filter(
        m => !m.deleted && m.from_uuid !== myProfile.uuid && !m.read_by?.includes(myProfile.uuid)
      )
      .forEach(m => nc.markRead(m.id, m.from_uuid));
  }
}

// ── Message rendering ─────────────────────────────────────────────────────────
function renderMessages(messages) {
  const container = $('messages-inner');
  container.innerHTML = '';

  let lastDate = null;
  let lastSender = null;

  messages.forEach((msg, _idx) => {
    const msgDate = new Date(msg.timestamp).toDateString();
    if (msgDate !== lastDate) {
      container.appendChild(makeDateSeparator(msg.timestamp));
      lastDate = msgDate;
      lastSender = null;
    }

    const isOutgoing = msg.from_uuid === myProfile?.uuid;
    const grouped = !isOutgoing && msg.from_uuid === lastSender;
    container.appendChild(makeMsgRow(msg, isOutgoing, grouped));
    lastSender = msg.from_uuid;
  });

  // Scroll to bottom
  const list = $('message-list');
  list.scrollTop = list.scrollHeight;
}

function makeDateSeparator(ts) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.textContent = formatDateSeparator(ts);
  return el;
}

function makeMsgRow(msg, isOutgoing, grouped) {
  const row = document.createElement('div');
  row.className = `msg-row${isOutgoing ? ' outgoing' : ''}${grouped ? ' grouped' : ''}`;
  row.dataset.id = msg.id;

  if (msg.deleted) {
    row.innerHTML = `
      <div class="msg-bubble">
        <span class="msg-deleted">Mensaje eliminado</span>
      </div>`;
    return row;
  }

  if (msg.type === 'file') {
    return makeFileRow(row, msg, isOutgoing);
  }

  const replyHtml = msg.reply_to
    ? `<div class="msg-reply-quote">
        <span class="msg-reply-name">En respuesta a</span>
        <span class="msg-reply-text">${escHtml(msg.reply_to_content || '…')}</span>
       </div>`
    : '';

  const editedHtml = msg.edited ? '<span class="msg-edited">editado</span>' : '';
  const statusHtml = isOutgoing ? renderDeliveryStatus(msg) : '';

  const reactionsHtml = (msg.reactions || []).length
    ? `<div class="msg-reactions">${renderReactions(msg.reactions, myProfile?.uuid)}</div>`
    : '';

  row.innerHTML = `
    <div class="msg-bubble">
      ${replyHtml}
      ${
        currentChat?.type === 'channel' && !isOutgoing && !grouped
          ? `<span class="msg-sender" style="color:${msg.color || '#4A9E8F'}">${escHtml(msg.sender_name || 'Usuario')}</span>`
          : ''
      }
      <span class="msg-text">${formatText(msg.content || '')}</span>${editedHtml}
      <div class="msg-meta">
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        ${statusHtml}
      </div>
      ${reactionsHtml}
    </div>`;

  // Context menu on right-click
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e, msg, isOutgoing);
  });

  return row;
}

function makeFileRow(row, msg, isOutgoing) {
  let meta = {};
  try {
    meta = JSON.parse(msg.content || '{}');
  } catch {}

  const { name = 'Archivo', size = 0, mimeType = '' } = meta;
  const localPath = msg.localPath || null;
  const isImage = mimeType.startsWith('image/');
  const safeLocal = localPath ? localPath.replace(/\\/g, '/') : '';

  let inner;
  if (isImage && localPath) {
    inner = `
      <div class="img-bubble">
        <img src="file://${safeLocal}" alt="${escHtml(name)}" />
      </div>`;
  } else {
    const icon = getFileIcon(mimeType);
    inner = `
      <div class="file-bubble${localPath ? ' has-file' : ''}" data-transfer="${escHtml(meta.transferId || '')}">
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <span class="file-name">${escHtml(name)}</span>
          <span class="file-size">${formatSize(size)}</span>
        </div>
      </div>`;
    if (!localPath) {
      inner += `
        <div class="transfer-progress" data-transfer="${escHtml(meta.transferId || '')}">
          <div class="progress-bar-wrap"><div class="progress-bar" style="width:0%"></div></div>
          <div class="progress-meta"><span>${isOutgoing ? 'Enviando…' : 'Pendiente'}</span><span class="prog-pct">0%</span></div>
        </div>`;
    }
  }

  const statusHtml = isOutgoing ? renderDeliveryStatus(msg) : '';
  row.innerHTML = `
    <div class="msg-bubble">
      ${currentChat?.type === 'channel' && !isOutgoing ? `<span class="msg-sender" style="color:${msg.color || '#4A9E8F'}">${escHtml(msg.sender_name || 'Usuario')}</span>` : ''}
      ${inner}
      <div class="msg-meta">
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        ${statusHtml}
      </div>
    </div>`;

  if (localPath && isImage) {
    row.querySelector('img')?.addEventListener('click', () => nc.openFile(localPath));
  } else if (localPath) {
    row.querySelector('.file-bubble')?.addEventListener('click', () => nc.openFile(localPath));
  }
  return row;
}

function getFileIcon(mimeType = '') {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.includes('pdf')) return '📑';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return '🗜️';
  return '📎';
}

function renderDeliveryStatus(msg) {
  if (!msg.delivered && !msg.read_by?.length) return '<span class="msg-status">✓</span>';
  if (!msg.read_by?.length) return '<span class="msg-status">✓✓</span>';
  return '<span class="msg-status read">✓✓</span>';
}

function renderReactions(reactions, myUuid) {
  const groups = {};
  reactions.forEach(r => {
    if (!groups[r.emoji]) groups[r.emoji] = { emoji: r.emoji, users: [], mine: false };
    groups[r.emoji].users.push(r.user_uuid);
    if (r.user_uuid === myUuid) groups[r.emoji].mine = true;
  });
  return Object.values(groups)
    .map(
      g =>
        `<span class="reaction-pill${g.mine ? ' mine' : ''}" data-emoji="${g.emoji}">
      ${g.emoji} <span class="reaction-count">${g.users.length}</span>
    </span>`
    )
    .join('');
}

// ── Context menu ──────────────────────────────────────────────────────────────
let activeMenu = null;

function showContextMenu(e, msg, isOutgoing) {
  removeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const items = [
    { label: '↩️ Responder', action: () => setReply(msg) },
    { label: '😀 Reaccionar', action: () => showReactionPicker(e, msg) },
    { label: '📋 Copiar', action: () => navigator.clipboard.writeText(msg.content || '') },
  ];

  if (isOutgoing && !msg.deleted) {
    items.push({ label: '✏️ Editar', action: () => startEdit(msg) });
    items.push({ label: '🗑️ Eliminar', action: () => deleteMessage(msg), danger: true });
  }

  if (currentChat?.type === 'channel') {
    items.push({ label: '📌 Anclar', action: () => pinMessage(msg) });
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `context-item${item.danger ? ' danger' : ''}`;
    el.textContent = item.label;
    el.onclick = () => {
      removeContextMenu();
      item.action();
    };
    menu.appendChild(el);
  });

  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 10)}px`;
  document.body.appendChild(menu);
  activeMenu = menu;

  setTimeout(() => {
    document.addEventListener('click', removeContextMenu, { once: true });
  }, 0);
}

function removeContextMenu() {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

function showChannelMenu(e, ch) {
  removeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const items = [
    {
      label: '💬 Abrir canal',
      action: () => openChat({ type: 'channel', id: ch.id, name: ch.name }),
    },
  ];

  if (!ch.is_default) {
    items.push({
      label: '🗑️ Eliminar canal',
      danger: true,
      action: async () => {
        await nc.deleteChannel(ch.id);
        if (currentChat?.type === 'channel' && currentChat.id === ch.id) {
          currentChat = null;
          $('chat-view').classList.add('hidden');
          $('empty-state').classList.remove('hidden');
        }
        await loadSidebar();
      },
    });
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `context-item${item.danger ? ' danger' : ''}`;
    el.textContent = item.label;
    el.onclick = () => {
      removeContextMenu();
      item.action();
    };
    menu.appendChild(el);
  });

  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 80)}px`;
  document.body.appendChild(menu);
  activeMenu = menu;
  setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 0);
}

// ── Reply ─────────────────────────────────────────────────────────────────────
let replyingTo = null;

function setReply(msg) {
  replyingTo = msg;
  $('reply-preview').classList.remove('hidden');
  $('reply-preview-name').textContent = msg.sender_name || 'Mensaje';
  $('reply-preview-text').textContent = msg.content || '';
  $('message-input').focus();
}

$('cancel-reply-btn').onclick = () => {
  replyingTo = null;
  $('reply-preview').classList.add('hidden');
};

// ── Edit ──────────────────────────────────────────────────────────────────────
let editingId = null;

function startEdit(msg) {
  editingId = msg.id;
  const input = $('message-input');
  input.textContent = msg.content;
  input.focus();
  placeCursorAtEnd(input);
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteMessage(msg) {
  await nc.deleteMessage(msg.id);
  await loadMessages();
}

// ── Pin ───────────────────────────────────────────────────────────────────────
async function pinMessage(msg) {
  if (!currentChat || currentChat.type !== 'channel') return;
  await nc.pinMessage(currentChat.id, msg.id);
  await loadPinned();
}

async function loadPinned() {
  if (!currentChat || currentChat.type !== 'channel') return;
  const pinned = await nc.getPinnedMessages(currentChat.id);
  if (pinned.length) {
    $('pinned-banner').classList.remove('hidden');
    $('pinned-text').textContent = pinned[0].content || 'Mensaje anclado';
  } else {
    $('pinned-banner').classList.add('hidden');
  }
}

// ── Reaction picker ───────────────────────────────────────────────────────────
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢'];

function showReactionPicker(e, msg) {
  const existing = document.querySelector('.reaction-picker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.className = 'reaction-picker';
  QUICK_REACTIONS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.onclick = async () => {
      picker.remove();
      await nc.sendReaction(msg.id, emoji);
      await loadMessages();
    };
    picker.appendChild(btn);
  });

  picker.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
  picker.style.top = `${e.clientY - 60}px`;
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 0);
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  const input = $('message-input');
  const content = input.textContent.trim();
  if (!content || !currentChat) return;

  input.textContent = '';

  if (editingId) {
    await nc.editMessage(editingId, content);
    editingId = null;
    await loadMessages();
    return;
  }

  const msg = {
    content,
    type: 'text',
    channelId: currentChat.type === 'channel' ? currentChat.id : null,
    toUuid: currentChat.type === 'dm' ? currentChat.id : null,
    replyTo: replyingTo ? replyingTo.id : null,
  };

  if (replyingTo) {
    replyingTo = null;
    $('reply-preview').classList.add('hidden');
  }

  await nc.sendMessage(msg);
  await loadMessages();
}

// ── Emoji picker ──────────────────────────────────────────────────────────────
const EMOJIS = [
  '😀',
  '😃',
  '😄',
  '😁',
  '😆',
  '😅',
  '🤣',
  '😂',
  '🙂',
  '🙃',
  '😉',
  '😊',
  '😇',
  '🥰',
  '😍',
  '🤩',
  '😘',
  '😗',
  '😚',
  '😙',
  '😋',
  '😛',
  '😜',
  '🤪',
  '😝',
  '🤑',
  '🤗',
  '🤭',
  '🤫',
  '🤔',
  '🤐',
  '🤨',
  '😐',
  '😑',
  '😶',
  '😏',
  '😒',
  '🙄',
  '😬',
  '🤥',
  '😌',
  '😔',
  '😪',
  '🤤',
  '😴',
  '😷',
  '🤒',
  '🤕',
  '🤢',
  '🤮',
  '🤧',
  '🥵',
  '🥶',
  '🥴',
  '😵',
  '🤯',
  '🤠',
  '🥳',
  '😎',
  '🤓',
  '🧐',
  '😕',
  '😟',
  '🙁',
  '☹️',
  '😣',
  '😖',
  '😫',
  '😩',
  '🥺',
  '😢',
  '😭',
  '😤',
  '😠',
  '😡',
  '🤬',
  '😈',
  '👿',
  '💀',
  '☠️',
  '👍',
  '👎',
  '👋',
  '🤚',
  '✋',
  '🖐️',
  '👌',
  '🤌',
  '🤏',
  '✌️',
  '🤞',
  '🖖',
  '🤟',
  '🤘',
  '🤙',
  '💪',
  '🦾',
  '🙌',
  '👏',
  '🤝',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🖤',
  '🤍',
  '🤎',
  '💔',
  '❣️',
  '💕',
  '💞',
  '💓',
  '💗',
  '💖',
  '💘',
  '💝',
  '🔥',
  '✨',
];

$('emoji-btn').onclick = e => {
  e.stopPropagation();
  const picker = $('emoji-picker');
  if (picker.classList.contains('hidden')) {
    buildEmojiPicker(picker);
    picker.classList.remove('hidden');
  } else {
    picker.classList.add('hidden');
  }
};

function buildEmojiPicker(el) {
  el.innerHTML = '';
  EMOJIS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.onclick = () => {
      insertAtCursor($('message-input'), emoji);
      el.classList.add('hidden');
    };
    el.appendChild(btn);
  });
}

document.addEventListener('click', e => {
  const picker = $('emoji-picker');
  if (!picker.contains(e.target) && e.target !== $('emoji-btn')) {
    picker.classList.add('hidden');
  }
});

// ── Bind UI events ────────────────────────────────────────────────────────────
function bindEvents() {
  // Send on Enter (Shift+Enter = newline)
  $('message-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Typing indicator with debounce
  let typingTimer = null;
  $('message-input').addEventListener('input', () => {
    if (!currentChat) return;
    clearTimeout(typingTimer);
    nc.sendTyping({ chatId: currentChat.id, type: currentChat.type });
    typingTimer = setTimeout(() => {}, 2000);
  });

  $('send-btn').onclick = sendMessage;

  // Attach file
  $('attach-btn').onclick = () => $('file-input').click();
  $('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) sendFile(file);
    e.target.value = '';
  });

  // Drag & drop into chat area
  const chatView = $('chat-view');
  chatView.addEventListener('dragover', e => {
    e.preventDefault();
  });
  chatView.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) sendFile(file);
  });

  // Settings button
  $('settings-btn').onclick = () => openSettings();

  // Status dot quick picker
  $('own-status-dot').onclick = e => {
    e.stopPropagation();
    showStatusDropdown($('own-status-dot'));
  };

  // Mood / status message inline edit
  const moodEl = $('own-mood');
  moodEl.addEventListener('click', () => {
    moodEl.contentEditable = 'true';
    moodEl.classList.add('editing');
    moodEl.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(moodEl);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  });
  moodEl.addEventListener('blur', async () => {
    moodEl.contentEditable = 'false';
    moodEl.classList.remove('editing');
    const msg = moodEl.textContent.trim();
    if (msg !== (myProfile.status_message || '')) {
      myProfile = { ...myProfile, status_message: msg };
      await nc.setStatusMessage(msg);
    }
  });
  moodEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      moodEl.blur();
    }
    if (e.key === 'Escape') {
      moodEl.textContent = myProfile.status_message || '';
      moodEl.blur();
    }
  });

  // New channel button
  $('new-channel-btn').onclick = () => showNewChannelModal();

  // Search input
  let searchTimer = null;
  $('search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(e.target.value), 300);
  });
}

// ── IPC events from main ──────────────────────────────────────────────────────
function subscribeIPCEvents() {
  nc.on('users:updated', async () => {
    const users = await nc.getUsers();
    renderDMList(users);
  });

  nc.on('message:incoming', async msg => {
    const isCurrentChannel = currentChat?.type === 'channel' && msg.channel_id === currentChat.id;
    const isCurrentDM = currentChat?.type === 'dm' && msg.from_uuid === currentChat.id;
    if (isCurrentChannel || isCurrentDM) {
      await loadMessages();
    } else {
      // Increment unread counter for this chat
      const chatId = msg.channel_id || msg.from_uuid;
      unreadCounts.set(chatId, (unreadCounts.get(chatId) || 0) + 1);
      updateBadge();
      playNotifSound();

      if (msg.channel_id) {
        showToast(`Nuevo mensaje en #${msg.channel_name || 'canal'}`);
      } else {
        showDMNotification(msg);
      }
    }
  });

  nc.on('notification:navigate', ({ chatId, chatType }) => {
    if (chatType === 'channel') {
      const ch = cachedChannels.find(c => c.id === chatId);
      if (ch) openChat({ type: 'channel', id: ch.id, name: ch.name });
    } else {
      const user = cachedUsers.find(u => u.uuid === chatId);
      if (user) openChat({ type: 'dm', id: user.uuid, name: user.name });
    }
  });

  nc.on('message:edited', async () => {
    if (currentChat) await loadMessages();
  });
  nc.on('message:deleted', async () => {
    if (currentChat) await loadMessages();
  });
  nc.on('message:reaction', async () => {
    if (currentChat) await loadMessages();
  });

  nc.on('typing:incoming', ({ name, chatId }) => {
    if (!currentChat || currentChat.id !== chatId) return;
    $('typing-indicator').classList.remove('hidden');
    $('typing-text').textContent = `${name} está escribiendo`;
    clearTimeout(window._typingTimeout);
    window._typingTimeout = setTimeout(() => $('typing-indicator').classList.add('hidden'), 3000);
  });

  nc.on('message:read', ({ messageId }) => {
    // Update ✓✓ → blue ✓✓ without a full reload
    const statusEl = document.querySelector(`.msg-row[data-id="${messageId}"] .msg-status`);
    if (statusEl) statusEl.classList.add('read');
  });

  nc.on('status:set-from-tray', status => {
    nc.setStatus(status);
    myProfile = { ...myProfile, status };
    renderOwnProfile();
  });

  nc.on('channel:synced', async () => {
    await loadSidebar();
  });

  nc.on('file:offer', offer => showFileOfferDialog(offer));
  nc.on('file:progress', data => updateTransferProgress(data));
  nc.on('file:complete', async data => {
    // Reload messages so the file bubble becomes clickable with localPath
    if (currentChat) await loadMessages();
    showToast(`✓ ${data.name} descargado`);
  });
  nc.on('file:rejected', () => {
    showToast('El destinatario rechazó el archivo', 'warn');
  });
  nc.on('file:error', data => {
    showToast(`Error en transferencia: ${data.message || ''}`, 'error');
  });
}

// ── File send ─────────────────────────────────────────────────────────────────
async function sendFile(file) {
  if (!currentChat) return;
  await nc.sendFile({
    filePath: file.path,
    name: file.name,
    size: file.size,
    mimeType: file.type,
    chatId: currentChat.id,
    chatType: currentChat.type,
  });
  await loadMessages(); // show the file bubble immediately
}

function showFileOfferDialog(offer) {
  const box = $('modal-box');
  const overlay = $('modal-overlay');

  box.innerHTML = `
    <h2>Archivo entrante</h2>
    <div class="file-offer-box">
      <div class="file-bubble">
        <div class="file-icon">📄</div>
        <div class="file-info">
          <span class="file-name">${escHtml(offer.name)}</span>
          <span class="file-size">${formatSize(offer.size)}</span>
        </div>
      </div>
      <p style="font-size:13px;color:var(--nc-text-2)"><strong>${escHtml(offer.senderName)}</strong> quiere enviarte un archivo.</p>
      <div class="actions">
        <button class="btn btn-ghost" id="reject-file-btn">Rechazar</button>
        <button class="btn btn-primary" id="accept-file-btn">Aceptar</button>
      </div>
    </div>`;

  overlay.classList.remove('hidden');

  $('accept-file-btn').onclick = async () => {
    overlay.classList.add('hidden');
    await nc.acceptFile(offer.transferId);
  };
  $('reject-file-btn').onclick = async () => {
    overlay.classList.add('hidden');
    await nc.rejectFile(offer.transferId);
  };
}

function updateTransferProgress(data) {
  // Update progress bar inside the file bubble
  const prog = document.querySelector(`.transfer-progress[data-transfer="${data.transferId}"]`);
  if (!prog) return;
  const bar = prog.querySelector('.progress-bar');
  const pct = prog.querySelector('.prog-pct');
  if (bar) bar.style.width = `${data.percent}%`;
  if (pct) pct.textContent = `${data.percent}%`;
  if (data.done) prog.style.opacity = '0.5';
}

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  const view = $('main-content');
  view.innerHTML = `<div id="settings-container" style="height:100%;display:flex;flex-direction:column;overflow:hidden"></div>`;
  import('./views/settings.js')
    .then(m =>
      m.render($('settings-container'), myProfile, {
        onBack: async () => {
          view.innerHTML = `
        <div id="empty-state" class="empty-state">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" class="empty-logo">
            <rect width="80" height="80" rx="20" fill="#4A9E8F"/>
            <path d="M22 28C22 25.8 23.8 24 26 24H54C56.2 24 58 25.8 58 28V46C58 48.2 56.2 50 54 50H44L36 58V50H26C23.8 50 22 48.2 22 46V28Z" fill="white"/>
            <circle cx="32" cy="37" r="3" fill="#4A9E8F"/>
            <circle cx="40" cy="37" r="3" fill="#4A9E8F"/>
            <circle cx="48" cy="37" r="3" fill="#4A9E8F"/>
          </svg>
          <h2>NeuroChat</h2>
          <p>Selecciona un canal o usuario para comenzar</p>
          <p class="tagline">by Neurofic</p>
        </div>
        <div id="chat-view" class="chat-view hidden"></div>`;
          myProfile = await nc.getProfile();
          renderOwnProfile();
        },
        onProfileSaved: p => {
          myProfile = p;
          renderOwnProfile();
        },
      })
    )
    .catch(() => {
      // Settings view not yet implemented — show placeholder
      view.innerHTML = `
      <div style="padding:32px;color:var(--nc-text-2)">
        <h2>Ajustes</h2>
        <p style="margin-top:8px">Disponible en Fase 9</p>
        <button class="btn btn-ghost" style="margin-top:16px" onclick="location.reload()">← Volver</button>
      </div>`;
    });
}

// ── New channel modal ─────────────────────────────────────────────────────────
function showNewChannelModal() {
  const overlay = $('modal-overlay');
  const box = $('modal-box');

  box.innerHTML = `
    <h2>Nuevo canal</h2>
    <div class="form-group">
      <label>Nombre del canal</label>
      <input class="form-input" id="new-ch-name" placeholder="ej: marketing" maxlength="40" />
    </div>
    <div class="form-group">
      <label>Descripción (opcional)</label>
      <input class="form-input" id="new-ch-desc" placeholder="¿Para qué es este canal?" maxlength="120" />
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn btn-ghost" id="cancel-ch-btn" style="flex:1">Cancelar</button>
      <button class="btn btn-primary" id="create-ch-btn" style="flex:1">Crear</button>
    </div>`;

  overlay.classList.remove('hidden');
  $('new-ch-name').focus();

  $('cancel-ch-btn').onclick = () => overlay.classList.add('hidden');
  $('create-ch-btn').onclick = async () => {
    const name = $('new-ch-name').value.trim();
    if (!name) {
      $('new-ch-name').focus();
      return;
    }
    const desc = $('new-ch-desc').value.trim();
    overlay.classList.add('hidden');
    await nc.createChannel({ name, description: desc });
    await loadSidebar();
  };

  $('new-ch-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('create-ch-btn').click();
  });
}

// Close modal on overlay click
$('modal-overlay').addEventListener('click', e => {
  if (e.target === $('modal-overlay')) $('modal-overlay').classList.add('hidden');
});

// ── Search ────────────────────────────────────────────────────────────────────
async function runSearch(query) {
  if (!query.trim()) {
    await loadSidebar();
    return;
  }
  const results = await nc.search(query, {});
  // Show results in sidebar as temp list
  const list = $('channel-list');
  list.innerHTML = `<li style="padding:6px 10px;font-size:11px;color:var(--nc-text-2);font-weight:600">RESULTADOS</li>`;
  if (!results.length) {
    list.innerHTML += `<li style="padding:6px 10px;font-size:13px;color:var(--nc-text-2)">Sin resultados</li>`;
    return;
  }
  results.forEach(msg => {
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.innerHTML = `<span class="nav-label" style="font-size:12px;flex-direction:column;align-items:flex-start;gap:1px">
      <span style="font-weight:500">${escHtml(msg.content?.slice(0, 60) || '')}</span>
      <span style="color:var(--nc-text-2);font-size:11px">${formatTime(msg.timestamp)}</span>
    </span>`;
    li.onclick = async () => {
      $('search-input').value = '';
      await loadSidebar();
      if (msg.channel_id) openChat({ type: 'channel', id: msg.channel_id, name: '…' });
      else if (msg.private_chat_uuid) openChat({ type: 'dm', id: msg.from_uuid, name: '…' });
    };
    list.appendChild(li);
  });
}

// ── Status quick dropdown ─────────────────────────────────────────────────────
const STATUS_LABELS = {
  available: 'Disponible',
  away: 'Ausente',
  dnd: 'No molestar',
  invisible: 'Invisible',
};

function showStatusDropdown(anchor) {
  document.querySelector('.status-dropdown')?.remove();

  const dropdown = document.createElement('div');
  dropdown.className = 'status-dropdown';
  dropdown.innerHTML = Object.entries(STATUS_LABELS)
    .map(
      ([s, label]) => `
    <div class="status-dropdown-item${(myProfile?.status || 'available') === s ? ' active' : ''}" data-s="${s}">
      <span class="sdot ${s}"></span>${label}
    </div>`
    )
    .join('');

  const rect = anchor.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(dropdown);

  dropdown.querySelectorAll('.status-dropdown-item').forEach(item => {
    item.onclick = async e => {
      e.stopPropagation();
      const status = item.dataset.s;
      await nc.setStatus(status);
      myProfile = { ...myProfile, status };
      renderOwnProfile();
      dropdown.remove();
    };
  });

  setTimeout(() => document.addEventListener('click', () => dropdown.remove(), { once: true }), 0);
}

// ── DM notification popup ─────────────────────────────────────────────────────
function showDMNotification(msg) {
  document.querySelector('.dm-notification')?.remove();

  const card = document.createElement('div');
  card.className = 'dm-notification';

  const color = msg.color || '#4A9E8F';
  const initial = (msg.sender_name || '?').charAt(0).toUpperCase();
  const avatarSvg =
    msg.avatar && msg.avatar.startsWith('nc-avatar:')
      ? AVATAR_SVGS[msg.avatar.slice(10)] || initial
      : initial;
  const preview = escHtml((msg.content || '').slice(0, 90));

  card.innerHTML = `
    <div class="dm-notif-avatar" style="background:${color}">${typeof avatarSvg === 'string' && avatarSvg.startsWith('<') ? avatarSvg : initial}</div>
    <div class="dm-notif-body">
      <span class="dm-notif-name">${escHtml(msg.sender_name || 'Mensaje nuevo')}</span>
      <span class="dm-notif-text">${preview}</span>
    </div>
    <div class="dm-notif-actions">
      <button class="btn btn-primary dm-notif-open" style="font-size:11px;padding:5px 10px;white-space:nowrap">Abrir</button>
      <button class="icon-btn dm-notif-close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>`;

  document.body.appendChild(card);
  requestAnimationFrame(() => card.classList.add('visible'));

  const timer = setTimeout(
    () => card.classList.remove('visible') || setTimeout(() => card.remove(), 200),
    6000
  );
  card.addEventListener('mouseenter', () => clearTimeout(timer));

  card.querySelector('.dm-notif-open').onclick = () => {
    card.remove();
    clearTimeout(timer);
    openChat({ type: 'dm', id: msg.from_uuid, name: msg.sender_name || 'Mensaje directo' });
  };
  card.querySelector('.dm-notif-close').onclick = () => {
    clearTimeout(timer);
    card.remove();
  };
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = '') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatText(text) {
  return escHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function formatTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  const d = new Date(ts);
  if (diff < 60_000) return 'ahora';
  if (diff < 3600_000) return `hace ${Math.floor(diff / 60000)} min`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d >= today) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d >= yesterday)
    return `Ayer ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatDateSeparator(ts) {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d >= today) return 'Hoy';
  if (d >= yesterday) return 'Ayer';
  return d.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function insertAtCursor(el, text) {
  el.focus();
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    el.textContent += text;
  }
}

function placeCursorAtEnd(el) {
  const range = document.createRange();
  const sel = window.getSelection();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Start ─────────────────────────────────────────────────────────────────────
init().catch(err => console.error('Init error:', err));
