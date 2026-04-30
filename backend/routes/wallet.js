// ============================================================
//  WALLET ROUTES
//  GET  /api/wallet/balance
//  GET  /api/wallet/history
//  POST /api/wallet/deposit/request
//  POST /api/wallet/withdraw/request
// ============================================================
const router = require('express').Router();
const db     = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── Helper: record a transaction (must be called inside a connection) ──
async function recordTx(conn, userId, type, amount, note, reference) {
  const [[user]] = await conn.query('SELECT balance FROM users WHERE id = ?', [userId]);
  const before   = user.balance;
  let   after;

  if (type === 'deposit' || type === 'prize' || type === 'refund') {
    after = before + amount;
    await conn.query(
      'UPDATE users SET balance = ?, total_won = total_won + ?, updated_at = NOW() WHERE id = ?',
      [after, (type === 'prize' ? amount : 0), userId]
    );
  } else {
    if (before < amount) throw new Error('ቀሪ ሂሳብ በቂ አይደለም');
    after = before - amount;
    await conn.query(
      'UPDATE users SET balance = ?, total_spent = total_spent + ?, updated_at = NOW() WHERE id = ?',
      [after, amount, userId]
    );
  }

  await conn.query(
    'INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, reference, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, type, amount, before, after, reference || null, note || null]
  );

  return { before, after };
}

// ── GET /api/wallet/balance ───────────────────────────────────
router.get('/balance', requireAuth, async (req, res) => {
  try {
    const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({
      ok:           true,
      balance:      user.balance,
      total_won:    user.total_won,
      total_spent:  user.total_spent,
      games_played: user.games_played,
      games_won:    user.games_won
    });
  } catch (err) {
    console.error('Balance error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/wallet/history ───────────────────────────────────
router.get('/history', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const [txs] = await db.query(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [req.user.id, limit]
    );
    res.json({ ok: true, transactions: txs });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/wallet/deposit/request ─────────────────────────
router.post('/deposit/request', requireAuth, async (req, res) => {
  try {
    const { amount, tx_id } = req.body;
    const amt = parseFloat(amount);
    const min = parseFloat(process.env.MIN_DEPOSIT || 10);

    if (isNaN(amt) || amt < min) {
      return res.status(400).json({ ok: false, msg: `ዝቅተኛ ገቢ ${min} ብር ነው` });
    }

    const [result] = await db.query(
      'INSERT INTO deposit_requests (user_id, amount, tx_id) VALUES (?, ?, ?)',
      [req.user.id, amt, tx_id || null]
    );
    const [[dep]] = await db.query('SELECT * FROM deposit_requests WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, msg: 'ጥያቄ ተልኳል። አስተዳዳሪው ሲያረጋግጥ ሂሳብዎ ይሞላል።', request: dep });
  } catch (err) {
    console.error('Deposit request error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/wallet/withdraw/request ────────────────────────
router.post('/withdraw/request', requireAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { amount, account_type, account_number } = req.body;
    const amt  = parseFloat(amount);
    const minW = parseFloat(process.env.MIN_WITHDRAW || 10);
    const maxW = parseFloat(process.env.MAX_WITHDRAW || 5000);

    if (isNaN(amt) || amt < minW || amt > maxW) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ ok: false, msg: `ዝቅተኛ ማውጫ ${minW} ብር፣ ከፍተኛ ${maxW} ብር ነው` });
    }
    if (!account_number) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ ok: false, msg: 'የሂሳብ ቁጥር ያስፈልጋል' });
    }

    const [[user]] = await conn.query('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    if (user.balance < amt) {
      await conn.rollback();
      conn.release();
      return res.status(400).json({ ok: false, msg: `ቀሪ ሂሳብ ${user.balance.toFixed(2)} ብር ነው` });
    }

    // Hold the amount immediately
    await recordTx(conn, req.user.id, 'withdraw_hold', amt, 'ማውጫ ጥያቄ ተያዘ', null);

    const [result] = await conn.query(
      'INSERT INTO withdraw_requests (user_id, amount, account_type, account_number) VALUES (?, ?, ?, ?)',
      [req.user.id, amt, account_type || 'telebirr', account_number]
    );
    const [[wr]] = await conn.query('SELECT * FROM withdraw_requests WHERE id = ?', [result.insertId]);

    await conn.commit();
    conn.release();
    res.status(201).json({ ok: true, msg: 'ጥያቄ ተልኳል። አስተዳዳሪው ሲያረጋግጥ ይላካል።', request: wr });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Withdraw request error:', err);
    res.status(400).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/wallet/game-fee  (local game entry fee deduction) ──
router.post('/game-fee', requireAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const amt      = parseFloat(req.body.amount);
    const note     = req.body.note || 'ካርድ ክፍያ';
    const gameCode = req.body.game_code || 'LOCAL-GAME';
    if (isNaN(amt) || amt <= 0) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ትክክለኛ መጠን ያስፈልጋል' });
    }
    const { after } = await recordTx(conn, req.user.id, 'entry_fee', amt, note, gameCode);
    await conn.query(
      'UPDATE users SET games_played = games_played + 1, updated_at = NOW() WHERE id = ?',
      [req.user.id]
    );
    await conn.commit(); conn.release();
    res.json({ ok: true, balance: after });
  } catch (err) {
    await conn.rollback(); conn.release();
    res.status(400).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/wallet/prize-pool  (get current prize pool from paid fees) ──
router.get('/prize-pool', requireAuth, async (req, res) => {
  try {
    const gameCode = req.query.game_code || 'LOCAL-GAME';
    const houseCutPct = parseFloat(process.env.HOUSE_CUT_PERCENT || 20) / 100;

    // Sum all entry fees for this game code
    const [[{ total }]] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE type = 'entry_fee' AND reference = ?`,
      [gameCode]
    );

    const houseCut = Math.floor(total * houseCutPct);
    const prize    = total - houseCut;

    res.json({ ok: true, total_collected: total, house_cut: houseCut, prize_pool: prize });
  } catch (err) {
    console.error('Prize pool error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/wallet/game-prize  (local game prize credit) ───────
router.post('/game-prize', requireAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const amt  = parseFloat(req.body.amount);
    const note = req.body.note || 'ቢንጎ ሽልማት';
    if (isNaN(amt) || amt <= 0) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ትክክለኛ መጠን ያስፈልጋል' });
    }
    const { after } = await recordTx(conn, req.user.id, 'prize', amt, note, 'LOCAL-GAME');
    await conn.query(
      'UPDATE users SET games_won = games_won + 1, total_won = total_won + ?, updated_at = NOW() WHERE id = ?',
      [amt, req.user.id]
    );
    await conn.commit(); conn.release();
    res.json({ ok: true, balance: after });
  } catch (err) {
    await conn.rollback(); conn.release();
    res.status(400).json({ ok: false, msg: err.message || 'Server error' });
  }
});

module.exports = router;
module.exports.recordTx = recordTx;
