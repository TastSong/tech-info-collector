import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";

// 合法的 cron 5 字段简单校验（仅预设值：分 时 日 月 星期各自为数字或 *）
function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  for (const f of fields) {
    if (f === "*") continue;
    const n = Number(f);
    if (isNaN(n)) return false;
  }

  const [min, hour, dom, month] = fields.map(Number);
  if (min < 0 || min > 59) return false;
  if (hour < 0 || hour > 23) return false;
  if (dom < 1 || dom > 31) return false;
  if (month < 1 || month > 12) return false;

  return true;
}

export async function GET() {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "cron_interval"))
    .get();

  return NextResponse.json({
    cron_interval: row?.value ?? "0 9 * * *",
  });
}

export async function PATCH(request: Request) {
  let body: { cron_interval?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.cron_interval || typeof body.cron_interval !== "string") {
    return NextResponse.json({ error: "需要 cron_interval 字段" }, { status: 400 });
  }

  if (!isValidCron(body.cron_interval)) {
    return NextResponse.json({
      error: `无效的 cron 表达式：${body.cron_interval}`,
    }, { status: 400 });
  }

  // upsert
  const existing = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "cron_interval"))
    .get();

  if (existing) {
    db.update(schema.settings)
      .set({ value: body.cron_interval })
      .where(eq(schema.settings.key, "cron_interval"))
      .run();
  } else {
    db.insert(schema.settings)
      .values({ key: "cron_interval", value: body.cron_interval })
      .run();
  }

  return NextResponse.json({
    cron_interval: body.cron_interval,
  });
}
