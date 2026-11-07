# dsh-task-guard-badge

A small badge under the message composer that shows what the **task-guard** plugin is currently doing to your tool table — and lets you open the details.

[![npm](https://img.shields.io/badge/version-0.2.2-blue)]() 

> Companion to [`dsh-task-guard`](https://github.com/qwq1223211/dsh-task-guard). This package is UI only: it reads the state file that task-guard writes.

## What it looks like

Collapsed (always visible, never in the way). With no task running it is a dashed,
clickable pill instead:

```
● unity-ui   −219   每轮省 48.6K          ← task narrowed
○ 工具表：全开（176） ▾                    ← nothing narrowed; still clickable
```

Click it and a card opens above the composer:

```
┌──────────────────────────────────────────┐
│ 任务收窄   [手动]          [收窄中]  ✕    │
│ [概览] [工具] [历史]                      │
├──────────────────────────────────────────┤
│        ◐ 92%        摘掉 219  保留 20     │
│                     每轮省 48.6K token    │
│ 工具表大小  ▁▂▃▅█ 274                     │
│ 最近请求的阶段  unity-ui                  │
│ 保留范围  core  plugin                    │
└──────────────────────────────────────────┘
```

The **工具** tab has a search box and a tree grouped by the plugin that owns each tool;
the **历史** tab lists the last 20 router events. The header chip toggles **auto ⇄ manual**.

## Install

```bash
dsh plugin --profile desktop add github:qwq1223211/dsh-task-guard-badge
```

Then **reload** it (Settings → Plugins → toggle off/on) and **refresh the page** — the client half is loaded at runtime, so a page refresh is what makes the new UI appear.

It needs `dsh-task-guard` installed; without it the badge simply shows "任务收窄 · 未开启".

## What it shows

Three tabs, plus a mode switch in the header:

| Tab | Content |
|---|---|
| **Overview** | ring progress (narrowing ratio), removed/kept counts, mini bar chart of the last 8 requests, last request's stage, scope groups, goal |
| **Tools** | search box + a tree grouped by the plugin that provides each tool (click a plugin to expand its tools) |
| **History** | the last 20 events from the router ledger: stage switches, gate blocks, denials, tool-table changes |

The header chip toggles **auto ⇄ manual**:

| Mode | Who decides the tool table |
|---|---|
| `manual` (default) | you: click groups in the panel, or the model calls `route_stage` / `task_start` |
| `auto` | the model: the router's tail hint becomes "YOU decide the tool set", so it calls `route_use` / `task_start` itself |

Toggling writes `~/.dsh/task-guard/mode.json`; the router reads it (5 s cache). A missing or
broken file always falls back to `manual`, so control is never handed over by accident.

When **no task is running**, the pill is still clickable: it opens the manual panel with the
current table size and a group picker ("Narrow to selection" / "End task"), so you can adjust
the tool table without asking the model to do it.

## What it reads

| Field | Source |
|---|---|
| Removed / kept tools, scope, goal | `~/.dsh/task-guard/current.json` |
| Which plugin owns each tool | scanned from the profile's bundled packages (cached 5 min) |
| Tool table size | probe record (`tools`) first, then `tool-registry.json` |
| Last request's stage | probe record, **only if fresher than 10 minutes** |
| History | `~/.dsh/minimal-router/activity.jsonl` (tail) |
| Auto/manual mode | `~/.dsh/task-guard/mode.json` |
| Last manual action result | `~/.dsh/task-guard/request-result.json` |

Group names are translated (`core` → 基础工具 / Core, `unity` → Unity, `ego` → 浏览器 / Browser, …);
unknown groups fall back to their raw tag.

## Manual control

Buttons in the panel POST to `/task-guard/action`, which writes
`~/.dsh/task-guard/request.json`. `dsh-task-guard` consumes it on its next
`tools/pre-execute` (the only hook that has `agent.ctx.tools`), applies
`restrict({deny})` or disposes the restriction, and writes the result back.
Requests older than 60 s are ignored, and each id is consumed once.

## Design notes

- **Theme-safe**: colours derive from `currentColor` via `color-mix`, plus system colours
  (`Canvas` / `CanvasText`), so light and dark themes both work.
- **Responsive**: the panel is `min(380px, 100vw - 32px)`; it never overflows a narrow window.
- **Push, not poll**: the panel uses SSE (`/task-guard/stream`, 2 s) with a 6 s watchdog that
  falls back to plain polling if frames stop arriving.
- **Fixed positioning**: the panel measures the pill and places itself with `position: fixed`,
  so the composer dock's `overflow` cannot clip it.
- **Accessible**: `role="button"`, `aria-expanded`, Enter/Space to toggle, Escape or
  click-outside to close, focus ring on keyboard focus.

## Tests

`node test/state.test.mjs` — 13 tests over `lib/state.js` (tail reading, bad-line tolerance,
event mapping, 10-minute stage freshness, registry fallback, mode parsing, unified count).

## Known rough edges

- With no task running the pill is muted; a first-time user may not realise it is clickable.
- The "last request stage" is an approximation: the probe file is global, so another session's
  request could be the most recent one (the 10-minute freshness check bounds the damage).
- Group picker lists every tag from the registry, including trivial ones (1 tool).

## License

MIT
