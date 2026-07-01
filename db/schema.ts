import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/** 采集站点配置：现有 sites.json 扩展而来 */
export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category"),
  subcategory: text("subcategory"),
  urls: text("urls", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default([]),
  render: text("render", { enum: ["static", "dynamic"] })
    .notNull()
    .default("static"),
  // 列表/详情页 CSS 选择器（阶段 2 填充）
  listSelector: text("list_selector"),
  itemSelector: text("item_selector"),
  linkSelector: text("link_selector"),
  titleSelector: text("title_selector"),
  bodySelector: text("body_selector"),
  dateSelector: text("date_selector"),
  // 调度与 AI 参与度
  interval: text("interval").default("0 */6 * * *"),
  aiInvolvement: text("ai_involvement", {
    enum: ["none", "extract", "extract_judge", "full"],
  })
    .notNull()
    .default("extract_judge"),
  /** 该站点关注什么内容（作为 AI 沙盒的 scope 输入） */
  scope: text("scope"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
});

/** 采集到的文章 */
export const articles = sqliteTable("articles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id),
  url: text("url").notNull().unique(),
  title: text("title"),
  body: text("body"),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  contentHash: text("content_hash"),
  status: text("status", {
    enum: ["raw", "analyzing", "ready", "rejected", "review", "published"],
  })
    .notNull()
    .default("raw"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** AI 沙盒对单篇文章的审核结果（审计留痕） */
export const aiReviews = sqliteTable("ai_reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  articleId: integer("article_id")
    .notNull()
    .references(() => articles.id),
  model: text("model").notNull(),
  relevant: integer("relevant", { mode: "boolean" }),
  summary: text("summary"),
  keyPoints: text("key_points", { mode: "json" }).$type<string[]>(),
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  qualityScore: real("quality_score"),
  usable: integer("usable", { mode: "boolean" }),
  reason: text("reason"),
  tokensUsed: integer("tokens_used"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** 单次采集运行日志 */
export const runLogs = sqliteTable("run_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id")
    .notNull()
    .references(() => sites.id),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp" }),
  status: text("status", {
    enum: ["running", "success", "error", "partial"],
  })
    .notNull()
    .default("running"),
  fetched: integer("fetched").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  message: text("message"),
});
