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
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`,
);

export const db = drizzle(sqlite, { schema });
export { schema };

// 模块首次加载时自动初始化管理员用户
initAdminUser(sqlite);
