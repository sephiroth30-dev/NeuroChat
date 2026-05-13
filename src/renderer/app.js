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
let hiddenDMs = [];

const STATUS_TITLES = {
  available: 'Disponible',
  away: 'Ausente',
  dnd: 'No molestar',
  invisible: 'Invisible',
  offline: 'Desconectado',
};

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
  let wasAutoAway = false;

  function goAway() {
    if (myProfile?.status === 'dnd' || myProfile?.status === 'invisible') return;
    if (myProfile?.status !== 'available') return;
    wasAutoAway = true;
    nc.setStatus('away').then(() => {
      myProfile = { ...myProfile, status: 'away' };
      renderOwnProfile();
    });
  }

  function comeBack() {
    if (!wasAutoAway) return;
    wasAutoAway = false;
    nc.setStatus('available').then(() => {
      myProfile = { ...myProfile, status: 'available' };
      renderOwnProfile();
    });
  }

  // System-level idle detection (fires from main process via powerMonitor)
  nc.on('system:idle', () => goAway());
  nc.on('system:active', () => comeBack());
}

// ── Sound notification ────────────────────────────────────────────────────────
function playNotifSound() {
  if (!soundEnabled) return;
  try {
    if (!_audioCtx) _audioCtx = new AudioContext();
    const ctx = _audioCtx;
    ctx.resume?.();

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.015);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.62);
    master.connect(ctx.destination);

    const notes = [
      { f: 740, at: 0.00, dur: 0.16 },
      { f: 988, at: 0.11, dur: 0.18 },
      { f: 1318, at: 0.24, dur: 0.28 },
    ];

    notes.forEach(({ f, at, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, ctx.currentTime + at);
      osc.frequency.exponentialRampToValueAtTime(f * 0.985, ctx.currentTime + at + dur);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.55, ctx.currentTime + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.02);
    });
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
  const nameEl = $('own-name');
  nameEl.textContent = myProfile.name;
  nameEl.title = 'Clic para editar nombre';
  nameEl.style.cursor = 'pointer';
  nameEl.onclick = () => startEditOwnName();

  const moodEl = $('own-mood');
  if (moodEl) moodEl.textContent = myProfile.status_message || '';

  const dot = $('own-status-dot');
  if (dot) {
    dot.className = `own-status-dot ${myProfile.status || 'available'}`;
    dot.title = `Estado: ${STATUS_TITLES[myProfile.status] || 'Disponible'} — clic para cambiar`;
  }

  renderAvatar($('own-avatar'), myProfile);
}

function startEditOwnName() {
  const nameEl = $('own-name');
  const current = myProfile?.name || '';
  nameEl.contentEditable = 'true';
  nameEl.classList.add('editing');
  nameEl.focus();
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const finish = async () => {
    nameEl.contentEditable = 'false';
    nameEl.classList.remove('editing');
    const newName = nameEl.textContent.trim();
    if (newName && newName !== current) {
      myProfile = await nc.saveProfile({ ...myProfile, name: newName });
      renderOwnProfile();
    } else {
      nameEl.textContent = current;
    }
  };

  nameEl.onblur = finish;
  nameEl.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); }
    if (e.key === 'Escape') { nameEl.textContent = current; nameEl.blur(); }
  };
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
  const [channels, users, hidden, lastActivity] = await Promise.all([
    nc.getChannels(),
    nc.getUsers(),
    nc.getHiddenDMs(),
    nc.getLastDMActivity(),
  ]);
  hiddenDMs = hidden || [];
  renderChannelList(channels);
  renderDMList(users, lastActivity || {});
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

