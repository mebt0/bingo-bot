// ============================================================
//  WALLET MODEL — deposits, withdrawals, requests
// ============================================================
const db = require('../db/database');

const Wallet = {
  // ── Deposit request ───────────────────────────────────────
  createDepositRequest(userId, amount, screenshotFileId) {
    db.prepare(`
      INSERT INTO deposit_requests (user_id, amount, screenshot_file_id)
      VALUES (?, ?, ?)
    `).run(userId, amount, screenshotFileId || null);
    return db.prepare('SELECT * FROM deposit_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(userId);
  },

  getPendingDeposits() {
    return db.prepare(`
      SELECT dr.*, u.telegram_id, u.full_name, u.username
      FROM deposit_requests dr
      JOIN users u ON u.id = dr.user_id
      WHERE dr.status = 'pending'
      ORDER BY dr.created_at ASC
    `).all();
  },

  approveDeposit(requestId, reviewedBy) {
    const req = db.prepare('SELECT * FROM deposit_requests WHERE id=?').get(requestId);
    if (!req) throw new Error('Request not found');
    if (req.status !== 'pending') throw new Error('Already reviewed');

    db.prepare(`
      UPDATE deposit_requests SET status='approved', reviewed_by=?, reviewed_at=datetime('now')
      WHERE id=?
    `).run(String(reviewedBy), requestId);

    // Credit user
    const User = require('./user');
    User.credit(req.user_id, req.amount, 'deposit', `DEP-${requestId}`, 'Deposit approved');
    return req;
  },

  rejectDeposit(requestId, reviewedBy, note) {
    db.prepare(`
      UPDATE deposit_requests SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), note=?
      WHERE id=?
    `).run(String(reviewedBy), note || null, requestId);
  },

  // ── Withdraw request ──────────────────────────────────────
  createWithdrawRequest(userId, amount, accountType, accountNumber, accountName) {
    const User = require('./user');
    const user = User.findById(userId);
    if (!user) throw new Error('User not found');
    if (user.balance < amount) throw new Error('ቀሪ ሂሳብ በቂ አይደለም');

    const minWithdraw = parseFloat(process.env.MIN_WITHDRAW || 50);
    const maxWithdraw = parseFloat(process.env.MAX_WITHDRAW || 5000);
    if (amount < minWithdraw) throw new Error(`ዝቅተኛው መጠን ${minWithdraw} ብር ነው`);
    if (amount > maxWithdraw) throw new Error(`ከፍተኛው መጠን ${maxWithdraw} ብር ነው`);

    // Deduct from balance immediately (hold)
    User.debit(userId, amount, 'withdraw_hold', null, 'Withdraw request pending');

    db.prepare(`
      INSERT INTO withdraw_requests (user_id, amount, account_type, account_number, account_name)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, amount, accountType, accountNumber, accountName);

    return db.prepare('SELECT * FROM withdraw_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(userId);
  },

  getPendingWithdraws() {
    return db.prepare(`
      SELECT wr.*, u.telegram_id, u.full_name, u.username, u.balance
      FROM withdraw_requests wr
      JOIN users u ON u.id = wr.user_id
      WHERE wr.status = 'pending'
      ORDER BY wr.created_at ASC
    `).all();
  },

  approveWithdraw(requestId, reviewedBy) {
    const req = db.prepare('SELECT * FROM withdraw_requests WHERE id=?').get(requestId);
    if (!req) throw new Error('Request not found');
    if (req.status !== 'pending') throw new Error('Already reviewed');

    db.prepare(`
      UPDATE withdraw_requests SET status='approved', reviewed_by=?, reviewed_at=datetime('now')
      WHERE id=?
    `).run(String(reviewedBy), requestId);

    return req;
  },

  rejectWithdraw(requestId, reviewedBy, note) {
    const req = db.prepare('SELECT * FROM withdraw_requests WHERE id=?').get(requestId);
    if (!req) throw new Error('Request not found');
    if (req.status !== 'pending') throw new Error('Already reviewed');

    db.prepare(`
      UPDATE withdraw_requests SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), note=?
      WHERE id=?
    `).run(String(reviewedBy), note || null, requestId);

    // Refund user
    const User = require('./user');
    User.credit(req.user_id, req.amount, 'refund', `WDR-${requestId}`, 'Withdraw rejected - refunded');
    return req;
  },

  // ── Transaction history ───────────────────────────────────
  getUserTransactions(userId, limit = 20) {
    return db.prepare(`
      SELECT * FROM transactions WHERE user_id=?
      ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit);
  },

  getAllTransactions(limit = 100) {
    return db.prepare(`
      SELECT t.*, u.telegram_id, u.full_name
      FROM transactions t
      JOIN users u ON u.id = t.user_id
      ORDER BY t.created_at DESC LIMIT ?
    `).all(limit);
  }
};

module.exports = Wallet;
