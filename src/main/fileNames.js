'use strict';

const path = require('path');

// Characters Windows forbids in a filename, plus ASCII control chars.
// ':' matters especially — it would otherwise create an NTFS alternate data
// stream. Spaces and hyphens are legal and deliberately preserved.
const ILLEGAL = new RegExp('[<>:"/\\\\|?*\\u0000-\\u001F]', 'g');

// Device names Windows refuses to use as a filename, with or without extension.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Make a peer-supplied filename safe to join onto a directory path.
 *
 * File names arrive inside message payloads, i.e. they are controlled by
 * whoever is on the LAN. Without this, a name like
 * "..\..\..\Start Menu\Programs\Startup\x.bat" would escape userData and
 * write an arbitrary file. path.basename() alone is not enough on Linux,
 * where a backslash is a legal filename character.
 */
function safeFileName(name, fallback = 'archivo') {
  let base =
    String(name || '')
      .replace(/\\/g, '/') // normalize so the split below strips Windows paths too
      .split('/')
      .pop() || '';

  base = base.replace(ILLEGAL, '_').replace(/^\.+/, '').trim();

  if (!base || RESERVED.test(base)) base = `${fallback}-${Date.now()}`;

  // Keep well under MAX_PATH once joined with the userData directory
  if (base.length > 120) {
    const ext = path.extname(base).slice(0, 20);
    base = base.slice(0, 120 - ext.length) + ext;
  }
  return base;
}

/**
 * Destination path for a received/stored attachment. Prefixing with the
 * message id keeps two different messages that share a filename (very common
 * with "Captura.png") from overwriting each other or, worse, pointing a new
 * files row at another message's bytes.
 */
function attachmentPath(dir, messageId, name) {
  return path.join(dir, `${messageId}-${safeFileName(name)}`);
}

module.exports = { safeFileName, attachmentPath };
