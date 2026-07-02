/**
 * 将 DB 中选择器数据同步回 sites.json，使其成为唯一数据源。
 * pnpm tsx src/config/sync-selectors-to-json.ts
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { db, schema } from "../../db/client";

function main() {
  const dbSites = db.select().from(schema.sites).all();

  // 以 name 为 key 建立 DB 索引
  const dbMap = new Map(dbSites.map((s) => [s.name, s]));

  // 读取原始 sites.json
  const filePath = path.resolve("sites.json");
  const allSites = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  let updated = 0;
  let added = 0;

  // 更新已有站点的选择器
  for (const site of allSites.sites) {
    const dbSite = dbMap.get(site.name);
    if (!dbSite) continue;

    if (dbSite.listSelector) site.list_selector = dbSite.listSelector;
    if (dbSite.linkSelector) site.link_selector = dbSite.linkSelector;
    if (dbSite.itemSelector) site.item_selector = dbSite.itemSelector;
    if (dbSite.titleSelector) site.title_selector = dbSite.titleSelector;
    if (dbSite.bodySelector) site.body_selector = dbSite.bodySelector;
    if (dbSite.dateSelector) site.date_selector = dbSite.dateSelector;
    site.render = dbSite.render ?? "static";
    site.enabled = dbSite.enabled ?? false;
    site.ai_involvement = dbSite.aiInvolvement ?? "extract_judge";
    site.interval = dbSite.interval ?? "0 */6 * * *";
    if (dbSite.scope) site.scope = dbSite.scope;
    updated++;
  }

  // 追加 DB 中有但 sites.json 中没有的站点
  const jsonNames = new Set(allSites.sites.map((s: any) => s.name));
  for (const dbSite of dbSites) {
    if (!jsonNames.has(dbSite.name)) {
      allSites.sites.push({
        name: dbSite.name,
        category: dbSite.category ?? null,
        subcategory: dbSite.subcategory ?? null,
        urls: dbSite.urls as string[],
        render: dbSite.render ?? "static",
        list_selector: dbSite.listSelector ?? null,
        link_selector: dbSite.linkSelector ?? null,
        item_selector: dbSite.itemSelector ?? null,
        title_selector: dbSite.titleSelector ?? null,
        body_selector: dbSite.bodySelector ?? null,
        date_selector: dbSite.dateSelector ?? null,
        ai_involvement: dbSite.aiInvolvement ?? "extract_judge",
        interval: dbSite.interval ?? "0 */6 * * *",
        enabled: dbSite.enabled ?? false,
        scope: dbSite.scope ?? null,
      });
      added++;
    }
  }

  allSites.total = allSites.sites.length;

  // 写回
  fs.writeFileSync(filePath, JSON.stringify(allSites, null, 2) + "\n", "utf-8");
  console.log("Done: updated " + updated + " sites with selectors, added " + added + " new sites");
  console.log("sites.json now has " + allSites.sites.length + " sites total");
}

main();
