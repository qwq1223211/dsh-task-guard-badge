/**
 * ============================================================================
 * dsh-task-guard-badge · Host 半边
 * ============================================================================
 * 浏览器里的徽章读不到 Host 进程内存，所以这里只做一件事：
 * 注册一个只读 HTTP 接口，把 dsh-task-guard 写在磁盘上的 current.json 吐出去。
 *
 *   GET /task-guard/state  ->  { active, taskId, groups, denyCount, ... }
 *
 * 数据源：~/.dsh/task-guard/current.json（由 dsh-task-guard 在任务开始/结束时写）
 * 读不到就返回 { active: false }，绝不报错——徽章是锦上添花，不能影响主流程。
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { toolOwners } from './lib/owners.js'

export const name = 'task-guard-badge'
/** 需要 HTTP 载体服务（没有它这个插件不成立） */
export const inject = ['webServer']

/** 和 dsh-task-guard 共用同一个状态目录 */
const STATE_FILE = join(homedir(), '.dsh', 'task-guard', 'current.json')
/** 扫描工具归属时用的 profile 目录（可用 DSH_PROFILE 覆盖） */
const PROFILE_DIR = join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE || 'desktop')

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{pollMs?: number, routePath?: string}} config
 */
export function apply(ctx, config = {}) {
  const routePath = typeof config.routePath === 'string' && config.routePath.startsWith('/') ? config.routePath : '/task-guard/state'

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler(_request, response) {
        let state = { active: false }
        try {
          if (existsSync(STATE_FILE)) state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
        } catch {
          /* 文件坏了就当没任务，不把异常甩给浏览器 */
        }
        // 【v0.3.0】给每个工具补上"它属于哪个插件"——用户真正想看的是这个
        try {
          const denied = Array.isArray(state.deniedTools) ? state.deniedTools : []
          const kept = Array.isArray(state.keptTools) ? state.keptTools : []
          if (denied.length + kept.length > 0) {
            const owners = toolOwners(PROFILE_DIR, [...denied, ...kept])
            const ownerOf = {}
            const buckets = new Map()
            for (const tool of denied) {
              const info = owners.byTool[tool]
              const title = info ? info.title : ''
              ownerOf[tool] = title
              const key = title || '(未归属)'
              buckets.set(key, (buckets.get(key) || 0) + 1)
            }
            state.toolOwners = ownerOf
            state.deniedByOwner = [...buckets.entries()]
              .map(([title, count]) => ({ title, count }))
              .sort((a, b) => b.count - a.count)
          }
        } catch {
          // 归属只是锦上添花，失败不影响徽章
        }
        const body = JSON.stringify(state)
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(body)
      },
    }),
  )
}
