/**
 * 从原 sites.json 导入其余 93 个站点（已禁用 / 无选择器）。
 * 由 pnpm seed-remaining 触发，与主种子（10 个 MVP 站点）互补。
 */
import { db } from "../../db/client";
import { sites } from "../../db/schema";
import allSites from "../../sites.json";

// 主种子已导入的 10 个 MVP 站点名（用于去重）
const DONE = new Set([
  "科学技术部",
  "青岛市科技局",
  "青岛高新区——高新动态",
  "青岛能源所官网",
  "科技日报",
  "新浪科技",
  "36氪",
  "IT之家",
  "量子位",
  "机器之心",
]);

function main() {
  // 先用条件避免 repeat（Drizzle SQLite 无 INSERT OR IGNORE 条件模式，先查已有）
  const existing = new Set(db.select({ name: sites.name }).from(sites).all().map((s) => s.name));
  const toInsert = allSites.sites.filter((s) => !existing.has(s.name));

  if (!toInsert.length) {
    console.log("所有站点均已入库。");
    return;
  }

  const rows = toInsert.map((s) => ({
    name: s.name,
    category: s.category ?? null,
    subcategory: s.subcategory ?? null,
    urls: s.urls,
    render: "static" as const,
    aiInvolvement: "extract_judge" as const,
    enabled: false,
    scope: null,
  }));

  db.insert(sites).values(rows).run();
  console.log(`✓ 已追加 ${rows.length} 个站点（全部 disabled）`);
}

main();
