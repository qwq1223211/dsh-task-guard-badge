/**
 * ============================================================================
 * dsh-task-guard-badge · Host 半边
 * ============================================================================
 * 浏览器里的徽章读不到 Host 进程内存，所以这里把「磁盘上已有的状态」整理成
 * 一个给 UI 用的 JSON，并提供一条 SSE 推送通道。
 *
 *   GET /task-guard/state   一次性的完整状态（JSON）
 *   GET /task-guard/stream  Server-Sent Events，每 2 秒推一次（掉线由浏览器自动重连）
 *
 * 数据来源（全部只读，不写任何东西）：
 *   ~/.dsh/task-guard/current.json          任务收窄的快照（task-guard 写）
 *   ~/.dsh/minimal-router/activity.jsonl    事件流（切阶段/改工具表/拦截）
 *   ~/.dsh/minimal-router/usage.jsonl       探针账单（含每条请求的阶段与工具数）
 *
 * 设计原则：任何一块读不到都只是"少一块数据"，绝不抛错——徽章不能影响主流程。
 * ============================================================================
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { toolOwners } from './lib/owners.js'

export const name = 'task-guard-badge'
/** 需要 HTTP 载体服务（没有它这个插件不成立） */
export const inject = ['webServer']

const STATE_DIR = join(homedir(), '.dsh', 'task-guard')
const ROUTER_DIR = join(homedir(), '.dsh', 'minimal-router')
const STATE_FILE = join(STATE_DIR, 'current.json')
/** task-guard 写的全量工具清单（不随任务结束消失） */
const REGISTRY_FILE = join(STATE_DIR, 'tool-registry.json')
const ACTIVITY_FILE = join(ROUTER_DIR, 'activity.jsonl')
const PROBE_FILE = join(ROUTER_DIR, 'usage.jsonl')
const PROFILE_DIR = join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE || 'desktop')

/** 读文件尾部若干字节（日志可能几 MB，整读太浪费） */
function readTail(file, maxBytes = 96 * 1024) {
  try {
    if (!existsSync(file)) return ''
    const size = statSync(file).size
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    if (length <= 0) return ''
    const fd = openSync(file, 'r')
    try {
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, start)
      let text = buffer.toString('utf8')
      // 从中间截断可能产生半个 UTF-8 字符 → 丢掉第一行（可能不完整）
      if (start > 0) {
        const nl = text.indexOf('\n')
        text = nl >= 0 ? text.slice(nl + 1) : ''
      }
      return text
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

/** 把 JSONL 文本解析成数组（坏行跳过） */
function parseLines(text) {
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line)
      if (value && typeof value === 'object') out.push(value)
    } catch {
      // 坏行跳过
    }
  }
  return out
}

/** 最近的事件（新的在前），只保留 UI 用得上的字段 */
function recentEvents(limit = 20) {
  const rows = parseLines(readTail(ACTIVITY_FILE))
  const keep = rows.slice(-limit * 2).filter((row) => row && typeof row.kind === 'string')
  return keep
    .slice(-limit)
    .reverse()
    .map((row) => ({
      t: Number(row.t) || 0,
      kind: row.kind,
      from: typeof row.from === 'string' ? row.from : '',
      to: typeof row.to === 'string' ? row.to : '',
      stage: typeof row.stage === 'string' ? row.stage : '',
      tool: typeof row.tool === 'string' ? row.tool : '',
      by: typeof row.by === 'string' ? row.by : '',
      deny: Number(row.deny) || 0,
      kw: typeof row.kw === 'string' ? row.kw : '',
    }))
}

/** 探针：最近几条 + 最后一条的 stage（这就是"现在处于哪个阶段"的近似值） */
function probeInfo(limit = 8) {
  let rows = parseLines(readTail(PROBE_FILE))
  if (rows.length === 0) rows = parseLines(readTail(`${PROBE_FILE}.1`))
  const recent = rows.slice(-limit).map((row) => ({
    at: Number(row.at) || 0,
    tools: Number(row.tools) || 0,
    toolsChars: Number(row.toolsChars) || 0,
    stage: typeof row.stage === 'string' ? row.stage : '',
    promptTokens: Number(row.promptTokens) || 0,
    hitRate: Number(row.hitRate) || 0,
  }))
  const last = rows.length > 0 ? rows[rows.length - 1] : null
  // 【只认新鲜数据】探针是全局文件，最后一条可能来自别的会话或路由器刚重载前的旧记录。
  // 超过 10 分钟就不当作"当前阶段"，否则徽章会显示一个早已不成立的阶段。
  const lastAt = last ? Number(last.at) || 0 : 0
  const fresh = lastAt > 0 && Date.now() - lastAt < 10 * 60 * 1000
  return {
    stage: fresh && last && typeof last.stage === 'string' ? last.stage : '',
    tools: last ? Number(last.tools) || 0 : 0,
    toolsChars: last ? Number(last.toolsChars) || 0 : 0,
    promptTokens: last ? Number(last.promptTokens) || 0 : 0,
    hitRate: last ? Number(last.hitRate) || 0 : 0,
    stageAt: fresh ? lastAt : 0,
    recent,
  }
}

/** 组装一次完整状态（所有异常都被吞掉） */
function buildState() {
  let state = { active: false }
  try {
    if (existsSync(STATE_FILE)) state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    /* 坏文件当没任务 */
  }

  // 工具 → 插件归属
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
    // 归属失败不影响其它字段
  }

  // 路由器的实时信息
  try {
    const probe = probeInfo()
    state.stage = probe.stage || ''
    state.probe = { tools: probe.tools, toolsChars: probe.toolsChars, promptTokens: probe.promptTokens, hitRate: probe.hitRate, stageAt: probe.stageAt, recent: probe.recent }
  } catch {
    // 探针读不到就算了
  }
  try {
    state.history = recentEvents(20)
  } catch {
    state.history = []
  }
  // 空态也需要"工具表多大"：从持久清单里补，不依赖当前是否有任务
  if (!state.active && !state.knownTools) {
    try {
      if (existsSync(REGISTRY_FILE)) {
        const registry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8'))
        const count = Number(registry && registry.count) || (Array.isArray(registry && registry.tools) ? registry.tools.length : 0)
        if (count > 0) state.knownTools = count
      }
    } catch {
      // 读不到就算了
    }
  }
  state.serverTime = Date.now()
  return state
}

export function apply(ctx, config = {}) {
  const routePath = typeof config.routePath === 'string' && config.routePath.startsWith('/') ? config.routePath : '/task-guard/state'
  const streamPath = routePath.endsWith('/state') ? `${routePath.slice(0, -'/state'.length)}/stream` : `${routePath}/stream`
  const pushMs = Number.isFinite(config.pushMs) ? Math.max(1000, Math.trunc(config.pushMs)) : 2000

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler(_request, response) {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify(buildState()))
      },
    }),
  )

  // SSE：浏览器用 EventSource 连，掉线会自动重连；断开时清掉定时器
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: streamPath,
      handler(request, response) {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        })
        const send = () => {
          try {
            response.write(`data: ${JSON.stringify(buildState())}\n\n`)
          } catch {
            // 写失败（对端已断开）→ 交给 close 清理
          }
        }
        send()
        const timer = setInterval(send, pushMs)
        const stop = () => {
          clearInterval(timer)
        }
        request.on('close', stop)
        response.on('close', stop)
        // 防止 Node 因为长连接被当作挂死
        if (typeof response.setTimeout === 'function') response.setTimeout(0)
      },
    }),
  )
}
