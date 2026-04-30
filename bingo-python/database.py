"""
DATABASE — SQLite with aiosqlite (async)
All tables created automatically on first run.
"""
import aiosqlite
import os
from dotenv import load_dotenv

load_dotenv()
DB_PATH = os.getenv("DB_PATH", "data/bingo.db")


async def get_db() -> aiosqlite.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    return db


async def init_db():
    """Create all tables (idempotent — safe to call every startup)."""
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys=ON")
        await db.executescript("""
-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  TEXT    UNIQUE NOT NULL,
    username     TEXT,
    full_name    TEXT    NOT NULL,
    balance      REAL    NOT NULL DEFAULT 0,
    total_won    REAL    NOT NULL DEFAULT 0,
    total_spent  REAL    NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    games_won    INTEGER NOT NULL DEFAULT 0,
    is_banned    INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Transactions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    type           TEXT    NOT NULL,
    amount         REAL    NOT NULL,
    balance_before REAL    NOT NULL,
    balance_after  REAL    NOT NULL,
    reference      TEXT,
    status         TEXT    NOT NULL DEFAULT 'completed',
    note           TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Games ────────────────────────────────────────────────────
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
    created_by     TEXT    NOT NULL,
    announce_chat  TEXT,
    started_at     TEXT,
    finished_at    TEXT,
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── Game Players ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_players (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id   INTEGER NOT NULL REFERENCES games(id),
    user_id   INTEGER NOT NULL REFERENCES users(id),
    card      TEXT    NOT NULL,
    marked    TEXT    NOT NULL,
    has_bingo INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(game_id, user_id)
);

-- ── Deposit Requests ─────────────────────────────────────────
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

-- ── Withdraw Requests ────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_users_tg      ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_tx_user       ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_games_status  ON games(status);
CREATE INDEX IF NOT EXISTS idx_gp_game       ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_dep_status    ON deposit_requests(status);
CREATE INDEX IF NOT EXISTS idx_wdr_status    ON withdraw_requests(status);
        """)
        await db.commit()
    print("✅ Database ready:", DB_PATH)
