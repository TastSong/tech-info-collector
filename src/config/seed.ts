/**
 * 幂等种子脚本：清空全部表后从 data/sites.seed.json 重新导入 MVP 站点（含选择器）。
 * 用法：pnpm seed
 *
 * 注意：脚本由 tsx 运行，使用相对路径导入以避免路径别名问题；
 * Next 应用代码则统一用 "@/..." 别名。
 */
import { db } from "../../db/client";
import { sites } from "../../db/schema";
import { sql } from "drizzle-orm";
import seedData from "../../data/sites.seed.json";

type SeedSite = {
  name: string;
  category: string | null;
  subcategory: string | null;
  urls: string[];
  render: "static" | "dynamic";
  list_selector?: string | null;
  link_selector?: string | null;
  title_selector?: string | null;
  body_selector?: string | null;
  date_selector?: string | null;
  ai_involvement: "none" | "extract" | "extract_judge" | "full";
  interval: string | null;
  enabled: boolean;
  scope: string | null;
};

function main() {
  // MVP 阶段：完整重置（先删子表再删 sites，满足外键）
  db.run(sql`DELETE FROM ai_reviews`);
  db.run(sql`DELETE FROM run_logs`);
  db.run(sql`DELETE FROM articles`);
  db.run(sql`DELETE FROM sites`);

  const rows = (seedData.sites as SeedSite[]).map((s) => ({
    name: s.name,
    category: s.category,
    subcategory: s.subcategory,
    urls: s.urls,
    render: s.render,
    listSelector: s.list_selector ?? null,
    linkSelector: s.link_selector ?? null,
    titleSelector: s.title_selector ?? null,
    bodySelector: s.body_selector ?? null,
    dateSelector: s.date_selector ?? null,
    aiInvolvement: s.ai_involvement,
    interval: s.interval ?? null,
    enabled: s.enabled,
    scope: s.scope ?? null,
  }));

  db.insert(sites).values(rows).run();

  const all = db.select().from(sites).all();
  console.log(`✓ 已导入 ${all.length} 个站点：`);
  for (const s of all) {
    const flag = s.enabled ? "启用" : "禁用";
    const sel = s.listSelector ? s.listSelector : "（无选择器）";
    console.log(
      `  #${s.id} [${s.render}] ${flag} ${s.name} | list=${sel}`,
    );
  }
}

main();
