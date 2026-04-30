// ============================================================
//  DATABASE — sql.js wrapper (pure JS, no C++ build tools needed)
//
//  Exposes the same API as better-sqlite3:
//    db.prepare(sql).get(...args)   → first row | undefined
//    db.prepare(sql).all(...args)   → array of rows
//    db.prepare(sql).run(...args)   → { changes, lastInsertRowid }
//    db.exec(sql)                   → run multi-statement SQL
//    db.pragma(...)                 → no-op (not needed by sql.js)
//
//  Call  await db.init()  once at startup before using the db.
// ============================================================
require('dotenv').config();
const path = require('path');
const fs   = require('fs');

const dbPath = path.resolve(process.env.DB_PATH || './data/bingo.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

let _sqlDb = null;   // the raw sql.js Database instance
let _dirty = false;

// ── Persist to disk ───────────────────────────────────────────
function persist() {
  if (!_sqlDb) return;
  try {
    const data = _sqlDb.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    _dirty = false;
  } catch (e) {
    console.error('DB persist error:', e.message);
  }
}

// Auto-save every 3 s
setInterval(() => { if (_dirty) persist(); }, 3000);
process.on('exit',    persist);
process.on('SIGINT',  () => { persist(); process.exit(0); });
process.on('SIGTERM', () => { persist(); process.exit(0); });

// ── Public API ────────────────────────────────────────────────
const db = {
  // Call once at startup
  async init() {
    if (_sqlDb) return;                       // already initialised
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    if (fs.existsSync(dbPath)) {
      const buf = fs.readFileSync(dbPath);
      _sqlDb = new SQL.Database(buf);
    } else {
      _sqlDb = new SQL.Database();
    }
    console.log('✅ Database ready:', dbPath);
  },

  pragma() { /* no-op */ },

  exec(sql) {
    _sqlDb.run(sql);
    _dirty = true;
  },

  prepare(sql) {
    return {
      get(...args) {
        const stmt = _sqlDb.prepare(sql);
        stmt.bind(args);
        const row = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return row;
      },
      all(...args) {
        const stmt = _sqlDb.prepare(sql);
        stmt.bind(args);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      run(...args) {
        const stmt = _sqlDb.prepare(sql);
        stmt.bind(args);
        stmt.step();
        stmt.free();
        _dirty = true;
        const meta = _sqlDb.prepare('SELECT last_insert_rowid() as r').getAsObject();
        return { changes: 1, lastInsertRowid: meta ? meta.r : null };
      }
    };
  },

  // Expose raw instance for advanced use
  get raw() { return _sqlDb; }
};

module.exports = db;
