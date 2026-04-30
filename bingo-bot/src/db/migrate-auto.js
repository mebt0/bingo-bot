// ============================================================
//  AUTO MIGRATION — runs on every bot startup (safe, idempotent)
//  Called after db.init() in index.js
// ============================================================
const db = require('./database');

function runMigrations() {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id   TEXT    UNIQUE NOT NULL,
  username      TEXT,
  full_name     TEXT    NOT NULL,
  balance       REAL    NOT NULL DEFAULT 0,
  total_won     REAL    NOT NULL DEFAULT 0,
  total_spent   REAL    NOT NULL DEFAULT 0,
  games_played  INTEGER NOT NULL DEFAULT 0,
  games_won     INTEGER NOT NULL DEFAULT 0,
  is_banned     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  type           TEXT    NOT NULL,
  amount         REAL    NOT NULL,
  balance_before REAL    NOT NULL,
  balance_after  REAL    NOT NULL,
  reference      TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending',
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_by    TEXT,
  approved_at    TEXT
);

CREATE TABLE IF NOT EXISTS games (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code      TEXT    UNIQUE NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'waiting',
  entry_fee      REAL    NOT NULL,
  max_players    INTEGER NOT NULL DEFAULT 50,
  prize_pool     REAL    NOT NULL DEFAULT 0,
  house_cut      REAL    NOT NULL DEFAULT 0,
  winner_id      INTEGER REFERENCES users(id),
  winner_prize   REAL,
  called_numbers TEXT    NOT NULL DEFAULT '[]',
  total_numbers  INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT    NOT NULL,
  started_at     TEXT,
  finished_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_players (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id   INTEGER NOT NULL REFERENCES games(id),
  user_id   INTEGER NOT NULL REFERENCES users(id),
  card      TEXT    NOT NULL,
  marked    TEXT    NOT NULL DEFAULT '[[false,false,false,false,false],[false,false,false,false,false],[false,false,false,false,false],[false,false,false,false,false],[false,false,false,false,false]]',
  has_bingo INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(game_id, user_id)
);

CREATE TABLE IF NOT EXISTS deposit_requests (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id),
  amount             REAL    NOT NULL,
  screenshot_file_id TEXT,
  status             TEXT    NOT NULL DEFAULT 'pending',
  note               TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_by        TEXT,
  reviewed_at        TEXT
);

CREATE TABLE IF NOT EXISTS withdraw_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  amount         REAL    NOT NULL,
  account_type   TEXT    NOT NULL,
  account_number TEXT    NOT NULL,
  account_name   TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'pending',
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  reviewed_by    TEXT,
  reviewed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_telegram   ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_tx_user          ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_games_status     ON games(status);
CREATE INDEX IF NOT EXISTS idx_gp_game          ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_gp_user          ON game_players(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_status   ON deposit_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdraw_status  ON withdraw_requests(status);
  `);
  console.log('✅ Migrations applied');
}

module.exports = runMigrations;
