// ============================================================
//  ADMIN ROUTES  — protected by panel password only
//  POST /api/admin/panel-login
//  GET  /api/admin/stats
//  GET  /api/admin/users
//  GET  /api/admin/deposits/pending
//  POST /api/admin/deposits/:id/approve
//  POST /api/admin/deposits/:id/reject
//  GET  /api/admin/withdrawals/pending
//  POST /api/admin/withdrawals/:id/approve
//  POST /api/admin/withdrawals/:id/reject
//  POST /api/admin/users/:id/ban
//  POST /api/admin/users/:id/unban
//  POST /api/admin/users/:id/credit
//  GET  /api/admin/games
// ============================================================
const router = require('express').Router();
const db     = require('../db');
const tg     = require('../telegram');

// ── recordTx helper (inline — avoids circular require with wallet.js) ──
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

// ── POST /api/admin/panel-login  (public — no auth needed) ───
router.post('/panel-login', (req, res) => {
  const { password } = req.body;
  const correct = process.env.ADMIN_PANEL_PASSWORD || 'mebt1234';
  if (!password || password !== correct) {
    return res.status(401).json({ ok: false, msg: 'የይለፍ ቃሉ ትክክል አይደለም' });
  }
  const panelToken = Buffer.from('admin:' + correct).toString('base64');
  res.json({ ok: true, token: panelToken });
});

// ── Panel auth middleware ─────────────────────────────────────
function requirePanelAuth(req, res, next) {
  const token    = req.headers['x-admin-panel'] || '';
  const correct  = process.env.ADMIN_PANEL_PASSWORD || 'mebt1234';
  const expected = Buffer.from('admin:' + correct).toString('base64');
  if (!token || token !== expected) {
    return res.status(401).json({ ok: false, msg: '❌ Admin panel access denied' });
  }
  next();
}

// All routes below require panel password
router.use(requirePanelAuth);

