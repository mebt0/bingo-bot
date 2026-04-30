// ============================================================
//  GAME ROUTES
//  GET  /api/game/rooms          — list open rooms
//  POST /api/game/cards/select   — select cards & pay entry fee
//  POST /api/game/start          — admin starts game
//  POST /api/game/call           — admin calls next number
//  POST /api/game/bingo          — declare bingo
//  GET  /api/game/:id            — get game state
//  GET  /api/game/:id/mycard     — get my cards in a game
//  POST /api/game/create         — admin creates room
// ============================================================
const router = require('express').Router();
const db     = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { recordTx } = require('./wallet');
const tg           = require('../telegram');

const ENTRY_FEE     = () => parseFloat(process.env.ENTRY_FEE || 10);
const HOUSE_CUT_PCT = () => parseFloat(process.env.HOUSE_CUT_PERCENT || 20) / 100;
const COL_RANGES    = [[1,15],[16,30],[31,45],[46,60],[61,75]];

// ── Card generator ────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function range(min, max) {
  const r = [];
  for (let i = min; i <= max; i++) r.push(i);
  return r;
}
function generateCard() {
  const grid = [];
  for (let col = 0; col < 5; col++) {
    const [mn, mx] = COL_RANGES[col];
    grid.push(shuffle(range(mn, mx)).slice(0, 5));
  }
  grid[2][2] = 'FREE';
  return grid;
}

// ── Bingo checker ─────────────────────────────────────────────
function checkBingo(grid, marked) {
  for (let r = 0; r < 5; r++)
    if ([0,1,2,3,4].every(c => marked[c][r])) return true;
  for (let c = 0; c < 5; c++)
    if ([0,1,2,3,4].every(r => marked[c][r])) return true;
  if ([0,1,2,3,4].every(i => marked[i][i]))   return true;
  if ([0,1,2,3,4].every(i => marked[i][4-i])) return true;
  return false;
}

function markCard(grid, marked, number) {
  const m = marked.map(col => [...col]);
  for (let col = 0; col < 5; col++)
    for (let row = 0; row < 5; row++)
      if (grid[col][row] === number) m[col][row] = true;
  return m;
}

