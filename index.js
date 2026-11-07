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

export const name = 'task-guard-badge'
/** 需要 HTTP 载体服务（没有它这个插件不成立） */
export const inject = ['webServer']

/** 和 dsh-task-guard 共用同一个状态目录 */
const STATE_FILE = join(homedir(), '.dsh', 'task-guard', 'current.json')

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
