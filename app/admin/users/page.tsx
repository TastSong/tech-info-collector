"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Plus, Trash2, Shield, User, Loader2, X } from "lucide-react";
import { useToast } from "@/app/components/Toast";

interface UserItem {
  id: number;
  username: string;
  role: "admin" | "user";
  createdAt: number;
}

export default function AdminUsersPage() {
  const toast = useToast();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建用户弹窗
  const [showModal, setShowModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // 删除确认
  const [deleting, setDeleting] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");

    if (!newUsername.trim() || !newPassword) {
      setCreateError("请填写用户名和密码");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error ?? "创建失败");
        return;
      }
      toast.success(`已创建用户 ${newUsername}`);
      setShowModal(false);
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      loadUsers();
    } catch {
      setCreateError("网络错误");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (target: UserItem) => {
    if (deleting) return;
    if (!confirm(`确定要删除用户「${target.username}」吗？\n其已读记录和收藏将一并清除。`)) return;

    setDeleting(target.id);
    try {
      const res = await fetch(`/api/admin/users/${target.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? "删除失败");
        return;
      }
      toast.success(`已删除用户 ${target.username}`);
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
    } catch {
      toast.error("网络错误");
    } finally {
      setDeleting(null);
    }
  };

  const resetForm = () => {
    setNewUsername("");
    setNewPassword("");
    setNewRole("user");
    setCreateError("");
    setShowModal(false);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center gap-2 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          加载中…
        </div>
      </main>
    );
  }

  const currentUsername = users.find((u) => u.id === (deleting ?? -1))?.username;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-indigo-500" />
            用户管理
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            管理可登录系统的用户账户
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          创建用户
        </button>
      </div>

      {/* User Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3">用户名</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">创建时间</th>
              <th className="px-4 py-3 w-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                  {u.username}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                        : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {u.role === "admin" ? (
                      <Shield className="h-3 w-3" />
                    ) : (
                      <User className="h-3 w-3" />
                    )}
                    {u.role === "admin" ? "管理员" : "用户"}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                  {u.createdAt
                    ? new Date(u.createdAt * 1000).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })
                    : "-"}
                </td>
                <td className="px-4 py-3">
                  {deleting === u.id ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      删除中…
                    </span>
                  ) : (
                    <button
                      onClick={() => handleDelete(u)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30 dark:hover:text-red-400 transition-colors"
                      title="删除用户"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  暂无用户
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create User Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:bg-slate-900 dark:border-slate-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold dark:text-slate-100">创建新用户</h2>
              <button
                onClick={resetForm}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  用户名
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="2-32 个字符"
                  disabled={creating}
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  密码
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  placeholder="6-128 个字符"
                  disabled={creating}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                  角色
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  disabled={creating}
                >
                  <option value="user">用户 (user)</option>
                  <option value="admin">管理员 (admin)</option>
                </select>
              </div>

              {createError && (
                <p className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-100 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                  {createError}
                </p>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
                  disabled={creating}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      创建中…
                    </>
                  ) : (
                    "确认创建"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
