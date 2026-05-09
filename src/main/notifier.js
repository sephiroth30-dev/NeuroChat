'use strict';

const { Notification } = require('electron');

function notify({ title, body, onClick }) {
  if (!Notification.isSupported()) return;

  const n = new Notification({
    title,
    body,
    icon: undefined, // will use app icon by default
  });

  if (onClick) n.on('click', onClick);
  n.show();
}

module.exports = { notify };
