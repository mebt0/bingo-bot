// ============================================================
//  AUTH MIDDLEWARE — MySQL version
// ============================================================
const jwt = require('jsonwebtoken');
const db  = require('../db');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ ok: false, msg: 'ያልተፈቀደ — ይግቡ' });
  }

  try {
    const payload  = jwt.verify(token, process.env.JWT_SECRET);
    const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [payload.id]);
    if (!user)          return res.status(401).json({ ok: false, msg: 'ተጠቃሚ አልተገኘም' });
    if (user.is_banned && !user.is_admin) return res.status(403).json({ ok: false, msg: 'አካውንትዎ ታግዷል' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, msg: 'ቶከን ልክ አይደለም' });
  }
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (!req.user.is_admin) {
      return res.status(403).json({ ok: false, msg: 'የአስተዳዳሪ ፈቃድ ያስፈልጋል' });
    }
    next();
  });
}

module.exports = { requireAuth, requireAdmin };
