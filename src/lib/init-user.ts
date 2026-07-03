import type Database from "better-sqlite3";
import { hashPassword } from "./password";

/**
 * 模块加载时调用：如果 .env 配置了管理员凭据且系统无用户，则自动创建。
 * 密码只在首次创建时写入数据库，之后修改 .env 不影响已存在的用户。
 */
export function initAdminUser(sqlite: Database.Database): void {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    // 未配置凭据 → 静默跳过，用户可自行通过 API 注册
    return;
  }

  const existing = sqlite.prepare("SELECT id FROM users LIMIT 1").get() as { id: number } | undefined;
  if (existing) return; // 已有用户，不再创建

  const hash = hashPassword(password);
  sqlite.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
  console.log(`[auth] 已自动创建管理员账户: ${username}`);
}
