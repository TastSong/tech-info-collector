/** 宽松的中文日期解析：支持 2024-01-05 / 2024/1/5 / 2024年1月5日 / 带时分。 */
export function tryParseDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const m = input.match(
    /(\d{4})\D{0,2}(\d{1,2})\D{0,2}(\d{1,2})(?:\D{0,2}(\d{1,2}):(\d{2}))?/,
  );
  if (!m) return null;
  const [, Y, M, D, h, min] = m;
  const d = new Date(
    Number(Y),
    Number(M) - 1,
    Number(D),
    h ? Number(h) : 0,
    min ? Number(min) : 0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

const TZ_SHANGHAI = "Asia/Shanghai";

/**
 * Asia/Shanghai 时区「今天午夜」往前 daysAgo 天的 unix 时间戳（秒）。
 * daysAgo=0 → 今天 00:00；daysAgo=1 → 昨天 00:00。
 * 与资讯流日期桶（今天/昨天/本周）口径一致。
 */
export function shanghaiMidnightSecs(daysAgo = 0): number {
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: TZ_SHANGHAI,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(new Date()).split("/").map(Number);
  // (y,m,d) 00:00:00+08:00 对应的 UTC ms = Date.UTC(y,m-1,d) - 8h
  const shanghaiMidnightMs = Date.UTC(y, m - 1, d) - 8 * 3600 * 1000;
  return Math.floor((shanghaiMidnightMs - daysAgo * 86400 * 1000) / 1000);
}
