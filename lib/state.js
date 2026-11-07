/**
 * ============================================================================
 * dsh-task-guard-badge · lib/state.js
 * ============================================================================
 * 把"从磁盘拼出 UI 要的状态"这段逻辑从 index.js 抽出来，理由有两个：
 *   1. index.js 只该管 HTTP 注册，不该混着文件解析
 *   2. 抽出来就能用 node:test 测——之前这一层零测试，bug 全靠肉眼
 *
 * 输入全部是路径 + 一个 now()（方便测试里控制时间），没有副作用。
 * ============================================================================
 */
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { toolOwners } from './owners.js'

/** 读文件尾部若干字节（日志可能几 MB，整读太浪费） */
export function readTail(file, maxBytes = 96 * 1024) {
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
export function parseLines(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
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
export function recentEvents(rows, limit = 20) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && typeof row.kind === 'string') : []
  return list
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

/** 探针新鲜度：超过这个时间就不当作"当前阶段" */
export const STAGE_FRESH_MS = 10 * 60 * 1000

/**
 * 从探针记录里取最近几条 + 最后一条的阶段。
 * 【只认新鲜数据】探针是全局文件，最后一条可能来自别的会话或重载前的旧记录。
 */
export function probeInfo(rows, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 8
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const list = Array.isArray(rows) ? rows.filter((row) => row && typeof row === 'object') : []
  const recent = list.slice(-limit).map((row) => ({
    at: Number(row.at) || 0,
    tools: Number(row.tools) || 0,
    toolsChars: Number(row.toolsChars) || 0,
    stage: typeof row.stage === 'string' ? row.stage : '',
    promptTokens: Number(row.promptTokens) || 0,
    hitRate: Number(row.hitRate) || 0,
  }))
  const last = list.length > 0 ? list[list.length - 1] : null
  const lastAt = last ? Number(last.at) || 0 : 0
  const fresh = lastAt > 0 && now - lastAt < STAGE_FRESH_MS
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

/** 读 task-guard 写的持久工具清单（数量 + 全量名单） */
export function readRegistry(file) {
  try {
    if (!existsSync(file)) return { count: 0, tools: [] }
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const tools = Array.isArray(json && json.tools) ? json.tools.filter((t) => typeof t === 'string') : []
    const count = Number(json && json.count) || tools.length
    return { count, tools }
  } catch {
    return { count: 0, tools: [] }
  }
}

/**
 * 拼出给 UI 的完整状态。
 *
 * 【口径统一】工具表大小有两个来源：
 *   · registry.count —— 路由器注册表（schemas 条数，如 239）
 *   · probe.tools    —— 真正发给 API 的条数（含 base 工具，如 274）
 * 两者差几十个是设计差异。这里都保留，但额外给一个 `toolsCount` 作为
 * **UI 默认显示的那个**（优先用探针的真实值），避免面板里出现两个不同的数字。
 */
export function buildState(options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const stateFile = options.stateFile
  const activityFile = options.activityFile
  const probeFile = options.probeFile
  const registryFile = options.registryFile
  const profileDir = options.profileDir
  const eventLimit = Number.isFinite(options.eventLimit) ? options.eventLimit : 20

  let state = { active: false }
  try {
    if (stateFile && existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    /* 坏文件当没任务 */
  }

  // 工具 → 插件归属（只在有名单时扫，扫描本身有缓存）
  try {
    const denied = Array.isArray(state.deniedTools) ? state.deniedTools : []
    const kept = Array.isArray(state.keptTools) ? state.keptTools : []
    if (denied.length + kept.length > 0 && profileDir) {
      const owners = toolOwners(profileDir, [...denied, ...kept])
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

  // 探针：阶段 + 最近趋势
  try {
    let rows = probeFile ? parseLines(readTail(probeFile)) : []
    if (rows.length === 0 && probeFile) rows = parseLines(readTail(`${probeFile}.1`))
    const probe = probeInfo(rows, { now })
    state.stage = probe.stage || ''
    state.probe = {
      tools: probe.tools,
      toolsChars: probe.toolsChars,
      promptTokens: probe.promptTokens,
      hitRate: probe.hitRate,
      stageAt: probe.stageAt,
      recent: probe.recent,
    }
  } catch {
    state.probe = { tools: 0, toolsChars: 0, promptTokens: 0, hitRate: 0, stageAt: 0, recent: [] }
  }

  // 历史事件
  try {
    state.history = recentEvents(activityFile ? parseLines(readTail(activityFile)) : [], eventLimit)
  } catch {
    state.history = []
  }

  // 持久工具清单：空态也要能显示"工具表多大"
  const registry = registryFile ? readRegistry(registryFile) : { count: 0, tools: [] }
  state.registeredTools = registry.count
  if (!state.active && !state.knownTools && registry.count > 0) state.knownTools = registry.count
  // 分组清单（用于"手动调工具表"）：按标签统计工具数
  try {
    if (registry.tools.length > 0) {
      const groups = new Map()
      for (const tool of registry.tools) {
        const tag = tool.startsWith('mcp__') ? (tool.split('__')[1] || 'mcp') : (() => {
          const cut = tool.indexOf('_')
          return cut <= 0 ? 'core' : tool.slice(0, cut)
        })()
        groups.set(tag, (groups.get(tag) || 0) + 1)
      }
      state.groups = [...groups.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count)
    }
  } catch {
    // 分组失败就算了
  }

  // 【口径统一】UI 默认显示的那个数字：优先真实发出数（探针），其次注册数
  state.toolsCount = Number(state.probe && state.probe.tools) || Number(state.registeredTools) || 0
  state.serverTime = now
  return state
}
