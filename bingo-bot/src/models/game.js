// ============================================================
//  GAME MODEL + BINGO ENGINE
// ============================================================
const db   = require('../db/database');
const { v4: uuidv4 } = require('uuid');

// ── Bingo card generator ──────────────────────────────────────
const COL_RANGES = [[1,15],[16,30],[31,45],[46,60],[61,75]];

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
  grid[2][2] = 0; // FREE space
  return grid;
}

function checkBingo(grid, marked) {
  // Rows
  for (let r = 0; r < 5; r++)
    if ([0,1,2,3,4].every(c => marked[c][r])) return true;
  // Columns
  for (let c = 0; c < 5; c++)
    if ([0,1,2,3,4].every(r => marked[c][r])) return true;
  // Diagonals
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

// ── Game Model ────────────────────────────────────────────────
const Game = {
  generateCard,
  checkBingo,
  markCard,

  // ── Create room ───────────────────────────────────────────
  create(entryFee, maxPlayers, createdBy) {
    const roomCode = 'BNG-' + Math.random().toString(36).substr(2,6).toUpperCase();
    const houseCutPct = parseFloat(process.env.HOUSE_CUT_PERCENT || 10);
    db.prepare(`
      INSERT INTO games (room_code, entry_fee, max_players, house_cut, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomCode, entryFee, maxPlayers, houseCutPct, String(createdBy));
    return db.prepare('SELECT * FROM games WHERE room_code = ?').get(roomCode);
  },

  findById(id) {
    return db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  },

  findByRoomCode(code) {
    return db.prepare('SELECT * FROM games WHERE room_code = ?').get(code);
  },

  findActive() {
    return db.prepare("SELECT * FROM games WHERE status IN ('waiting','active') ORDER BY created_at DESC").all();
  },

  findWaiting() {
    return db.prepare("SELECT * FROM games WHERE status = 'waiting' ORDER BY created_at DESC").all();
  },

  // ── Player management ─────────────────────────────────────
  addPlayer(gameId, userId) {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    if (!game) throw new Error('ጨዋታ አልተገኘም');
    if (game.status !== 'waiting') throw new Error('ጨዋታ ቀድሞ ጀምሯል');

    const count = db.prepare('SELECT COUNT(*) as c FROM game_players WHERE game_id=?').get(gameId).c;
    if (count >= game.max_players) throw new Error('ቦታ አልቋል');

    const existing = db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, userId);
    if (existing) throw new Error('ቀድሞ ተመዝግበዋል');

    const card   = generateCard();
    const marked = Array.from({ length: 5 }, (_, col) =>
      Array(5).fill(false).map((_, row) => card[col][row] === 0) // FREE auto-marked
    );

    db.prepare(`
      INSERT INTO game_players (game_id, user_id, card, marked)
      VALUES (?, ?, ?, ?)
    `).run(gameId, userId, JSON.stringify(card), JSON.stringify(marked));

    // Update prize pool
    const houseCutPct = game.house_cut;
    const houseCut    = game.entry_fee * (houseCutPct / 100);
    const contribution = game.entry_fee - houseCut;
    db.prepare('UPDATE games SET prize_pool = prize_pool + ?, house_cut = house_cut + ? WHERE id=?')
      .run(contribution, houseCut, gameId);

    return card;
  },

  removePlayer(gameId, userId) {
    db.prepare('DELETE FROM game_players WHERE game_id=? AND user_id=?').run(gameId, userId);
  },

  getPlayers(gameId) {
    return db.prepare(`
      SELECT gp.*, u.telegram_id, u.full_name, u.username
      FROM game_players gp
      JOIN users u ON u.id = gp.user_id
      WHERE gp.game_id = ?
    `).all(gameId);
  },

  getPlayerCount(gameId) {
    return db.prepare('SELECT COUNT(*) as c FROM game_players WHERE game_id=?').get(gameId).c;
  },

  getPlayerCard(gameId, userId) {
    return db.prepare('SELECT * FROM game_players WHERE game_id=? AND user_id=?').get(gameId, userId);
  },

  // ── Game lifecycle ────────────────────────────────────────
  start(gameId) {
    db.prepare("UPDATE games SET status='active', started_at=datetime('now') WHERE id=?").run(gameId);
  },

  callNumber(gameId, number) {
    const game = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    const called = JSON.parse(game.called_numbers);
    called.push(number);
    db.prepare('UPDATE games SET called_numbers=?, total_numbers=? WHERE id=?')
      .run(JSON.stringify(called), called.length, gameId);

    // Auto-mark all player cards
    const players = db.prepare('SELECT * FROM game_players WHERE game_id=?').all(gameId);
    const winners = [];
    for (const p of players) {
      const grid   = JSON.parse(p.card);
      const marked = markCard(grid, JSON.parse(p.marked), number);
      const hasBingo = checkBingo(grid, marked);
      db.prepare('UPDATE game_players SET marked=?, has_bingo=? WHERE id=?')
        .run(JSON.stringify(marked), hasBingo ? 1 : 0, p.id);
      if (hasBingo && !p.has_bingo) winners.push(p);
    }
    return winners;
  },

  // Draw a random uncalled number
  drawNumber(gameId) {
    const game   = db.prepare('SELECT * FROM games WHERE id=?').get(gameId);
    const called = JSON.parse(game.called_numbers);
    const pool   = range(1, 75).filter(n => !called.includes(n));
    if (pool.length === 0) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  finish(gameId, winnerId, prize) {
    db.prepare(`
      UPDATE games SET status='finished', winner_id=?, winner_prize=?,
      finished_at=datetime('now') WHERE id=?
    `).run(winnerId || null, prize || null, gameId);
  },

  cancel(gameId) {
    db.prepare("UPDATE games SET status='cancelled', finished_at=datetime('now') WHERE id=?").run(gameId);
  },

  // ── Stats ─────────────────────────────────────────────────
  recentGames(limit = 20) {
    return db.prepare("SELECT * FROM games ORDER BY created_at DESC LIMIT ?").all(limit);
  },

  totalPrizePool() {
    return db.prepare("SELECT SUM(prize_pool) as total FROM games WHERE status='finished'").get().total || 0;
  },

  totalHouseCut() {
    return db.prepare("SELECT SUM(house_cut) as total FROM games WHERE status='finished'").get().total || 0;
  }
};

module.exports = Game;