// ── GET /api/game/rooms ───────────────────────────────────────
router.get('/rooms', requireAuth, async (req, res) => {
  try {
    const [rooms] = await db.query(`
      SELECT g.*,
        (SELECT COUNT(*) FROM game_cards WHERE game_id = g.id) AS player_count
      FROM games g
      WHERE g.status IN ('waiting', 'active')
      ORDER BY g.created_at DESC
    `);
    res.json({ ok: true, rooms });
  } catch (err) {
    console.error('Rooms error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/game/:id ─────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const [[game]] = await db.query('SELECT * FROM games WHERE id = ?', [req.params.id]);
    if (!game) return res.status(404).json({ ok: false, msg: 'ጨዋታ አልተገኘም' });

    const [[{ c: playerCount }]] = await db.query(
      'SELECT COUNT(*) AS c FROM game_cards WHERE game_id = ?', [game.id]
    );
    res.json({ ok: true, game: { ...game, player_count: playerCount } });
  } catch (err) {
    console.error('Game get error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── GET /api/game/:id/mycard ──────────────────────────────────
router.get('/:id/mycard', requireAuth, async (req, res) => {
  try {
    const [cards] = await db.query(
      'SELECT * FROM game_cards WHERE game_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!cards.length) return res.status(404).json({ ok: false, msg: 'ካርድ አልተገኘም' });

    const [[game]] = await db.query('SELECT called_numbers FROM games WHERE id = ?', [req.params.id]);
    res.json({
      ok:             true,
      cards:          cards.map(c => ({
        id:        c.id,
        grid:      JSON.parse(c.card_grid),
        marked:    JSON.parse(c.marked),
        has_bingo: c.has_bingo === 1
      })),
      called_numbers: JSON.parse(game.called_numbers)
    });
  } catch (err) {
    console.error('Mycard error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/game/cards/select ───────────────────────────────
router.post('/cards/select', requireAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id, card_count } = req.body;
    const count = parseInt(card_count) || 1;

    if (count < 1 || count > 10) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: '1–10 ካርድ ብቻ መምረጥ ይቻላል' });
    }

    const [[game]] = await conn.query('SELECT * FROM games WHERE id = ?', [game_id]);
    if (!game) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ጨዋታ አልተገኘም' });
    }
    if (game.status !== 'waiting') {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ጨዋታ ቀድሞ ጀምሯል' });
    }

    const totalFee = ENTRY_FEE() * count;
    const [[user]] = await conn.query('SELECT balance FROM users WHERE id = ?', [req.user.id]);

    if (user.balance < totalFee) {
      await conn.rollback(); conn.release();
      return res.status(400).json({
        ok:  false,
        msg: `ቀሪ ሂሳብ ${user.balance.toFixed(2)} ብር ነው። ${totalFee.toFixed(2)} ብር ያስፈልጋል`
      });
    }

    // Deduct entry fee
    await recordTx(conn, req.user.id, 'entry_fee', totalFee, `${count} ካርድ ክፍያ — GAME-${game_id}`, `GAME-${game_id}`);

    // Update stats
    await conn.query(
      'UPDATE users SET games_played = games_played + 1, updated_at = NOW() WHERE id = ?',
      [req.user.id]
    );

    const houseCut   = totalFee * HOUSE_CUT_PCT();
    const prizeShare = totalFee - houseCut;
    const cards      = [];

    for (let i = 0; i < count; i++) {
      const grid   = generateCard();
      const marked = Array.from({ length: 5 }, (_, col) =>
        Array(5).fill(false).map((_, row) => grid[col][row] === 'FREE')
      );
      const [result] = await conn.query(
        'INSERT INTO game_cards (game_id, user_id, card_grid, marked) VALUES (?, ?, ?, ?)',
        [game_id, req.user.id, JSON.stringify(grid), JSON.stringify(marked)]
      );
      cards.push({ id: result.insertId, grid, marked });
    }

    // Update prize pool
    await conn.query(
      'UPDATE games SET prize_pool = prize_pool + ?, house_cut = house_cut + ? WHERE id = ?',
      [prizeShare, houseCut, game_id]
    );

    const [[updatedGame]] = await conn.query('SELECT prize_pool FROM games WHERE id = ?', [game_id]);

    await conn.commit();
    conn.release();

    res.status(201).json({
      ok:         true,
      msg:        `${count} ካርድ ተመርጧል! ${totalFee.toFixed(2)} ብር ተቀንሷል።`,
      cards,
      prize_pool: updatedGame.prize_pool,
      fee_paid:   totalFee
    });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Cards select error:', err);
    res.status(400).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/game/start  (admin only) ────────────────────────
router.post('/start', requireAdmin, async (req, res) => {
  try {
    const { game_id } = req.body;
    const [[game]] = await db.query('SELECT * FROM games WHERE id = ?', [game_id]);
    if (!game)                     return res.status(404).json({ ok: false, msg: 'ጨዋታ አልተገኘም' });
    if (game.status !== 'waiting') return res.status(400).json({ ok: false, msg: 'ጨዋታ ቀድሞ ጀምሯል' });

    const [[{ c }]] = await db.query('SELECT COUNT(*) AS c FROM game_cards WHERE game_id = ?', [game_id]);
    if (c < 1) return res.status(400).json({ ok: false, msg: 'ቢያንስ አንድ ካርድ ያስፈልጋል' });

    await db.query("UPDATE games SET status = 'active', started_at = NOW() WHERE id = ?", [game_id]);
    res.json({ ok: true, msg: 'ጨዋታ ጀምሯል!', game_id });
  } catch (err) {
    console.error('Start error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/game/call  (admin only) ─────────────────────────
router.post('/call', requireAdmin, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id } = req.body;
    const [[game]] = await conn.query('SELECT * FROM games WHERE id = ?', [game_id]);
    if (!game) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ጨዋታ አልተገኘም' });
    }
    if (game.status !== 'active') {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ጨዋታ ንቁ አይደለም' });
    }

    const called = JSON.parse(game.called_numbers);
    const pool   = range(1, 75).filter(n => !called.includes(n));

    if (pool.length === 0) {
      await conn.query("UPDATE games SET status = 'finished', finished_at = NOW() WHERE id = ?", [game_id]);
      await conn.commit(); conn.release();
      return res.json({ ok: true, msg: 'ሁሉም ቁጥሮች ተጠርተዋል', number: null, called, game_over: true });
    }

    const number = pool[Math.floor(Math.random() * pool.length)];
    called.push(number);
    await conn.query('UPDATE games SET called_numbers = ? WHERE id = ?', [JSON.stringify(called), game_id]);

    // Auto-mark all cards
    const [cards]   = await conn.query('SELECT * FROM game_cards WHERE game_id = ?', [game_id]);
    const winners   = [];

    for (const card of cards) {
      const grid   = JSON.parse(card.card_grid);
      const marked = markCard(grid, JSON.parse(card.marked), number);
      const bingo  = checkBingo(grid, marked);
      await conn.query(
        'UPDATE game_cards SET marked = ?, has_bingo = ? WHERE id = ?',
        [JSON.stringify(marked), bingo ? 1 : 0, card.id]
      );
      if (bingo && !card.has_bingo) winners.push(card);
    }

    await conn.commit();
    conn.release();
    res.json({ ok: true, number, called, winners: winners.map(w => w.id) });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Call error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/game/bingo ──────────────────────────────────────
router.post('/bingo', requireAuth, async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { game_id, card_id } = req.body;

    const [[game]] = await conn.query('SELECT * FROM games WHERE id = ?', [game_id]);
    if (!game) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ጨዋታ አልተገኘም' });
    }
    if (game.status !== 'active') {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ጨዋታ ንቁ አይደለም' });
    }

    const [[card]] = await conn.query(
      'SELECT * FROM game_cards WHERE id = ? AND game_id = ?', [card_id, game_id]
    );
    if (!card) {
      await conn.rollback(); conn.release();
      return res.status(404).json({ ok: false, msg: 'ካርድ አልተገኘም' });
    }

    const grid   = JSON.parse(card.card_grid);
    const marked = JSON.parse(card.marked);

    if (!checkBingo(grid, marked)) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ ok: false, msg: 'ቢንጎ አልሆነም። ቀጥሉ!' });
    }

    // Pay prize
    const prize = game.prize_pool;
    await recordTx(conn, card.user_id, 'prize', prize, `ቢንጎ ሽልማት — GAME-${game_id}`, `GAME-${game_id}`);

    // Update winner stats
    await conn.query(
      'UPDATE users SET games_won = games_won + 1, total_won = total_won + ?, updated_at = NOW() WHERE id = ?',
      [prize, card.user_id]
    );

    // Finish game
    await conn.query(
      "UPDATE games SET status = 'finished', winner_id = ?, winner_card_id = ?, winner_prize = ?, finished_at = NOW() WHERE id = ?",
      [card.user_id, card.id, prize, game_id]
    );

    const [[winner]] = await conn.query(
      'SELECT id, phone, full_name, balance, telegram_id FROM users WHERE id = ?', [card.user_id]
    );

    await conn.commit();
    conn.release();

    // Notify winner via Telegram
    if (winner.telegram_id) {
      tg.notify(winner.telegram_id,
        `🏆 *እንኳን ደስ አለዎ! ቢንጎ አሸነፉ!*\n\n💰 ሽልማት: *${prize.toFixed(2)} ብር* ሂሳብዎ ላይ ተጨምሯል!\n💳 አዲስ ቀሪ ሂሳብ: *${winner.balance.toFixed(2)} ብር*`
      );
    }

    res.json({ ok: true, msg: 'ቢንጎ! 🏆', prize, winner, card_id: card.id });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Bingo error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

// ── POST /api/game/create  (admin only) ───────────────────────
router.post('/create', requireAdmin, async (req, res) => {
  try {
    const { entry_fee, max_players } = req.body;
    const fee  = parseFloat(entry_fee) || ENTRY_FEE();
    const max  = parseInt(max_players) || 100;
    const code = 'BNG-' + Math.random().toString(36).substr(2, 6).toUpperCase();

    const [result] = await db.query(
      'INSERT INTO games (room_code, entry_fee, max_players, created_by) VALUES (?, ?, ?, ?)',
      [code, fee, max, req.user.id]
    );
    const [[game]] = await db.query('SELECT * FROM games WHERE id = ?', [result.insertId]);
    res.status(201).json({ ok: true, game });
  } catch (err) {
    console.error('Create game error:', err);
    res.status(500).json({ ok: false, msg: err.message || 'Server error' });
  }
});

module.exports = router;
