// ============================================================
//  USER MODEL
// ============================================================
const db = require('../db/database');

const User = {
  // ── Find or create ────────────────────────────────────────
  findOrCreate(telegramId, fullName, username) {
    let user = db.prepare(
      'SELECT * FROM users WHERE telegram_id = ?'
    ).get(String(telegramId));

    if (!user) {
      db.prepare(`
        INSERT INTO users (telegram_id, full_name, username)
        VALUES (?, ?, ?)
      `).run(String(telegramId), fullName, username || null);
      user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
    } else {
      // Update name if changed
      db.prepare('UPDATE users SET full_name=?, username=?, updated_at=datetime("now") WHERE telegram_id=?')
        .run(fullName, username || null, String(telegramId));
      user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
    }
    return user;
  },

  findByTelegramId(telegramId) {
    return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegramId));
  },

  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  // ── Balance operations (atomic) ───────────────────────────
  credit(userId, amount, type, reference, note) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');
    const before = user.balance;
    const after  = before + amount;

    db.prepare('UPDATE users SET balance=?, updated_at=datetime("now") WHERE id=?')
      .run(after, userId);

    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, status, note)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(userId, type, amount, before, after, reference || null, note || null);

    return after;
  },

  debit(userId, amount, type, reference, note) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('User not found');
    if (user.balance < amount) throw new Error('ቀሪ ሂሳብ በቂ አይደለም');
    const before = user.balance;
    const after  = before - amount;

    db.prepare('UPDATE users SET balance=?, updated_at=datetime("now") WHERE id=?')
      .run(after, userId);

    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, status, note)
      VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(userId, type, amount, before, after, reference || null, note || null);

    return after;
  },

  // ── Stats update ──────────────────────────────────────────
  recordGamePlayed(userId) {
    db.prepare('UPDATE users SET games_played = games_played + 1, updated_at=datetime("now") WHERE id=?')
      .run(userId);
  },

  recordGameWon(userId, prize) {
    db.prepare(`
      UPDATE users SET games_won = games_won + 1,
      total_won = total_won + ?, updated_at=datetime("now") WHERE id=?
    `).run(prize, userId);
  },

  recordSpent(userId, amount) {
    db.prepare('UPDATE users SET total_spent = total_spent + ?, updated_at=datetime("now") WHERE id=?')
      .run(amount, userId);
  },

  ban(userId)   { db.prepare('UPDATE users SET is_banned=1 WHERE id=?').run(userId); },
  unban(userId) { db.prepare('UPDATE users SET is_banned=0 WHERE id=?').run(userId); },

  // ── Leaderboard ───────────────────────────────────────────
  topWinners(limit = 10) {
    return db.prepare('SELECT * FROM users ORDER BY total_won DESC LIMIT ?').all(limit);
  },

  all() {
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  },

  count() {
    return db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  }
};

module.exports = User;
