/** 共享类型：站点行/文章行（Drizzle 推断）。不直接 import schema，避免 Next 打包时把 mysql/pg 依赖拉入 bundle。 */
import type { schema } from "../../db/client";

export type Site = typeof schema.sites.$inferSelect;
export type Article = typeof schema.articles.$inferSelect;
