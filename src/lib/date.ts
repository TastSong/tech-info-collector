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