function renderDMList(users, lastActivity = {}) {
  const list = $('dm-list');
  const myUuid = myProfile?.uuid;
  list.innerHTML = '';
  const others = users.filter(u => u.uuid !== myUuid);
  cachedUsers = others;

  const sortFn = (a, b) => {
    const aTs = lastActivity[a.uuid] || 0;
    const bTs = lastActivity[b.uuid] || 0;
    if (aTs !== bTs) return bTs - aTs;
    return (a.name || '').localeCompare(b.name || '');
  };

  // Split: visible (not hidden or has unread) vs hidden
  const visibleUsers = others.filter(u => !hiddenDMs.includes(u.uuid) || (unreadCounts.get(u.uuid) || 0) > 0);
  const hiddenUsers  = others.filter(u =>  hiddenDMs.includes(u.uuid) && (unreadCounts.get(u.uuid) || 0) === 0);

  const onlineUsers  = visibleUsers.filter(u =>  u.is_online).sort(sortFn);
  const offlineUsers = visibleUsers.filter(u => !u.is_online).sort(sortFn);

  if (!visibleUsers.length && !hiddenUsers.length) {
    list.innerHTML =
      '<li class="nav-item" style="color:var(--nc-text-2);font-size:12px;padding:6px 10px;">Sin usuarios detectados</li>';
    return;
  }

  onlineUsers.forEach(u => appendDMItem(list, u, false));

  if (offlineUsers.length > 0) {
    const divider = document.createElement('li');
    divider.className = 'dm-divider';
    divider.textContent = 'Desconectados';
    list.appendChild(divider);
    offlineUsers.forEach(u => appendDMItem(list, u, true));
  }

  if (hiddenUsers.length > 0) {
    const toggleLi = document.createElement('li');
    toggleLi.className = 'nav-item hidden-dms-toggle';
    toggleLi.innerHTML = `
      <svg class="hidden-dms-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>
      <span style="flex:1;font-size:12px;">Chats ocultos (${hiddenUsers.length})</span>
    `;
    const hiddenList = document.createElement('ul');
    hiddenList.className = 'hidden-dms-list';
    hiddenList.style.display = 'none';
    hiddenUsers.sort(sortFn).forEach(u => appendDMItem(hiddenList, u, !u.is_online));

    toggleLi.onclick = () => {
      const open = hiddenList.style.display !== 'none';
      hiddenList.style.display = open ? 'none' : 'block';
      toggleLi.querySelector('.hidden-dms-chevron').style.transform = open ? '' : 'rotate(90deg)';
    };
    list.appendChild(toggleLi);
    list.appendChild(hiddenList);
  }
}

function appendDMItem(container, user, isOffline) {
  const li = document.createElement('li');
  li.className = `nav-item dm-item${isOffline ? ' dm-offline' : ''}`;
  li.dataset.uuid = user.uuid;

  const statusClass = user.is_online ? (user.status || 'available') : 'offline';
  const statusLabel = STATUS_TITLES[statusClass] || 'Desconectado';

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'avatar-wrap';
  const avatarEl = document.createElement('div');
  avatarEl.className = 'avatar small';
  renderAvatar(avatarEl, user);
  const statusDot = document.createElement('span');
  statusDot.className = `avatar-status ${statusClass}`;
  statusDot.title = statusLabel;
  avatarWrap.appendChild(avatarEl);
  avatarWrap.appendChild(statusDot);

  const labelWrap = document.createElement('div');
  labelWrap.className = 'dm-label-wrap';

  const label = document.createElement('span');
  label.className = 'nav-label';
  label.textContent = user.name;
  labelWrap.appendChild(label);

  const subtitle = user.status_message || (isOffline ? 'Desconectado' : statusLabel !== 'Disponible' ? statusLabel : '');
  if (subtitle) {
    const mood = document.createElement('span');
    mood.className = 'dm-status-msg';
    mood.textContent = subtitle;
    labelWrap.appendChild(mood);
  }

  li.appendChild(avatarWrap);
  li.appendChild(labelWrap);

  const dmCount = unreadCounts.get(user.uuid) || 0;
  if (dmCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'unread-badge';
    badge.textContent = dmCount > 99 ? '99+' : dmCount;
    li.appendChild(badge);
  }
  li.onclick = () => openChat({ type: 'dm', id: user.uuid, name: user.name });
  li.oncontextmenu = e => { e.preventDefault(); showDMMenu(e, user); };
  container.appendChild(li);
}

// ── Unread badge management ───────────────────────────────────────────────────
function updateBadge() {
  const total = Array.from(unreadCounts.values()).reduce((a, b) => a + b, 0);
  const dataUrl = total > 0 ? createBadgeDataUrl(total) : null;
  nc.setBadge(total, dataUrl);
  // Re-render sidebar lists to reflect new counts
  if (cachedChannels.length) renderChannelList(cachedChannels);
  if (cachedUsers.length) {
    nc.getLastDMActivity().then(activity => {
      renderDMList(cachedUsers, activity || {});
    });
  }
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
  // If settings panel is visible, close it first and re-navigate after
  if (isSettingsOpen()) {
    window._pendingChatNav = chat;
    const backBtn = document.getElementById('back-btn');
    if (backBtn) backBtn.click();
    return;
  }

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

  // Show/hide channel info button
  const chInfoBtn = $('channel-info-btn');
  if (chat.type === 'channel') {
    chInfoBtn.classList.remove('hidden');
    chInfoBtn.onclick = () => showChannelInfoModal(chat.id);
  } else {
    chInfoBtn.classList.add('hidden');
    chInfoBtn.onclick = null;
  }

  // Avatar header
  const avatarEl = $('chat-avatar');
  avatarEl.textContent = chat.name.charAt(0).toUpperCase();

  // Load messages
  await loadMessages();

  // Focus input
  $('message-input').focus();
}

