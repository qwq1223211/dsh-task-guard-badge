# dsh-task-guard-badge

A small badge under the message composer that shows what the **task-guard** plugin is currently doing to your tool table — and lets you open the details.

[![npm](https://img.shields.io/badge/version-0.2.2-blue)]() 

> Companion to [`dsh-task-guard`](https://github.com/qwq1223211/dsh-task-guard). This package is UI only: it reads the state file that task-guard writes.

## What it looks like

Collapsed (always visible, never in the way):

```
● 任务收窄 · 基础工具 + 插件管理   −219   每轮省 48.6K
```

Click it and a card opens above the composer:

```
┌──────────────────────────────────────────┐
│ 任务收窄                        [收窄中] ✕ │
│ 目标：验证面板名单                         │
│ 只保留任务需要的工具，其余从工具表里摘掉……  │
│ ┌──────────┬──────────┐                   │
│ │ 摘掉工具  │ 保留工具  │                   │
│ │   219    │    20    │                   │
│ └──────────┴──────────┘                   │
│ 收窄强度 ███████████████░ 92%              │
│ 每轮省 48.6K token · 回本 15 轮            │
│ 保留范围： 基础工具  插件管理               │
│                                            │
│ 保留的工具（20）                            │
│ [click] [type] [route_stage] [task_start]… │
│                                            │
│ 砍掉的工具（219）                           │
│ [全部 219] [浏览器 35] [3D 模型 28] [Unity 26]… │
│ ┌────────────────────────────────────┐     │
│ │ unity_object_create                │     │
│ │ unity_object_delete                │     │
│ │ …（可滚动）                         │     │
│ └────────────────────────────────────┘     │
└──────────────────────────────────────────┘
```

## Install

```bash
dsh plugin --profile desktop add github:qwq1223211/dsh-task-guard-badge
```

Then **reload** it (Settings → Plugins → toggle off/on) and **refresh the page** — the client half is loaded at runtime, so a page refresh is what makes the new UI appear.

It needs `dsh-task-guard` installed; without it the badge simply shows "任务收窄 · 未开启".

## What it shows

| Field | Where it comes from |
|---|---|
| Removed / kept tool counts | `task_start` snapshot |
| The actual kept tool names | `keptTools` |
| The removed tool names, grouped by tag | `deniedTools` + `deniedByTag` |
| Narrowing ratio | `denyCount / (denyCount + keptCount)` |
| Per-turn saving and payback | cost gate estimate |
| "may be stale" warning | snapshot written more than 12 h ago |

Group names are translated (`core` → 基础工具 / Core, `unity` → Unity, `ego` → 浏览器 / Browser, …); unknown groups fall back to their raw tag.

## Design notes

- **Theme-safe**: only `currentColor` and neutral `rgba`, so it works in light and dark themes.
- **Does not steal space**: renders nothing until the first poll returns; a parked badge is one muted line.
- **Fixed positioning**: the panel measures the pill and positions itself with `position: fixed`, so the composer dock's `overflow` cannot clip it.
- **Accessible**: `role="button"`, `aria-expanded`, Enter/Space to toggle, Escape or click-outside to close.
- **Cheap**: one `fetch` every 4 s against a local read-only endpoint; no polling of the model.

## Known rough edges

- With no task running the badge is a muted one-liner; a first-time user may not notice it.
- Colours are hard-coded green rather than theme tokens; contrast in light themes is adequate but not tuned.
- The panel appears without a transition animation.
- `title` tooltips expose the raw group tag on purpose (useful when debugging), which is noise for pure end users.

## License

MIT
