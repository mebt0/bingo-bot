// ============================================================
//  DATABASE — MySQL via mysql2 (XAMPP)
//  Connection pool + table initialization
// ============================================================
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT || '3306'),
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'bingo',
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  multipleStatements: true
});

// ── Create all tables ─────────────────────────────────────────
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        phone         VARCHAR(20)  UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name     VARCHAR(100) NOT NULL DEFAULT '',
        telegram_id   VARCHAR(50)  DEFAULT NULL,
        balance       DOUBLE       NOT NULL DEFAULT 0,
        total_won     DOUBLE       NOT NULL DEFAULT 0,
        total_spent   DOUBLE       NOT NULL DEFAULT 0,
        games_played  INT          NOT NULL DEFAULT 0,
        games_won     INT          NOT NULL DEFAULT 0,
        is_admin      TINYINT(1)   NOT NULL DEFAULT 0,
        is_banned     TINYINT(1)   NOT NULL DEFAULT 0,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS transactions (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        user_id        INT    NOT NULL,
        type           VARCHAR(30) NOT NULL,
        amount         DOUBLE NOT NULL,
        balance_before DOUBLE NOT NULL,
        balance_after  DOUBLE NOT NULL,
        reference      VARCHAR(100) DEFAULT NULL,
        note           TEXT         DEFAULT NULL,
        created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS games (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        room_code      VARCHAR(20) UNIQUE NOT NULL,
        status         VARCHAR(20) NOT NULL DEFAULT 'waiting',
        entry_fee      DOUBLE      NOT NULL DEFAULT 10,
        max_players    INT         NOT NULL DEFAULT 100,
        prize_pool     DOUBLE      NOT NULL DEFAULT 0,
        house_cut      DOUBLE      NOT NULL DEFAULT 0,
        called_numbers TEXT        NOT NULL DEFAULT ('[]'),
        winner_id      INT         DEFAULT NULL,
        winner_card_id INT         DEFAULT NULL,
        winner_prize   DOUBLE      DEFAULT NULL,
        created_by     INT         DEFAULT NULL,
        started_at     DATETIME    DEFAULT NULL,
        finished_at    DATETIME    DEFAULT NULL,
        created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (winner_id)  REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS game_cards (
        id        INT AUTO_INCREMENT PRIMARY KEY,
        game_id   INT  NOT NULL,
        user_id   INT  NOT NULL,
        card_grid TEXT NOT NULL,
        marked    TEXT NOT NULL DEFAULT ('[[false,false,false,false,false],[false,false,false,false,false],[false,false,false,false,false],[false,false,false,false,false],[false,false,false,false,false]]'),
        has_bingo TINYINT(1) NOT NULL DEFAULT 0,
        joined_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (game_id) REFERENCES games(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS deposit_requests (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT         NOT NULL,
        amount      DOUBLE      NOT NULL,
        tx_id       VARCHAR(100) DEFAULT NULL,
        status      VARCHAR(20)  NOT NULL DEFAULT 'pending',
        note        TEXT         DEFAULT NULL,
        reviewed_by INT          DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME     DEFAULT NULL,
        FOREIGN KEY (user_id)     REFERENCES users(id),
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS withdraw_requests (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        user_id        INT         NOT NULL,
        amount         DOUBLE      NOT NULL,
        account_type   VARCHAR(30) NOT NULL DEFAULT 'telebirr',
        account_number VARCHAR(50) NOT NULL,
        status         VARCHAR(20) NOT NULL DEFAULT 'pending',
        note           TEXT        DEFAULT NULL,
        reviewed_by    INT         DEFAULT NULL,
        created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at    DATETIME    DEFAULT NULL,
        FOREIGN KEY (user_id)     REFERENCES users(id),
        FOREIGN KEY (reviewed_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('✅ MySQL database ready — database:', process.env.DB_NAME || 'bingo');
  } finally {
    conn.release();
  }
}

initDB().catch(err => {
  console.error('❌ Database init failed:', err.message);
  process.exit(1);
});

module.exports = pool;
