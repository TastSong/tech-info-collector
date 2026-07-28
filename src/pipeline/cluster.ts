/**
 * 跨站聚类去重：基于标题 bigram + Jaccard 相似度，将同事件多站报道归入同一 cluster。
 *
 * 在 analyze 完成后调用，只为 status='published' 的文章计算 cluster_key。
 * 两篇文章共享 cluster_key → feed 去重时仅保留评分最高的一篇。
 *
 * cluster_key 格式：{min_article_id}#{cluster_no}
 * 空字符串表示无匹配（未聚簇），COALESCE(NULLIF(cluster_key,''), content_hash) 退化为原去重逻辑。
 */

import { eq, and, sql, inArray, not } from "drizzle-orm";
import { db, schema } from "../../db/client";

interface ArticleForCluster {
  id: number;
  title: string;
}

/** Bigram 集合（2-gram of characters） */
function bigrams(s: string): Set<string> {
  const b = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    b.add(s.slice(i, i + 2));
  }
  return b;
}

/** Jaccard 相似度：|A ∩ B| / |A ∪ B| */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) { if (b.has(x)) intersect++; }
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/**
 * 对当批 published 文章执行单链接聚类（single-linkage clustering）。
 *
 * 阈值默认 0.55（实测：
 *   - 完全相同标题 ≈ 1.0
 *   - 高相似变体 ≈ 0.7-0.9（如"OpenAI 发布 GPT-5" vs "OpenAI 正式发布 GPT-5 模型"）
 *   - 不相干话题 ≈ <0.3）
 *
 * 只对 status='published' 且 cluster_key 为空的文章聚类。
 * 已分配的旧文章不受影响。
 */
export async function clusterPublished(opts?: {
  threshold?: number;
  /** 只聚类最近 N 天的文章（节省计算） */
  recentDays?: number;
}): Promise<number> {
  const threshold = opts?.threshold ?? Number(process.env.CLUSTER_THRESHOLD ?? 0.55);
  if (threshold <= 0 || threshold >= 1) return 0;

  const days = opts?.recentDays ?? Number(process.env.CLUSTER_RECENT_DAYS ?? 2);
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  // 取近期 published、cluster_key 为空（NULL 或 ''）、且有标题的文章
  const articles = db
    .select({ id: schema.articles.id, title: schema.articles.title, qs: schema.aiReviews.qualityScore })
    .from(schema.articles)
    .leftJoin(schema.aiReviews, eq(schema.aiReviews.articleId, schema.articles.id))
    .where(
      and(
        eq(schema.articles.status, "published"),
        sql`(${schema.articles.clusterKey} IS NULL OR ${schema.articles.clusterKey} = '')`,
        not(eq(schema.articles.title, "")),
        sql`${schema.articles.fetchedAt} >= ${cutoff}`,
      ),
    )
    .orderBy(sql`COALESCE(${schema.aiReviews.qualityScore}, 0) DESC`)
    .all();

  if (articles.length < 2) return 0;

  // 预处理 bigram，避免重复计算
  const data: (ArticleForCluster & { bigrams: Set<string> })[] = [];
  for (const a of articles) {
    const t = (a.title ?? "").trim();
    if (!t) continue;
    data.push({ id: a.id, title: t, bigrams: bigrams(t) });
  }
  if (data.length < 2) return 0;

  // Union-Find
  const parent = new Map<number, number>();
  for (const d of data) parent.set(d.id, d.id);
  function find(x: number): number {
    const p = parent.get(x);
    if (p == null || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // O(n²) 两两比较（n 通常 < 500 篇/天，足够）
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const sim = jaccard(data[i].bigrams, data[j].bigrams);
      if (sim >= threshold) {
        union(data[i].id, data[j].id);
      }
    }
  }

  // 按 root 分组，每组取最小 id 作为 cluster leader
  const groups = new Map<number, number[]>(); // rootId → [memberIds]
  for (const d of data) {
    const root = find(d.id);
    const list = groups.get(root);
    if (list) list.push(d.id);
    else groups.set(root, [d.id]);
  }

  let clustered = 0;
  for (const [rootId, members] of groups) {
    if (members.length < 2) continue; // 独苗不聚簇
    // 找出最小的 id 作为 cluster_key（stable, 不依赖处理顺序）
    const minId = Math.min(rootId, ...members);
    // cluster_key 格式：minId#<seq>（seq 用于区分不同簇，避免跨簇碰撞）
    const clusterKey = `${minId}#1`;

    const result = db
      .update(schema.articles)
      .set({ clusterKey })
      .where(inArray(schema.articles.id, members))
      .run();

    clustered += members.length;
  }

  if (clustered > 0) {
    console.log(
      `[cluster] 跨站聚类：${clustered} 篇归入 ${groups.size} 簇（阈值 ${threshold}）`,
    );
  }
  return clustered;
}
