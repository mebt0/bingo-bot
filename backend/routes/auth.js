// ============================================================
//  AUTH ROUTES
//  POST /api/auth/register
//  POST /api/auth/login
//  GET  /api/auth/me
// ============================================================
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');

// ── Helper: sign JWT ──────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, phone: user.phone, is_admin: user.is_admin },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── Helper: safe user object (no password) ────────────────────
function safeUser(u) {
  return {
    id:           u.id,
    phone:        u.phone,
    full_name:    u.full_name,
    balance:      u.balance,
    total_won:    u.total_won,
    total_spent:  u.total_spent,
    games_played: u.games_played,
    games_won:    u.games_won,
    is_admin:     u.is_admin === 1,
    created_at:   u.created_at
  };
}

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { phone, password, full_name } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ ok: false, msg: 'ስልክ ቁጥር እና የይለፍ ቃል ያስፈልጋሉ' });
    }
    if (String(password).length < 4) {
      return res.status(400).json({ ok: false, msg: 'የይለፍ ቃል ቢያንስ 4 ቁጥር መሆን አለበት' });
    }

    const [existing] = await db.query('SELECT id FROM users WHERE phone = ?', [String(phone)]);
    if (existing.length > 0) {
      return res.status(409).json({ ok: false, msg: 'ስልክ ቁጥሩ ቀድሞ ተመዝግቧል' });
    }

    const hash        = bcrypt.hashSync(String(password), 10);
    const adminPhones = (process.env.ADMIN_PHONES || '').split(',').map(s => s.trim());
    const isAdmin     = adminPhones.includes(String(phone)) ? 1 : 0;

    await db.query(
      'INSERT INTO users (phone, password_hash, full_name, is_admin) VALUES (?, ?, ?, ?)',
      [String(phone), hash, full_name || String(phone), isAdmin]
    );

    const [rows] = await db.query('SELECT * FROM users WHERE phone = ?', [String(phone)]);
    const user   = rows[0];
    const token  = signToken(user);

    res.status(201).json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    console.error('Register error:', err.message, '| code:', err.code);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ ok: false, msg: 'ስልክ ቁጥር እና የይለፍ ቃል ያስፈልጋሉ' });
    }

    const [rows] = await db.query('SELECT * FROM users WHERE phone = ?', [String(phone)]);
    const user   = rows[0];

    if (!user) {
      return res.status(401).json({ ok: false, msg: 'ስልክ ቁጥር ወይም የይለፍ ቃል ትክክል አይደለም' });
    }
    if (user.is_banned && !user.is_admin) {
      return res.status(403).json({ ok: false, msg: 'አካውንትዎ ታግዷል። ለድጋፍ ያነጋግሩ።' });
    }
    if (!bcrypt.compareSync(String(password), user.password_hash)) {
      return res.status(401).json({ ok: false, msg: 'ስልክ ቁጥር ወይም የይለፍ ቃል ትክክል አይደለም' });
    }

    const token = signToken(user);
    res.json({ ok: true, token, user: safeUser(user) });
  } catch (err) {
    console.error('Login error:', err.message, '| code:', err.code);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    res.json({ ok: true, user: safeUser(rows[0]) });
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

module.exports = router;
