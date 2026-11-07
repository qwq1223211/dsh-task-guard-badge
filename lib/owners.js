/**
 * ============================================================================
 * dsh-task-guard-badge · lib/owners.js
 * ============================================================================
 * 回答一个用户真正关心的问题：**"被砍掉的工具，是我装的哪个插件？"**
 *
 * DSH 的工具注册表只给工具名，不告诉你是谁注册的。所以这里自己建映射：
 *   1. 只扫 profile 里**真正被加载**的那批包（dsh.profile.bundles 里能解析到目录的）
 *   2. 在包的源码里找 `name: 'tool_name'` 这类注册语句
 *   3. 顺手读包自带的 locale/{zh,en}.json，拿到给人看的插件名
 *
 * 成本实测：28 个包 / 86 个 JS 文件 / 827 KB —— 扫一次 10ms 级，结果缓存 60 秒。
 * ============================================================================
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 缓存：避免每次轮询都重新扫盘（首次约 1 秒，之后命中缓存） */
let cachedAt = 0
let cached = null
const CACHE_MS = 5 * 60_000

/** 工具名长得像不像一个工具 id（过滤掉 `name: 'some-plugin'` 这类噪音不会靠它，靠白名单） */
const TOOL_NAME_RE = /\bname\s*:\s*['"]([a-zA-Z][a-zA-Z0-9_]{1,48})['"]/g

/** 递归列出 .js/.mjs 文件（跳过 node_modules/.git，最多 3 层） */
function listJs(dir, depth = 0, out = []) {
  if (depth > 3) return out
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) listJs(full, depth + 1, out)
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) out.push(full)
  }
  return out
}

/** 读包自带的本地化标题（没有就用包名） */
function titleOfPkg(pkgDir, fallback) {
  for (const file of ['locale/zh.json', 'locale/en.json']) {
    const full = join(pkgDir, file)
    if (!existsSync(full)) continue
    try {
      const json = JSON.parse(readFileSync(full, 'utf8'))
      const title = json && json.meta && typeof json.meta.title === 'string' ? json.meta.title : ''
      if (title) return title
    } catch {
      // 坏文件就当没有
    }
  }
  return prettyPkgName(fallback)
}

/**
 * 没有 locale 的包，把包名整理成好读的标题：
 *   dsh-ego-browser            → Ego Browser
 *   @ggboy123/dsh-paper-reader → Paper Reader
 *   @local/dsh-unity-core      → Unity Core
 */
