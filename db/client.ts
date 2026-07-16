import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";
import { initAdminUser } from "@/src/lib/init-user";

const dbPath = path.resolve(process.cwd(), "data/collector.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

// 确保 users 表存在（drizzle-kit push 可能因为其他冲突跳过）
sqlite.exec(
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    auth_token TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
);

// 为存量数据库添加 role 列（CREATE TABLE IF NOT EXISTS 不会修改已有表）
try {
  sqlite.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user'))`);
} catch {
  // 列已存在，静默跳过
}

// 确保 contentHash 索引存在（用于去重和联动查询）
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_articles_content_hash ON articles(content_hash)`,
);

// 确保多用户表存在
sqlite.exec(
  `CREATE TABLE IF NOT EXISTS user_article_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    viewed_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
);
sqlite.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_article_view ON user_article_views(user_id, article_id)`,
);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_uav_user_time ON user_article_views(user_id, viewed_at)`,
);

sqlite.exec(
  `CREATE TABLE IF NOT EXISTS user_article_saves (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    saved_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
);
sqlite.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_article_save ON user_article_saves(user_id, article_id)`,
);

export const db = drizzle(sqlite, { schema });
export { schema };

// 模块首次加载时自动初始化管理员用户
initAdminUser(sqlite);
