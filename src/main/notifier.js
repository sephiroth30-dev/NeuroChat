'use strict';

const { Notification } = require('electron');

function notify({ title, body, onClick, persistent = false }) {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title,
    body,
    timeoutType: persistent ? 'never' : 'default',
  });

  if (onClick) n.on('click', onClick);
  n.show();
}

module.exports = { notify };
