/**
 * DELETE /api/admin/users/[id] — 删除用户（仅管理员）。
 *
 * 不能删除自己。关联的已读/收藏记录由外键 CASCADE 自动清理。
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { requireAdmin } from "@/src/lib/auth";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const currentUser = await requireAdmin();
  if (currentUser instanceof NextResponse) return currentUser;

  const targetId = Number((await params).id);

  // 不能删除自己
  if (targetId === currentUser.id) {
    return NextResponse.json({ error: "不能删除自己" }, { status: 400 });
  }

  const target = db
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, targetId))
    .get();

  if (!target) {
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  }

  db.delete(schema.users).where(eq(schema.users.id, targetId)).run();
  return NextResponse.json({ ok: true });
}
