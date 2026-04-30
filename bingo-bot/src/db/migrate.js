// ============================================================
//  MANUAL MIGRATION SCRIPT  —  node src/db/migrate.js
// ============================================================
const db = require('./database');
const runMigrations = require('./migrate-auto');

(async () => {
  await db.init();
  runMigrations();
  console.log('✅ Database migrated:', process.env.DB_PATH || './data/bingo.db');
  process.exit(0);
})();
