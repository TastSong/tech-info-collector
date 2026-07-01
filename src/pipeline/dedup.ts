/** 内容指纹：用于"文章是否更新"检测（阶段 2 暂仅入库，去重主键是 url）。 */
import { createHash } from "node:crypto";

export function contentHash(body: string): string {
  const norm = body.replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha1").update(norm).digest("hex").slice(0, 16);
}
