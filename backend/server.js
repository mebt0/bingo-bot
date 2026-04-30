// ============================================================
//  BINGO BACKEND SERVER
//  Express + SQLite REST API
//
//  Base URL: http://localhost:3001/api
//
//  Routes:
//    /api/auth/*     — register, login, me
//    /api/wallet/*   — balance, history, deposit, withdraw
//    /api/game/*     — rooms, cards, start, call, bingo
//    /api/admin/*    — admin panel (requires admin token)
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express     = require('express');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: function(origin, callback) {
    // Allow all origins — localhost, file://, ngrok, LAN IPs
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Panel', 'ngrok-skip-browser-warning']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Bypass ngrok browser warning page
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Rate limiting — 100 requests per minute per IP
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max:      100,
  message:  { ok: false, msg: 'ብዙ ጥያቄዎች። ትንሽ ቆይተው ይሞክሩ።' }
}));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/game',   require('./routes/game'));
app.use('/api/admin',  require('./routes/admin'));

// ── Serve frontend files (index.html, game.js, etc.) ─────────
// This eliminates file:// CORS issues — open http://localhost:3001
const path = require('path');
app.use(express.static(path.join(__dirname, '..')));

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, msg: '🎯 Bingo Backend is running', time: new Date().toISOString() });
});

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ ok: false, msg: 'Route not found' });
});

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Server error on', req.method, req.path);
  console.error('   Message:', err.message);
  console.error('   Code:', err.code);
  if (process.env.NODE_ENV !== 'production') {
    console.error('   Stack:', err.stack);
  }
  res.status(500).json({ ok: false, msg: err.message || 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  const os      = require('os');
  const nets    = os.networkInterfaces();
  let   lanIP   = 'unknown';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) { lanIP = net.address; break; }
    }
  }
  console.log(`🎯 Bingo Backend running`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${lanIP}:${PORT}`);
  console.log(`   Game:    http://localhost:${PORT}/index.html`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
});
