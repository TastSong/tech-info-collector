/**
 * 多用户数据迁移脚本。
 *
 * 将存量的全局已读/收藏数据迁移到新的用户隔离表中。
 * 执行前建议备份 data/collector.db。
 *
 * 使用方式:
 *   tsx scripts/migrate-to-multi-user.ts
 */

import Database from "better-sqlite3";
import path from "node:path";

const dbPath = path.resolve(process.cwd(), "data/collector.db");
const db = new Database(dbPath);

console.log("[migrate] 开始多用户数据迁移...");

// 1) 确保现有用户都是 admin（首次部署仅有管理员账户）
const users = db.prepare("SELECT id, username, role FROM users WHERE role = 'user'").all() as { id: number; username: string }[];
if (users.length > 0) {
  console.log(`[migrate] 发现 ${users.length} 个非 admin 用户，将其升级为 admin:`);
  for (const u of users) {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
    console.log(`  - ${u.username} (id=${u.id}) → admin`);
  }
}

// 2) 获取 admin 用户 id（数据迁移的目标用户）
const adminUser = db.prepare("SELECT id, username FROM users WHERE role = 'admin' LIMIT 1").get() as { id: number; username: string } | undefined;
if (!adminUser) {
  console.log("[migrate] 无管理员用户，跳过数据迁移");
  process.exit(0);
}
console.log(`[migrate] 迁移目标用户: ${adminUser.username} (id=${adminUser.id})`);

// 3) 迁移已读记录 (articles.viewed_at → user_article_views)
const viewedArticles = db
  .prepare("SELECT id FROM articles WHERE viewed_at IS NOT NULL")
  .all() as { id: number }[];
console.log(`[migrate] 迁移已读记录: ${viewedArticles.length} 篇`);

const insertView = db.prepare(
  "INSERT OR IGNORE INTO user_article_views (user_id, article_id, viewed_at) VALUES (?, ?, unixepoch())",
);
for (const a of viewedArticles) {
  insertView.run(adminUser.id, a.id);
}

// 4) 迁移收藏记录 (articles.saved_at → user_article_saves)
const savedArticles = db
  .prepare("SELECT id FROM articles WHERE saved_at IS NOT NULL")
  .all() as { id: number }[];
console.log(`[migrate] 迁移收藏记录: ${savedArticles.length} 篇`);

const insertSave = db.prepare(
  "INSERT OR IGNORE INTO user_article_saves (user_id, article_id, saved_at) VALUES (?, ?, unixepoch())",
);
for (const a of savedArticles) {
  insertSave.run(adminUser.id, a.id);
}

// 5) 验证
const viewCount = (db.prepare("SELECT COUNT(*) AS cnt FROM user_article_views").get() as { cnt: number }).cnt;
const saveCount = (db.prepare("SELECT COUNT(*) AS cnt FROM user_article_saves").get() as { cnt: number }).cnt;
console.log(`[migrate] 完成！user_article_views: ${viewCount} 条, user_article_saves: ${saveCount} 条`);
console.log("[migrate] 原有的 articles.viewed_at 和 articles.saved_at 列已保留（不再写入）");

db.close();
