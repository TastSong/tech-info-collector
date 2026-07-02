const Database = require('better-sqlite3');
const db = new Database('/app/data/collector.db');
// WAL 模式允许并发读写，避免 SQLITE_BUSY
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, category TEXT, subcategory TEXT,
    urls TEXT NOT NULL DEFAULT '[]', render TEXT NOT NULL DEFAULT 'static',
    list_selector TEXT, item_selector TEXT, link_selector TEXT, title_selector TEXT,
    body_selector TEXT, date_selector TEXT, interval TEXT DEFAULT '0 */6 * * *',
    ai_involvement TEXT NOT NULL DEFAULT 'extract_judge', scope TEXT,
    enabled INTEGER NOT NULL DEFAULT 1, last_run_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id),
    url TEXT NOT NULL UNIQUE, title TEXT, body TEXT, published_at INTEGER,
    content_hash TEXT, status TEXT NOT NULL DEFAULT 'raw', fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
    viewed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS ai_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL REFERENCES articles(id),
    model TEXT NOT NULL, relevant INTEGER, summary TEXT, key_points TEXT,
    tags TEXT, quality_score REAL, usable INTEGER, reason TEXT, tokens_used INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id),
    started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL DEFAULT 'running',
    fetched INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, message TEXT
  );
`);
db.close();
console.log('[build] SQLite schema ready (WAL)');