// Navigate to a chat by id/type (used by notification click)
function navigateToChat(chatId, chatType) {
  if (chatType === 'channel') {
    const ch = cachedChannels.find(c => c.id === chatId);
    if (ch) openChat({ type: 'channel', id: ch.id, name: ch.name });
  } else {
    const user = cachedUsers.find(u => u.uuid === chatId);
    openChat({ type: 'dm', id: chatId, name: user?.name || 'Mensaje directo' });
  }
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

  scrollMessagesToBottom();
}

function scrollMessagesToBottom() {
  const list = $('message-list');
  if (!list) return;

  const pin = () => {
    list.scrollTop = list.scrollHeight;
    list.lastElementChild?.scrollIntoView({ block: 'end' });
  };

  pin();
  requestAnimationFrame(pin);
  setTimeout(pin, 60);
}

function fileUrlFromPath(localPath) {
  if (!localPath) return '';
  const normalized = localPath.replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${encodeURI(prefixed)}`;
}

function audioSrcFromMessage(msg, meta) {
  if (msg.localPath) return fileUrlFromPath(msg.localPath);
  if (meta?.data && meta?.mimeType) return `data:${meta.mimeType};base64,${meta.data}`;
  return '';
}

function makeDateSeparator(ts) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.innerHTML = `<span>${formatDateSeparator(ts)}</span>`;
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

  if (msg.type === 'file') return makeFileRow(row, msg, isOutgoing);
  if (msg.type === 'audio') return makeAudioRow(row, msg, isOutgoing);

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
  const safeLocal = localPath ? fileUrlFromPath(localPath) : '';

  let inner;
  if (isImage && localPath) {
    inner = `
      <div class="img-bubble">
        <img src="${safeLocal}" alt="${escHtml(name)}" />
      </div>`;
  } else {
    const icon = getFileIcon(mimeType);
    const downloadBtn = localPath && size <= 30 * 1024 * 1024
      ? `<button class="file-download-btn" title="Abrir / guardar" data-path="${escHtml(localPath)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 3v13M5 14l7 7 7-7"/><path d="M3 21h18"/></svg>
         </button>`
      : '';
    inner = `
      <div class="file-bubble${localPath ? ' has-file' : ''}" data-transfer="${escHtml(meta.transferId || '')}">
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <span class="file-name">${escHtml(name)}</span>
          <span class="file-size">${formatSize(size)}</span>
        </div>
        ${downloadBtn}
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
    row.querySelector('.file-bubble')?.addEventListener('click', e => {
      if (e.target.closest('.file-download-btn')) return;
      nc.openFile(localPath);
    });
  }
  row.querySelector('.file-download-btn')?.addEventListener('click', async e => {
    e.stopPropagation();
    await nc.downloadFile(e.currentTarget.dataset.path);
  });
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e, msg, isOutgoing);
  });
  return row;
}

