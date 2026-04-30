// ============================================================
//  TELEGRAM NOTIFIER
//  Sends messages to users via the Bot API (no Telegraf needed)
//  Uses plain https — zero extra dependencies
//
//  Token is read from:  backend/.env  →  TELEGRAM_BOT_TOKEN
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const https = require('https');

// Read token lazily so .env is always loaded first
function getToken() {
  return process.env.TELEGRAM_BOT_TOKEN || null;
}

/**
 * Send a Markdown message to a Telegram chat/user.
 * @param {string|number} chatId  — Telegram user ID or chat ID
 * @param {string}        text    — Message text (Markdown)
 */
function notify(chatId, text) {
  return new Promise((resolve) => {
    const TOKEN = getToken();

    if (!TOKEN) {
      console.warn('TELEGRAM_BOT_TOKEN not set — notification skipped');
      return resolve();
    }
    if (!chatId) return resolve();

    const body = JSON.stringify({
      chat_id:    String(chatId),
      text:       text,
      parse_mode: 'Markdown'
    });

    const options = {
      hostname: 'api.telegram.org',
      path:     '/bot' + TOKEN + '/sendMessage',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      res.resume();   // drain response body
      resolve();
    });

    req.on('error', (e) => {
      console.warn('Telegram notify error:', e.message);
      resolve();      // non-fatal — never crash the server
    });

    req.setTimeout(5000, () => { req.destroy(); resolve(); });
    req.write(body);
    req.end();
  });
}

/**
 * Notify all admin users (reads telegram_id from users table).
 * @param {object} db   — db instance (passed in to avoid circular deps)
 * @param {string} text — Markdown message
 */
async function notifyAdmins(db, text) {
  try {
    const admins = db.prepare(
      'SELECT telegram_id FROM users WHERE is_admin = 1 AND telegram_id IS NOT NULL'
    ).all();
    for (const a of admins) {
      await notify(a.telegram_id, text);
    }
  } catch (e) {
    console.warn('notifyAdmins error:', e.message);
  }
}

/**
 * Quick connectivity test.
 * Usage:  node -e "require('./telegram').test('YOUR_CHAT_ID')"
 */
async function test(chatId) {
  console.log('Testing Telegram with token:', (getToken() || '').slice(0, 10) + '...');
  await notify(chatId, '✅ *Bingo Backend* — Telegram notifications are working!');
  console.log('Message sent.');
}

module.exports = { notify, notifyAdmins, test };