function prettyPkgName(name) {
  const raw = String(name || '')
  const base = raw.includes('/') ? raw.slice(raw.indexOf('/') + 1) : raw
  const words = base
    .replace(/^dsh-/, '')
    .replace(/-v\d+$/, '')
    .split(/[-_]/)
    .filter(Boolean)
  if (words.length === 0) return raw
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * 建一张「工具名 → 插件」的表。
 *
 * @param {string} profileDir profile 根目录（含 package.json 与 node_modules）
 * @param {string[]} onlyTools 只关心这些工具名（避免把无关的 name 字面量也收进来）
 * @returns {{byTool: Record<string,{pkg:string,title:string}>, byPkg: Record<string,{title:string,count:number}>}}
 */
/**
 * 找到某个 bundle 在磁盘上的真实目录。
 *
 * 【坑】只有本地开发的包是 `link:`；从 npm 装的第三方插件在 profile 的
 * dependencies 里根本没有条目（或不是 link:），但它们**确实装在 node_modules 里**。
 * 只认 link: 会漏掉绝大多数第三方插件（实测 63 个 bundle 只能解析 28 个）。
 */
function resolvePkgDir(profileDir, bundle, spec) {
  if (typeof spec === 'string' && spec.startsWith('link:')) {
    const linked = spec.slice(5)
    if (existsSync(linked)) return linked
  }
  // node_modules 里的真实目录（@scope/name 这种带斜杠也能正常拼）
  const inModules = join(profileDir, 'node_modules', bundle)
  if (existsSync(inModules)) return inModules
  return ''
}

export function buildOwners(profileDir, onlyTools) {
  const wanted = new Set(Array.isArray(onlyTools) ? onlyTools : [])
  const byTool = {}
  const byPkg = {}
  // 需要的标签集合（从工具名推）——第二遍扫描要用
  const neededTags = new Set()
  for (const tool of wanted) {
    const tag = tagOf(tool)
    if (tag && tag !== 'core') neededTags.add(tag)
  }
  /** 标签 → { 包名: 命中次数 } */
  const tagHits = new Map()
  /** 包名 → { dir, title }，供第二遍兜底用 */
  const pkgInfo = new Map()

  let profilePkg = {}
  try {
    profilePkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  } catch {
    return { byTool, byPkg }
  }
  const deps = profilePkg.dependencies || {}
  const bundles = (profilePkg.dsh && profilePkg.dsh.profile && profilePkg.dsh.profile.bundles) || []

  for (const bundle of bundles) {
    const spec = deps[bundle]
    const pkgDir = resolvePkgDir(profileDir, bundle, spec)
    if (!pkgDir) continue

    let pkgJson = {}
    try {
      pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    const pkgName = pkgJson.name || bundle
    const title = titleOfPkg(pkgDir, pkgName)
    // 【判定的第二重证据】标签必须出现在这个包自己的名字/标题/描述里，
    // 否则"路由器源码里提到过 unity_"这种噪声会把归属抢走（实测 86 个工具被误判给路由器）。
    const haystack = `${pkgName} ${title} ${pkgJson.description || ''}`.toLowerCase()
    pkgInfo.set(pkgName, { dir: pkgDir, title, haystack })

    for (const file of listJs(pkgDir)) {
      let text = ''
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      // ---- 第一遍：字面量注册（name: 'tool'）----
      TOOL_NAME_RE.lastIndex = 0
      let match
      while ((match = TOOL_NAME_RE.exec(text)) !== null) {
        const tool = match[1]
        if (wanted.size > 0 && !wanted.has(tool)) continue
        if (!byTool[tool]) byTool[tool] = { pkg: pkgName, title, source: 'literal' }
      }
      // ---- 第二遍：动态注册（`github_${action}`）→ 数 "标签_" 的出现次数 ----
      for (const tag of neededTags) {
        const needle = `${tag}_`
        let at = text.indexOf(needle)
        let hits = 0
        while (at !== -1 && hits < 50) {
          hits += 1
          at = text.indexOf(needle, at + needle.length)
        }
        if (hits > 0) {
          if (!tagHits.has(tag)) tagHits.set(tag, {})
          const bucket = tagHits.get(tag)
          bucket[pkgName] = (bucket[pkgName] || 0) + hits
        }
      }
    }

    const count = Object.values(byTool).filter((o) => o.pkg === pkgName).length
    if (count > 0) byPkg[pkgName] = { title, count }
  }

  // ---- 用标签命中次数给没归属的工具补上插件（要求标签出现在该包的名字/标题/描述里）----
  const tagOwner = new Map()
  for (const [tag, bucket] of tagHits) {
    const candidates = Object.entries(bucket)
      .filter(([pkgName]) => {
        const info = pkgInfo.get(pkgName)
        return info && info.haystack.includes(tag.toLowerCase())
      })
      .sort((a, b) => b[1] - a[1])
    if (candidates[0]) tagOwner.set(tag, candidates[0][0])
  }
  for (const tool of wanted) {
    if (byTool[tool]) continue
    // MCP 工具没有本地包：`mcp__meshy__x` → "MCP · meshy"（诚实且够用）
    if (tool.startsWith('mcp__')) {
      const server = tool.split('__')[1] || 'mcp'
      byTool[tool] = { pkg: `mcp:${server}`, title: `MCP · ${server}`, source: 'mcp' }
      continue
    }
    const owner = tagOwner.get(tagOf(tool))
    if (!owner) continue
    const info = pkgInfo.get(owner)
    byTool[tool] = { pkg: owner, title: info ? info.title : owner, source: 'tag' }
  }

  // ---- 统一重算每个包的工具数 ----
  for (const key of Object.keys(byPkg)) byPkg[key].count = 0
  for (const info of Object.values(byTool)) {
    if (!byPkg[info.pkg]) byPkg[info.pkg] = { title: info.title, count: 0 }
    byPkg[info.pkg].count += 1
  }

  return { byTool, byPkg }
}

/** 工具名 → 标签（与 host 侧 dsh-task-guard 的 tagOf 一致） */
function tagOf(toolName) {
  if (typeof toolName !== 'string' || !toolName) return ''
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__')
    return parts.length >= 3 && parts[1] ? parts[1] : 'mcp'
  }
  const cut = toolName.indexOf('_')
  return cut <= 0 ? 'core' : toolName.slice(0, cut)
}

/**
 * 带缓存的入口（宿主每次 HTTP 请求都会调，必须便宜）。
 * @param {string} profileDir
 * @param {string[]} onlyTools
 */
export function toolOwners(profileDir, onlyTools) {
  const now = Date.now()
  const key = Array.isArray(onlyTools) ? onlyTools.length : 0
  if (cached && now - cachedAt < CACHE_MS && cached.key === key) return cached.value
  const value = buildOwners(profileDir, onlyTools)
  cached = { at: now, key, value }
  cachedAt = now
  return value
}

/** 让老板也能看到"扫了多少个工具"（自检用） */
export function ownerStats(owners) {
  const byTool = owners && owners.byTool ? owners.byTool : {}
  return { tools: Object.keys(byTool).length, packages: Object.keys((owners && owners.byPkg) || {}).length }
}

/** 文件大小（调试时判断证据是否合理） */
export function sizeOf(file) {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}
