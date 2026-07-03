const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(process.cwd(), 'data/collector.db');
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// 建表
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
    model TEXT NOT NULL, relevant INTEGER, summary TEXT, headline TEXT, key_points TEXT,
    tags TEXT, quality_score REAL, is_news INTEGER, news_score REAL, usable INTEGER, reason TEXT, tokens_used INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS run_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, site_id INTEGER NOT NULL REFERENCES sites(id),
    started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL DEFAULT 'running',
    fetched INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    updated INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0, message TEXT
  );
  CREATE TABLE IF NOT EXISTS crawl_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL, ended_at INTEGER,
    status TEXT NOT NULL DEFAULT 'running',
    site_count INTEGER NOT NULL DEFAULT 0,
    total_fetched INTEGER NOT NULL DEFAULT 0,
    total_updated INTEGER NOT NULL DEFAULT 0,
    total_skipped INTEGER NOT NULL DEFAULT 0,
    total_errors INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

// 向已有 run_logs 表添加 crawl_session_id 列（幂等）
try {
  db.exec(`ALTER TABLE run_logs ADD COLUMN crawl_session_id INTEGER REFERENCES crawl_sessions(id)`);
} catch (e) {
  // 列已存在时忽略
  if (!e.message.includes('duplicate column name')) {
    console.error('ALTER TABLE run_logs failed:', e.message);
  }
}

// 向已有 ai_reviews 表添加 is_news / news_score 列（幂等）
try {
  db.exec(`ALTER TABLE ai_reviews ADD COLUMN is_news INTEGER`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) {
    console.error('ALTER TABLE ai_reviews ADD is_news failed:', e.message);
  }
}
try {
  db.exec(`ALTER TABLE ai_reviews ADD COLUMN news_score REAL`);
} catch (e) {
  if (!e.message.includes('duplicate column name')) {
    console.error('ALTER TABLE ai_reviews ADD news_score failed:', e.message);
  }
}

// 幂等导入：仅当 sites 表为空时从 sites.json 导入
const count = db.prepare('SELECT COUNT(*) AS cnt FROM sites').get();
if (count.cnt === 0) {
  const allSites = JSON.parse(fs.readFileSync('sites.json', 'utf-8'));
  const insert = db.prepare(
    'INSERT INTO sites (name,category,subcategory,urls,render,list_selector,link_selector,item_selector,title_selector,body_selector,date_selector,ai_involvement,interval,enabled,scope) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const tx = db.transaction((sites) => {
    for (const s of sites) {
      insert.run(
        s.name, s.category ?? null, s.subcategory ?? null,
        JSON.stringify(s.urls),
        s.render ?? 'static',
        s.list_selector ?? null, s.link_selector ?? null,
        s.item_selector ?? null, s.title_selector ?? null,
        s.body_selector ?? null, s.date_selector ?? null,
        s.ai_involvement ?? 'extract_judge',
        s.interval ?? '0 */6 * * *',
        s.enabled ? 1 : 0,
        s.scope ?? null
      );
    }
  });
  tx(allSites.sites);
  const enabledCount = allSites.sites.filter((s) => s.enabled).length;
  console.log('Init complete: ' + allSites.sites.length + ' sites (' + enabledCount + ' enabled)');
} else {
  console.log('DB already has ' + count.cnt + ' sites, skip init');
}
db.close();
