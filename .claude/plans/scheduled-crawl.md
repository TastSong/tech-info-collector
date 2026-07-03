# Goal: 定时采集功能

## 1. scheduler 核心 (`src/scheduler/cron.ts`)
- Tick 频率每分钟 (`* * * * *`)
- 每 tick 遍历全部 enabled + 有 listSelector 的站点
- 对每个站点，解析其 `interval` cron 表达式，检查当前时间是否匹配
- 匹配时检查 `lastRunAt`（防止进程重启重复触发）——若 `lastRunAt` 在当前 cron 窗口开始时间之后则跳过
- 并发控制（最多 2-3 个站点同时执行）
- 每站执行：采集 → analyze → 通知

## 2. 调度配置 UI (`app/components/SchedulePicker.tsx`)
- 频率下拉：不自动采集 / 每月 / 每周 / 每天 / 自定义(指定星期)
- 自定义 → 显示星期多选（周一~周日）
- 每月 → 显示日期输入（1-28号）
- 时间输入（HH:MM，默认 09:00）
- 实时 cron 预览
- "保存"按钮 → PATCH API

## 3. API (`app/api/sites/[id]/interval/route.ts`)
- PATCH 方法：接收 `{ interval: string }` → 更新 sites 表 → 返回站点

## 4. 站点页 (`app/sites/page.tsx`)
- 每行展示当前采集频率（人类可读 + cron 原文）
- 点击可弹出 SchedulePicker 编辑

### 环境变量变更
- `CRON_INTERVAL` 不再使用（保留兼容，作为全局 fallback）