// ── GET /api/admin/stats ──────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [[{ c: userCount }]]    = await db.query('SELECT COUNT(*) AS c FROM users');
    const [[{ c: gameCount }]]    = await db.query('SELECT COUNT(*) AS c FROM games');
    const [[{ c: activeGames }]]  = await db.query("SELECT COUNT(*) AS c FROM games WHERE status = 'active'");
    const [[{ t: totalPrize }]]   = await db.query("SELECT COALESCE(SUM(winner_prize),0) AS t FROM games WHERE status='finished'");
    const [[{ t: totalHouse }]]   = await db.query("SELECT COALESCE(SUM(house_cut),0) AS t FROM games WHERE status='finished'");
    const [[{ c: pendingDep }]]   = await db.query("SELECT COUNT(*) AS c FROM deposit_requests WHERE status='pending'");
    const [[{ c: pendingWdr }]]   = await db.query("SELECT COUNT(*) AS c FROM withdraw_requests WHERE status='pending'");
    const [[{ t: totalBalance }]] = await db.query('SELECT COALESCE(SUM(balance),0) AS t FROM users');

    res.json({
      ok: true,
      stats: {
        users:         userCount,
        games:         gameCount,
        active_games:  activeGames,
        total_prize:   totalPrize,
        total_house:   totalHouse,
        pending_dep:   pendingDep,
        pending_wdr:   pendingWdr,
        total_balance: totalBalance
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search ? `%${req.query.search}%` : null;

    let users;
    if (search) {
      [users] = await db.query(`
        SELECT id, phone, full_name, balance, games_played, games_won,
               total_won, total_spent, is_admin, is_banned, created_at
        FROM users WHERE phone LIKE ? OR full_name LIKE ?
        ORDER BY created_at DESC LIMIT ? OFFSET ?
      `, [search, search, limit, offset]);
    } else {
      [users] = await db.query(`
        SELECT id, phone, full_name, balance, games_played, games_won,
               total_won, total_spent, is_admin, is_banned, created_at
        FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?
      `, [limit, offset]);
    }
    res.json({ ok: true, users });
  } catch (err) {
    console.error('Users error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/admin/deposits/pending ──────────────────────────
router.get('/deposits/pending', async (req, res) => {
  try {
    const [reqs] = await db.query(`
      SELECT dr.*, u.phone, u.full_name, u.balance
      FROM deposit_requests dr
      JOIN users u ON u.id = dr.user_id
      WHERE dr.status = 'pending'
      ORDER BY dr.created_at ASC
    `);
    res.json({ ok: true, requests: reqs });
  } catch (err) {
    console.error('Deposits pending error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/admin/deposits/:id/approve ─────────────────────
router.post('/deposits/:id/approve', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[dep]] = await conn.query('SELECT * FROM deposit_requests WHERE id = ?', [req.params.id]);
    if (!dep) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ጥያቄ አልተገኘም' });
    }
    if (dep.status !== 'pending') {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ቀድሞ ተፈቅዷል' });
    }

    // Credit user balance
    await recordTx(conn, dep.user_id, 'deposit', dep.amount, 'ገቢ ተፈቅዷል', `DEP-${dep.id}`);

    // Mark as approved (reviewed_by = NULL since panel auth has no user id)
    await conn.query(
      "UPDATE deposit_requests SET status = 'approved', reviewed_by = NULL, reviewed_at = NOW() WHERE id = ?",
      [dep.id]
    );

    const [[user]] = await conn.query(
      'SELECT phone, full_name, balance, telegram_id FROM users WHERE id = ?', [dep.user_id]
    );

    await conn.commit();
    conn.release();

    if (user.telegram_id) {
      tg.notify(user.telegram_id,
        `✅ *ገቢ ተፈቅዷል!*\n\n💰 *${Number(dep.amount).toFixed(2)} ብር* ሂሳብዎ ላይ ተጨምሯል።\n💳 አዲስ ቀሪ ሂሳብ: *${Number(user.balance).toFixed(2)} ብር*`
      );
    }

    res.json({ ok: true, msg: `✅ ${dep.amount} ብር ለ ${user.full_name} ተሰጥቷል` });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Deposit approve error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/admin/deposits/:id/reject ──────────────────────
router.post('/deposits/:id/reject', async (req, res) => {
  try {
    const [[dep]] = await db.query('SELECT * FROM deposit_requests WHERE id = ?', [req.params.id]);
    if (!dep)                     return res.status(404).json({ ok: false, msg: 'ጥያቄ አልተገኘም' });
    if (dep.status !== 'pending') return res.status(400).json({ ok: false, msg: 'ቀድሞ ተፈቅዷል' });

    await db.query(
      "UPDATE deposit_requests SET status = 'rejected', reviewed_by = NULL, reviewed_at = NOW(), note = ? WHERE id = ?",
      [req.body.note || 'Admin rejected', dep.id]
    );
    res.json({ ok: true, msg: 'ጥያቄ ውድቅ ተደርጓል' });
  } catch (err) {
    console.error('Deposit reject error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/admin/withdrawals/pending ───────────────────────
router.get('/withdrawals/pending', async (req, res) => {
  try {
    const [reqs] = await db.query(`
      SELECT wr.*, u.phone, u.full_name, u.balance
      FROM withdraw_requests wr
      JOIN users u ON u.id = wr.user_id
      WHERE wr.status = 'pending'
      ORDER BY wr.created_at ASC
    `);
    res.json({ ok: true, requests: reqs });
  } catch (err) {
    console.error('Withdrawals pending error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/admin/withdrawals/:id/approve ──────────────────
router.post('/withdrawals/:id/approve', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[wr]] = await conn.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (!wr) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ጥያቄ አልተገኘም' });
    }
    if (wr.status !== 'pending') {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ቀድሞ ተፈቅዷል' });
    }

    // Balance was already held (deducted) when the request was submitted via withdraw_hold.
    // On approve we just confirm — no further deduction needed.
    await conn.query(
      "UPDATE withdraw_requests SET status = 'approved', reviewed_by = NULL, reviewed_at = NOW() WHERE id = ?",
      [wr.id]
    );

    const [[user]] = await conn.query(
      'SELECT phone, full_name, balance, telegram_id FROM users WHERE id = ?', [wr.user_id]
    );

    await conn.commit();
    conn.release();

    if (user && user.telegram_id) {
      tg.notify(user.telegram_id,
        `✅ *ማውጫ ተፈቅዷል!*\n\n💸 *${Number(wr.amount).toFixed(2)} ብር* ወደ ${wr.account_type} ${wr.account_number} ተልኳል።\n💳 ቀሪ ሂሳብ: *${Number(user.balance).toFixed(2)} ብር*`
      );
    }

    res.json({ ok: true, msg: `✅ ${wr.amount} ብር ለ ${user ? user.full_name : ''} ተፈቅዷል — ሂሳብ ቀድሞ ተቀንሷል` });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Withdrawal approve error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/admin/withdrawals/:id/reject ───────────────────
router.post('/withdrawals/:id/reject', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[wr]] = await conn.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (!wr) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ጥያቄ አልተገኘም' });
    }
    if (wr.status !== 'pending') {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ቀድሞ ተፈቅዷል' });
    }

    // Refund the held amount back to user
    await recordTx(conn, wr.user_id, 'refund', wr.amount, 'ማውጫ ውድቅ — ተመልሷል', `WDR-${wr.id}`);

    await conn.query(
      "UPDATE withdraw_requests SET status = 'rejected', reviewed_by = NULL, reviewed_at = NOW(), note = ? WHERE id = ?",
      [req.body.note || 'Admin rejected', wr.id]
    );

    const [[user]] = await conn.query('SELECT telegram_id FROM users WHERE id = ?', [wr.user_id]);

    await conn.commit();
    conn.release();

    if (user && user.telegram_id) {
      tg.notify(user.telegram_id,
        `↩️ *ማውጫ ጥያቄዎ ውድቅ ተደርጓል።*\n\n${Number(wr.amount).toFixed(2)} ብር ሂሳብዎ ላይ ተመልሷል።`
      );
    }

    res.json({ ok: true, msg: 'ጥያቄ ውድቅ ተደርጓል። ሂሳብ ተመልሷል።' });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Withdrawal reject error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/admin/users/:id/ban ────────────────────────────
router.post('/users/:id/ban', async (req, res) => {
  try {
    // Never allow banning an admin account
    const [[user]] = await db.query('SELECT is_admin FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ ok: false, msg: 'ተጠቃሚ አልተገኘም' });
    if (user.is_admin) return res.status(403).json({ ok: false, msg: 'አስተዳዳሪን ማገድ አይቻልም' });

    await db.query('UPDATE users SET is_banned = 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true, msg: 'ተጠቃሚ ታግዷል' });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/admin/users/:id/unban ──────────────────────────
router.post('/users/:id/unban', async (req, res) => {
  try {
    await db.query('UPDATE users SET is_banned = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true, msg: 'ተጠቃሚ ታግዶ ተፈቷል' });
  } catch (err) {
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/admin/users/:id/credit ─────────────────────────
router.post('/users/:id/credit', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ትክክለኛ መጠን ያስፈልጋል' });
    }

    const [[user]] = await conn.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!user) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ተጠቃሚ አልተገኘም' });
    }

    await recordTx(conn, user.id, 'deposit', amount, req.body.note || 'Admin manual credit', 'MANUAL');
    const [[updated]] = await conn.query('SELECT balance FROM users WHERE id = ?', [user.id]);

    await conn.commit();
    conn.release();
    res.json({ ok: true, msg: `${amount} ብር ለ ${user.full_name} ተጨምሯል`, new_balance: updated.balance });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Credit error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/admin/transactions ──────────────────────────────
// Returns all deposit & withdraw requests (all statuses) + totals
router.get('/transactions', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const type   = req.query.type || 'all'; // 'deposit' | 'withdraw' | 'all'

    // ── Deposits ──────────────────────────────────────────────
    let deposits = [], withdrawals = [];

    if (type === 'all' || type === 'deposit') {
      [deposits] = await db.query(`
        SELECT dr.id, dr.amount, dr.tx_id, dr.status, dr.created_at, dr.reviewed_at, dr.note,
               u.phone, u.full_name
        FROM deposit_requests dr
        JOIN users u ON u.id = dr.user_id
        ORDER BY dr.created_at DESC
        LIMIT ? OFFSET ?
      `, [limit, offset]);
    }

    if (type === 'all' || type === 'withdraw') {
      [withdrawals] = await db.query(`
        SELECT wr.id, wr.amount, wr.account_type, wr.account_number,
               wr.status, wr.created_at, wr.reviewed_at, wr.note,
               u.phone, u.full_name
        FROM withdraw_requests wr
        JOIN users u ON u.id = wr.user_id
        ORDER BY wr.created_at DESC
        LIMIT ? OFFSET ?
      `, [limit, offset]);
    }

    // ── Totals ────────────────────────────────────────────────
    const [[depTotals]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END), 0) AS approved,
        COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status='rejected' THEN amount ELSE 0 END), 0) AS rejected,
        COUNT(*) AS total_count
      FROM deposit_requests
    `);
    const [[wdrTotals]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='approved' THEN amount ELSE 0 END), 0) AS approved,
        COALESCE(SUM(CASE WHEN status='pending'  THEN amount ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status='rejected' THEN amount ELSE 0 END), 0) AS rejected,
        COUNT(*) AS total_count
      FROM withdraw_requests
    `);

    res.json({
      ok: true,
      deposits,
      withdrawals,
      totals: {
        deposit:  depTotals,
        withdraw: wdrTotals
      }
    });
  } catch (err) {
    console.error('Transactions error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/admin/games ──────────────────────────────────────
router.get('/games', async (req, res) => {
  try {
    const [games] = await db.query(`
      SELECT g.*,
        (SELECT COUNT(*) FROM game_cards WHERE game_id = g.id) AS card_count,
        u.phone AS winner_phone, u.full_name AS winner_name
      FROM games g
      LEFT JOIN users u ON u.id = g.winner_id
      ORDER BY g.created_at DESC LIMIT 50
    `);
    res.json({ ok: true, games });
  } catch (err) {
    console.error('Admin games error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

module.exports = router;
