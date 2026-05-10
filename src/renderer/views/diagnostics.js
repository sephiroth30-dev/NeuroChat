'use strict';

export function renderDiagResults(container, r) {
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
      <span class="diag-label">${esc(row.label)}</span>
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