function makeAudioRow(row, msg, isOutgoing) {
  let meta = {};
  try { meta = JSON.parse(msg.content || '{}'); } catch {}
  const audioSrc = audioSrcFromMessage(msg, meta);
  const statusHtml = isOutgoing ? renderDeliveryStatus(msg) : '';
  const bars = Array.from({ length: 30 }, (_, i) => {
    const h = Math.max(4, 4 + Math.sin(i * 0.7 + 1) * 8 + Math.sin(i * 1.3) * 5 + Math.abs(Math.sin(i * 0.4)) * 5);
    const y = (32 - h) / 2;
    return `<rect x="${i * 4 + 1}" y="${y.toFixed(1)}" width="2.5" rx="1.25" height="${h.toFixed(1)}"/>`;
  }).join('');

  row.innerHTML = `
    <div class="msg-bubble">
      ${currentChat?.type === 'channel' && !isOutgoing ? `<span class="msg-sender" style="color:${msg.color || '#4A9E8F'}">${escHtml(msg.sender_name || '')}</span>` : ''}
      <div class="audio-bubble${audioSrc ? '' : ' pending'}">
        <button class="audio-play-btn" id="play-${msg.id}" ${audioSrc ? '' : 'disabled'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <div class="audio-wave"><svg viewBox="0 0 120 32" preserveAspectRatio="none">${bars}</svg></div>
        <span class="audio-dur" id="dur-${msg.id}">0:00</span>
      </div>
      <div class="msg-meta">
        <span class="msg-time">${formatTime(msg.timestamp)}</span>
        ${statusHtml}
      </div>
    </div>`;

  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    showContextMenu(e, msg, isOutgoing);
  });

  if (audioSrc) {
    const audio = new Audio(audioSrc);
    const playBtn = row.querySelector(`#play-${msg.id}`);
    const durEl = row.querySelector(`#dur-${msg.id}`);
    const PLAY_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    const PAUSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    const fmt = s => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration)) durEl.textContent = fmt(audio.duration);
    };
    audio.onerror = () => {
      playBtn.disabled = true;
      durEl.textContent = '--:--';
      showToast('No se pudo reproducir esta nota de voz', 'error');
    };
    let playing = false;
    playBtn.onclick = async () => {
      if (playing) {
        audio.pause(); playBtn.innerHTML = PLAY_ICON; playing = false;
      } else {
        try {
          await audio.play();
          playBtn.innerHTML = PAUSE_ICON;
          playing = true;
          audio.ontimeupdate = () => { durEl.textContent = fmt(audio.currentTime); };
          audio.onended = () => {
            playing = false;
            playBtn.innerHTML = PLAY_ICON;
            audio.currentTime = 0;
            if (Number.isFinite(audio.duration)) durEl.textContent = fmt(audio.duration);
          };
        } catch {
          showToast('No se pudo reproducir esta nota de voz', 'error');
        }
      }
    };
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

  const CTX_ICONS = {
    reply:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`,
    forward: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>`,
    react:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none"/></svg>`,
    copy:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    edit:    `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>`,
    delete:  `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
    pin:     `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>`,
  };

  const items = [
    { icon: 'reply',   label: 'Responder',  action: () => setReply(msg) },
    { icon: 'forward', label: 'Reenviar',   action: () => showForwardModal(msg) },
    { icon: 'react',   label: 'Reaccionar', action: () => showReactionPicker(e, msg) },
    { icon: 'copy',    label: 'Copiar',     action: () => navigator.clipboard.writeText(msg.content || '') },
  ];

  if (isOutgoing && !msg.deleted && (msg.type || 'text') === 'text') {
    items.push({ icon: 'edit',   label: 'Editar',   action: () => startEdit(msg) });
  }

  if (isOutgoing && !msg.deleted) {
    items.push({ icon: 'delete', label: 'Eliminar', action: () => deleteMessage(msg), danger: true });
  }

  if (currentChat?.type === 'channel') {
    items.push({ icon: 'pin', label: 'Anclar', action: () => pinMessage(msg) });
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `context-item${item.danger ? ' danger' : ''}`;
    el.innerHTML = `${CTX_ICONS[item.icon] || ''}<span>${item.label}</span>`;
    el.onclick = () => {
      removeContextMenu();
      item.action();
    };
    menu.appendChild(el);
  });

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - rect.height - 8))}px`;
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

// ── Forward message ───────────────────────────────────────────────────────────
function showForwardModal(msg) {
  const overlay = $('modal-overlay');
  const box = $('modal-box');
  const preview = getMessagePreview(msg).slice(0, 80);

  const channelOpts = cachedChannels.map(ch =>
    `<option value="channel:${ch.id}"># ${escHtml(ch.name)}</option>`
  ).join('');
  const dmOpts = cachedUsers.filter(u => u.is_online).map(u =>
    `<option value="dm:${u.uuid}">${escHtml(u.name)}</option>`
  ).join('');

  box.innerHTML = `
    <h2>Reenviar mensaje</h2>
    <p style="font-size:13px;color:var(--nc-text-2);margin:0 0 14px;padding:10px 12px;background:var(--nc-input-bg);border-radius:var(--nc-radius);border-left:3px solid var(--nc-primary)">${escHtml(preview)}${getMessagePreview(msg).length > 80 ? '…' : ''}</p>
    <div class="form-group">
      <label>Enviar a</label>
      <select class="form-input" id="forward-dest" style="cursor:pointer">
        ${channelOpts ? `<optgroup label="Canales">${channelOpts}</optgroup>` : ''}
        ${dmOpts ? `<optgroup label="Usuarios conectados">${dmOpts}</optgroup>` : ''}
      </select>
    </div>
    <div style="display:flex;gap:8px;margin-top:4px">
      <button class="btn btn-ghost" id="forward-cancel" style="flex:1">Cancelar</button>
      <button class="btn btn-primary" id="forward-send" style="flex:1">Reenviar</button>
    </div>`;

  overlay.classList.remove('hidden');

  $('forward-cancel').onclick = () => overlay.classList.add('hidden');
  $('forward-send').onclick = async () => {
    const val = $('forward-dest').value;
    if (!val) return;
    const [type, id] = val.split(':');
    const fwdMsg = {
      content: msg.content || '',
      type: msg.type || 'text',
      channelId: type === 'channel' ? id : null,
      toUuid: type === 'dm' ? id : null,
      replyTo: null,
    };
    await nc.sendMessage(fwdMsg);
    overlay.classList.add('hidden');
    if (currentChat && (
      (type === 'channel' && currentChat.id === id) ||
      (type === 'dm' && currentChat.id === id)
    )) {
      await loadMessages();
    }
    showToast('Mensaje reenviado');
  };
}

function getMessagePreview(msg) {
  if (msg.deleted) return 'Mensaje eliminado';
  if (msg.type === 'audio') return 'Nota de voz';
  if (msg.type === 'file') {
    try {
      const meta = JSON.parse(msg.content || '{}');
      return meta.name ? `Archivo: ${meta.name}` : 'Archivo';
    } catch {
      return 'Archivo';
    }
  }
  return msg.content || '';
}

function showChannelMenu(e, ch) {
  removeContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const items = [
    {
      label: 'Abrir canal',
      action: () => openChat({ type: 'channel', id: ch.id, name: ch.name }),
    },
    {
      label: 'Info del canal',
      action: () => showChannelInfoModal(ch.id),
    },
  ];

  if (!ch.is_default) {
    items.push({
      label: 'Eliminar canal',
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

// ── DM context menu ───────────────────────────────────────────────────────────

function showDMMenu(e, user) {
  removeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const isHidden = hiddenDMs.includes(user.uuid);
  const items = [
    {
      label: 'Abrir conversación',
      action: () => openChat({ type: 'dm', id: user.uuid, name: user.name }),
    },
    {
      label: isHidden ? 'Mostrar conversación' : 'Ocultar conversación',
      action: async () => {
        if (isHidden) {
          await nc.unhideDM(user.uuid);
        } else {
          await nc.hideDM(user.uuid);
          if (currentChat?.type === 'dm' && currentChat.id === user.uuid) {
            currentChat = null;
            $('chat-view').classList.add('hidden');
            $('empty-state').classList.remove('hidden');
          }
        }
        await loadSidebar();
      },
    },
    {
      label: 'Eliminar conversación',
      danger: true,
      action: async () => {
        if (!confirm(`¿Eliminar toda la conversación con ${user.name}? Esta acción no se puede deshacer.`)) return;
        await nc.deleteDMConversation(user.uuid);
        if (currentChat?.type === 'dm' && currentChat.id === user.uuid) {
          currentChat = null;
          $('chat-view').classList.add('hidden');
          $('empty-state').classList.remove('hidden');
        }
        await loadSidebar();
      },
    },
  ];

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `context-item${item.danger ? ' danger' : ''}`;
    el.textContent = item.label;
    el.onclick = () => { removeContextMenu(); item.action(); };
    menu.appendChild(el);
  });

  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
  menu.style.top = `${Math.min(e.clientY, window.innerHeight - 120)}px`;
  document.body.appendChild(menu);
  activeMenu = menu;
  setTimeout(() => document.addEventListener('click', removeContextMenu, { once: true }), 0);
}

// ── Channel info modal ────────────────────────────────────────────────────────

function memberAvatar(m) {
  const initials = (m.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const statusClass = m.is_online ? m.status || 'available' : 'offline';
  const statusLabel = STATUS_TITLES[statusClass] || 'Desconectado';
  return `
    <div class="avatar-wrap" style="flex-shrink:0">
      <div class="avatar small" style="background:${m.color || '#4A9E8F'};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff">${initials}</div>
      <span class="avatar-status ${statusClass}" title="${statusLabel}"></span>
    </div>`;
}

async function showChannelInfoModal(channelId) {
  const existing = document.getElementById('channel-info-modal');
  if (existing) existing.remove();

  let { channel, members, nonMembers } = await nc.getChannelInfo(channelId);
  if (!channel) return;

  const overlay = document.createElement('div');
  overlay.id = 'channel-info-modal';
  overlay.className = 'modal-overlay';

  function renderModal() {
    const myUuid = myProfile?.uuid;
    const onlineCount = members.filter(m => m.is_online).length;
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:420px">
        <div class="modal-header">
          <span class="modal-title"># ${escHtml(channel.name)}</span>
          <button class="modal-close" id="close-ch-info">✕</button>
        </div>
        ${channel.description ? `<p class="modal-desc">${escHtml(channel.description)}</p>` : ''}

        <div class="modal-section-title">
          Usuarios en la red
          <span style="font-weight:400;margin-left:6px">${onlineCount} conectado${onlineCount !== 1 ? 's' : ''} · ${members.length} total</span>
        </div>
        ${members.length === 0 ? `<p style="padding:12px 20px;color:var(--nc-text-2);font-size:13px;">Sin miembros en este canal.</p>` : ''}
        <ul class="modal-member-list" id="ch-member-list">
          ${members.map(m => `
            <li class="modal-member" data-uuid="${m.uuid}">
              ${memberAvatar(m)}
              <div style="flex:1;min-width:0">
                <span class="modal-member-name">${escHtml(m.name)}</span>
                ${m.status_message ? `<span class="dm-status-msg">${escHtml(m.status_message)}</span>` : ''}
              </div>
              ${m.uuid === myUuid
                ? '<span style="font-size:11px;color:var(--nc-text-2)">Tú</span>'
                : m.is_online
                  ? '<span style="font-size:11px;color:var(--nc-online)">Conectado</span>'
                  : '<span style="font-size:11px;color:var(--nc-text-2)">Desconectado</span>'}
              ${m.uuid !== myUuid && !channel.is_default
                ? `<button class="icon-btn ch-remove-member" data-uuid="${m.uuid}" title="Quitar del canal">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>`
                : ''}
            </li>`).join('')}
        </ul>
        ${!channel.is_default ? `
          <div class="modal-section-title">
            Agregar miembros
            <span style="font-weight:400;margin-left:6px">${nonMembers.length} disponible${nonMembers.length !== 1 ? 's' : ''}</span>
          </div>
          ${nonMembers.length === 0 ? `<p style="padding:12px 20px;color:var(--nc-text-2);font-size:13px;">Todos los usuarios detectados ya pertenecen al canal.</p>` : ''}
          <ul class="modal-member-list" id="ch-nonmember-list">
            ${nonMembers.map(m => `
              <li class="modal-member" data-uuid="${m.uuid}">
                ${memberAvatar(m)}
                <div style="flex:1;min-width:0">
                  <span class="modal-member-name">${escHtml(m.name)}</span>
                  ${m.status_message ? `<span class="dm-status-msg">${escHtml(m.status_message)}</span>` : ''}
                </div>
                <button class="btn btn-ghost ch-add-member" data-uuid="${m.uuid}" style="font-size:11px;padding:4px 9px">Agregar</button>
              </li>`).join('')}
          </ul>` : ''}
      </div>`;

    document.getElementById('close-ch-info').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    overlay.querySelectorAll('.ch-add-member').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        await nc.addChannelMember(channel.id, btn.dataset.uuid);
        ({ channel, members, nonMembers } = await nc.getChannelInfo(channel.id));
        renderModal();
        await loadSidebar();
      };
    });

    overlay.querySelectorAll('.ch-remove-member').forEach(btn => {
      btn.onclick = async e => {
        e.stopPropagation();
        await nc.removeChannelMember(channel.id, btn.dataset.uuid);
        ({ channel, members, nonMembers } = await nc.getChannelInfo(channel.id));
        renderModal();
        await loadSidebar();
      };
    });
  }

  renderModal();
  document.body.appendChild(overlay);
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
  $('edit-preview-text').textContent = msg.content;
  $('edit-preview').classList.remove('hidden');
  $('reply-preview').classList.add('hidden'); // cancelar reply si hubiera
  replyingTo = null;
  input.focus();
  placeCursorAtEnd(input);
}

function cancelEdit() {
  editingId = null;
  $('edit-preview').classList.add('hidden');
  $('message-input').textContent = '';
}

$('cancel-edit-btn').onclick = cancelEdit;

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
    $('edit-preview').classList.add('hidden');
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

  // Voice recording
  let _mediaRecorder = null;
  let _audioChunks = [];
  let _recTimer = null;
  let _recSecs = 0;
  let _recAudioCtx = null;
  let _recAnalyser = null;
  let _recAnimation = null;

  const recWave = $('rec-wave');
  if (recWave && !recWave.children.length) {
    recWave.innerHTML = Array.from({ length: 18 }, () => '<span></span>').join('');
  }

  function setRecWaveLevel(level = 0) {
    const bars = Array.from(recWave?.children || []);
    bars.forEach((bar, i) => {
      const phase = Math.sin((Date.now() / 95) + i * 0.85) * 0.35 + 0.65;
      const height = 4 + Math.min(20, Math.max(0, level * phase * 26));
      bar.style.height = `${height}px`;
      bar.style.opacity = `${0.45 + Math.min(0.45, level * 0.03)}`;
    });
  }

  function startRecMeter(stream) {
    stopRecMeter();
    try {
      _recAudioCtx = new AudioContext();
      _recAnalyser = _recAudioCtx.createAnalyser();
      _recAnalyser.fftSize = 256;
      _recAudioCtx.createMediaStreamSource(stream).connect(_recAnalyser);
      const data = new Uint8Array(_recAnalyser.frequencyBinCount);
      const tick = () => {
        _recAnalyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, val) => sum + val, 0) / data.length;
        setRecWaveLevel(avg / 8);
        _recAnimation = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setRecWaveLevel(1);
    }
  }

  function stopRecMeter() {
    if (_recAnimation) cancelAnimationFrame(_recAnimation);
    _recAnimation = null;
    _recAnalyser = null;
    _recAudioCtx?.close?.().catch(() => {});
    _recAudioCtx = null;
    setRecWaveLevel(0);
  }

  $('mic-btn').onclick = async () => {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
      _mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      _mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      _mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _audioChunks.push(e.data); };
      _mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(_recTimer);
        stopRecMeter();
        $('recording-indicator').classList.add('hidden');
        $('mic-btn').classList.remove('recording');
        if (_audioChunks.length === 0 || !currentChat) return;
        const blob = new Blob(_audioChunks, { type: _mediaRecorder.mimeType || 'audio/webm' });
        const buffer = await blob.arrayBuffer();
        await nc.sendAudio({
          buffer,
          name: `voz-${Date.now()}.webm`,
          mimeType: blob.type || 'audio/webm',
          chatType: currentChat.type,
          chatId: currentChat.id,
        });
        await loadMessages();
      };
      _mediaRecorder.start(200);
      startRecMeter(stream);
      $('mic-btn').classList.add('recording');
      $('recording-indicator').classList.remove('hidden');
      _recSecs = 0;
      $('rec-timer').textContent = '0:00';
      _recTimer = setInterval(() => {
        _recSecs++;
        $('rec-timer').textContent = `${Math.floor(_recSecs / 60)}:${(_recSecs % 60).toString().padStart(2, '0')}`;
        if (_recSecs >= 120) _mediaRecorder.stop();
      }, 1000);
    } catch {
      alert('No se pudo acceder al micrófono. Verifica los permisos.');
    }
  };

  $('rec-cancel-btn').onclick = () => {
    if (_mediaRecorder && _mediaRecorder.state === 'recording') {
      _mediaRecorder.ondataavailable = null;
      _mediaRecorder.onstop = () => {
        _mediaRecorder.stream?.getTracks().forEach(t => t.stop());
        clearInterval(_recTimer);
        stopRecMeter();
        $('recording-indicator').classList.add('hidden');
        $('mic-btn').classList.remove('recording');
      };
      _mediaRecorder.stop();
    }
  };

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

  window.addEventListener('focus', async () => {
    _audioCtx?.resume?.().catch(() => {});
    if (currentChat) await loadMessages();
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    _audioCtx?.resume?.().catch(() => {});
    if (currentChat) await loadMessages();
  });
}

// ── IPC events from main ──────────────────────────────────────────────────────
function subscribeIPCEvents() {
  nc.on('users:updated', async () => {
    const [users, lastActivity] = await Promise.all([nc.getUsers(), nc.getLastDMActivity()]);
    cachedUsers = users.filter(u => u.uuid !== myProfile?.uuid);
    renderDMList(cachedUsers, lastActivity || {});
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
      nc.flashWindow();

      if (msg.channel_id) {
        showToast(`Nuevo mensaje en #${msg.channel_name || 'canal'}`);
      } else {
        showDMNotification(msg);
      }
    }
  });

  nc.on('notification:navigate', ({ chatId, chatType, action }) => {
    if (action === 'settings') {
      if (!isSettingsOpen()) openSettings();
      return;
    }
    navigateToChat(chatId, chatType);
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
    // Instant DOM update for the visible tick
    const statusEl = document.querySelector(`.msg-row[data-id="${messageId}"] .msg-status`);
    if (statusEl) {
      statusEl.classList.add('read');
    } else if (currentChat) {
      // Message not in current view — reload to sync DB state
      loadMessages();
    }
  });

  nc.on('status:set-from-tray', status => {
    nc.setStatus(status);
    myProfile = { ...myProfile, status };
    renderOwnProfile();
  });

  nc.on('channel:synced', async data => {
    await loadSidebar();
    if (data?.deleted && currentChat?.type === 'channel' && currentChat.id === data.id) {
      currentChat = null;
      $('chat-view').classList.add('hidden');
      $('empty-state').classList.remove('hidden');
      return;
    }
    if (currentChat?.type === 'channel') {
      const stillVisible = cachedChannels.some(ch => ch.id === currentChat.id);
      if (!stillVisible) {
        currentChat = null;
        $('chat-view').classList.add('hidden');
        $('empty-state').classList.remove('hidden');
      }
    }
  });

  nc.on('file:offer', offer => {
    if (offer.size <= 30 * 1024 * 1024) {
      nc.acceptFile(offer.transferId);
      showToast(`Recibiendo ${offer.name} de ${offer.senderName}…`);
    } else {
      showFileOfferDialog(offer);
    }
  });
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
function isSettingsOpen() {
  return !$('settings-panel')?.classList.contains('hidden');
}

function openSettings() {
  const panel = $('settings-panel');
  const container = $('settings-container');
  container.innerHTML = '';
  panel.classList.remove('hidden');

  import('./views/settings.js')
    .then(m =>
      m.render(container, myProfile, {
        onBack: async () => {
          panel.classList.add('hidden');
          container.innerHTML = '';
          myProfile = await nc.getProfile();
          renderOwnProfile();
          await loadSidebar();
          // If a chat was clicked while settings was open, navigate to it now
          const pending = window._pendingChatNav;
          if (pending) {
            window._pendingChatNav = null;
            openChat(pending);
          } else if (currentChat) {
            openChat(currentChat);
          }
        },
        onProfileSaved: p => {
          myProfile = p;
          renderOwnProfile();
        },
      })
    )
    .catch(err => {
      console.error('[Settings]', err);
      panel.classList.add('hidden');
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

  // Replace channel list with search results header
  const chList = $('channel-list');
  const dmList = $('dm-list');

  chList.innerHTML = `<li style="padding:6px 10px;font-size:11px;color:var(--nc-text-2);font-weight:600;letter-spacing:.05em">RESULTADOS (${results.length})</li>`;
  dmList.innerHTML = '';

  if (!results.length) {
    chList.innerHTML += `<li style="padding:10px;font-size:13px;color:var(--nc-text-2)">Sin resultados para "${escHtml(query)}"</li>`;
    return;
  }

  results.forEach(msg => {
    const li = document.createElement('li');
    li.className = 'nav-item search-result';
    const contextName = msg.channel_id
      ? `# ${escHtml(cachedChannels.find(c => c.id === msg.channel_id)?.name || 'canal')}`
      : escHtml(cachedUsers.find(u => u.uuid === msg.from_uuid)?.name || 'DM');
    li.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1">
        <span style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml((msg.content || '').slice(0, 55))}${(msg.content?.length || 0) > 55 ? '…' : ''}</span>
        <span style="font-size:11px;color:var(--nc-text-2)">${contextName} · ${formatTime(msg.timestamp)}</span>
      </div>`;
    li.onclick = async () => {
      $('search-input').value = '';
      await loadSidebar();
      if (msg.channel_id) {
        const ch = cachedChannels.find(c => c.id === msg.channel_id);
        if (ch) openChat({ type: 'channel', id: ch.id, name: ch.name });
      } else if (msg.from_uuid) {
        const user = cachedUsers.find(u => u.uuid === msg.from_uuid);
        if (user) openChat({ type: 'dm', id: user.uuid, name: user.name });
      }
    };
    chList.appendChild(li);
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
