/**
 * ============================================================================
 * dsh-task-guard-badge · Client 半边（浏览器里跑）
 * ============================================================================
 * 挂在 conversation.composer.dock —— 「活动 / 用量」那一行下面。
 *
 * 【形态】
 *   收起：一枚紧凑胶囊 —— ● 任务收窄 · core+plugin   −218 工具   省 47K/轮
 *   点开：一张浮层卡片
 *     ┌──────────────────────────────┐
 *     │ 任务收窄            [收窄中] ✕ │
 *     │ 目标：只留 core + plugin       │
 *     │ ┌────────┬────────┐           │
 *     │ │ 摘掉    │ 保留    │           │
 *     │ │ 218    │ 20     │           │
 *     │ └────────┴────────┘           │
 *     │ 收窄强度 ███████████████░ 92%  │
 *     │ 每轮省 46,680 token ≈ 8 轮回本 │
 *     │ 组： core  plugin              │
 *     └──────────────────────────────┘
 *
 * 【三条纪律】
 *   1. 工厂函数本身不做副作用（只在 render 里读 state）
 *   2. 定时器/监听器必须在 unmount 时清掉，否则切会话会累积
 *   3. 颜色只用 currentColor + 中性 rgba，才能同时适配深/浅色主题
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-guard-badge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const POLL_MS = 4000
    const ENDPOINT = '/task-guard/state'

    /** 文案（跟随界面语言；取不到就中文） */
    const COPY = {
      zh: {
        active: '任务收窄',
        inactive: '任务收窄 · 未开启',
        colon: '：',
        what: '只保留任务需要的工具，其余从工具表里摘掉——省的是每轮都要付的声明开销。',
        running: '收窄中',
        goal: '目标',
        removed: '摘掉工具',
        kept: '保留工具',
        strength: '收窄强度',
        saving: '每轮省',
        payback: '回本',
        paybackUnit: '轮',
        token: 'token',
        groups: '保留范围',
        keptTools: '保留的工具',
        deniedTools: '砍掉的工具',
        all: '全部',
        none: '（没有名单：这份快照是旧版本写的）',
        empty: '（没有）',
        unknownOwner: '未识别来源',
        hint: '想恢复全部工具：说「结束任务」或调用 task_end',
        stale: '这个状态可能已过期（{age}前写入），任务可能已经不在运行',
        close: '关闭',
      },
      en: {
        active: 'Task narrowing',
        inactive: 'Task narrowing · off',
        colon: ': ',
        what: 'Only the tools this task needs stay available; the rest leave the tool table, saving the per-turn declaration cost.',
        running: 'active',
        goal: 'Goal',
        removed: 'Tools removed',
        kept: 'Tools kept',
        strength: 'Narrowing',
        saving: 'Saved / turn',
        payback: 'Payback',
        paybackUnit: 'turns',
        token: 'token',
        groups: 'Scope',
        keptTools: 'Kept tools',
        deniedTools: 'Removed tools',
        all: 'All',
        none: '(no lists in this snapshot — written by an older version)',
        empty: '(none)',
        unknownOwner: 'Unknown source',
        hint: 'To restore every tool: say "end the task" or call task_end',
        stale: 'This state may be stale (written {age} ago); the task is probably not running',
        close: 'Close',
      },
    }

    function pickCopy() {
      try {
        const lang = (typeof navigator !== 'undefined' && navigator.language) || ''
        const isZh = String(lang).toLowerCase().startsWith('zh')
        return { ...(isZh ? COPY.zh : COPY.en), lang: isZh ? 'zh' : 'en' }
      } catch {
        return { ...COPY.zh, lang: 'zh' }
      }
    }
    const T = pickCopy()

    /** 12345 → 12K；0.5 → 0.5 */
    function fmt(n) {
      const v = Number(n) || 0
      if (v >= 1000000) return `${Math.round(v / 100000) / 10}M`
      if (v >= 1000) return `${Math.round(v / 100) / 10}K`
      return String(v)
    }

    /**
     * 工具名 → 组名（和 host 侧 dsh-task-guard 的 tagOf 口径一致）。
     *   unity_object_create → unity
     *   task_start          → task
     *   mcp__meshy__x       → meshy
     */
    function tagOfName(name) {
      if (typeof name !== 'string' || !name) return 'unknown'
      if (name.startsWith('mcp__')) {
        const parts = name.split('__')
        return parts.length >= 3 && parts[1] ? parts[1] : 'mcp'
      }
      const cut = name.indexOf('_')
      return cut <= 0 ? 'core' : name.slice(0, cut)
    }

    /**
     * 组名 → 人话。
     *
     * 【为什么要这张表】`core` / `plugin` 是代码里的标签，直接给用户看像半成品。
     * 发给别人用时，徽章上不应该出现内部标识符。表里没有的组直接显示原名（不会报错）。
     */
    const GROUP_LABELS = {
      core: { zh: '基础工具', en: 'Core' },
      plugin: { zh: '插件管理', en: 'Plugins' },
      route: { zh: '路由控制', en: 'Router' },
      guard: { zh: '熔断器', en: 'Guard' },
      cache: { zh: '缓存探针', en: 'Probe' },
      task: { zh: '任务管理', en: 'Tasks' },
      unity: { zh: 'Unity', en: 'Unity' },
      ui: { zh: '界面', en: 'UI' },
      uikit: { zh: 'UI 组件', en: 'UIKit' },
      uiflow: { zh: 'UI 流程', en: 'UIFlow' },
      art: { zh: '美术', en: 'Art' },
      meshy: { zh: '3D 模型', en: '3D' },
      image: { zh: '图片', en: 'Images' },
      audio: { zh: '音频', en: 'Audio' },
      ego: { zh: '浏览器', en: 'Browser' },
      github: { zh: 'GitHub', en: 'GitHub' },
      terminal: { zh: '终端', en: 'Terminal' },
      python: { zh: 'Python', en: 'Python' },
      notebook: { zh: '笔记本', en: 'Notebook' },
      office: { zh: 'Office 文档', en: 'Office' },
      docx: { zh: 'Word', en: 'Word' },
      pptx: { zh: 'PPT', en: 'Slides' },
      markdown: { zh: 'Markdown', en: 'Markdown' },
      read: { zh: '文档读取', en: 'Docs' },
      screen: { zh: '桌面操作', en: 'Desktop' },
      click: { zh: '桌面操作', en: 'Desktop' },
      sticker: { zh: '表情包', en: 'Stickers' },
      meme: { zh: '表情包', en: 'Memes' },
      comfyui: { zh: 'ComfyUI', en: 'ComfyUI' },
      modlens: { zh: '视觉', en: 'Vision' },
      adapt: { zh: '自适应记忆', en: 'Adaptive' },
      session: { zh: '会话', en: 'Sessions' },
      study: { zh: '学习', en: 'Study' },
      list: { zh: '列表', en: 'Lists' },
      search: { zh: '搜索', en: 'Search' },
      transcribe: { zh: '转写', en: 'Transcribe' },
      // Unity 全家（这些组名直接来自插件名前缀）
      level: { zh: '关卡', en: 'Level' },
      perf: { zh: '性能', en: 'Perf' },
      save: { zh: '存档', en: 'Save' },
      lighting: { zh: '光照', en: 'Lighting' },
      player: { zh: '玩家', en: 'Player' },
      enemy: { zh: '敌人', en: 'Enemy' },
      l10n: { zh: '本地化', en: 'Localization' },
      gameplay: { zh: '玩法', en: 'Gameplay' },
      dialogue: { zh: '对话', en: 'Dialogue' },
      quest: { zh: '剧情任务', en: 'Quest' },
      asset: { zh: '资源', en: 'Assets' },
      // 其他
      cursor: { zh: '示例插件', en: 'Demo' },
      mcp: { zh: 'MCP 服务', en: 'MCP' },
      review: { zh: '评审', en: 'Review' },
      working: { zh: '工作区', en: 'Workspace' },
      create: { zh: '创建', en: 'Create' },
      course: { zh: '课程', en: 'Course' },
      app: { zh: '应用', en: 'App' },
      load: { zh: '加载', en: 'Load' },
      tool: { zh: '工具清单', en: 'Inventory' },
      unknown: { zh: '其他', en: 'Other' },
    }

    /** 取组的人话名；表里没有就返回原名 */
    function labelOf(tag) {
      const entry = GROUP_LABELS[tag]
      if (!entry) return tag
      return T.lang === 'en' ? entry.en : entry.zh
    }

    /** host 端对"查不到归属"的工具用这个占位，客户端翻成人话 */
    function ownerLabel(title) {
      if (title === '(未归属)') return T.unknownOwner
      return title
    }

    const S = {
      wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '3px 10px',
        fontSize: 12,
        lineHeight: '18px',
        borderRadius: 999,
        border: '1px solid rgba(127,127,127,0.28)',
        background: 'rgba(127,127,127,0.10)',
        color: 'inherit',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 120ms ease, border-color 120ms ease',
      },
      dot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' },
      label: { fontWeight: 500 },
      mellow: { opacity: 0.6 },
      panel: {
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: 0,
        zIndex: 40,
        width: 340,
        maxHeight: '70vh',
        overflowY: 'auto',
        padding: '14px 14px 12px',
        borderRadius: 12,
        border: '1px solid rgba(127,127,127,0.30)',
        background: 'canvas',
        color: 'inherit',
        boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
        fontSize: 12,
        lineHeight: '18px',
      },
      header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
      title: { fontWeight: 600, fontSize: 13 },
      badge: {
        marginLeft: 'auto',
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11,
        background: 'rgba(34,197,94,0.16)',
        color: '#16a34a',
      },
      goal: { opacity: 0.75, marginBottom: 10, wordBreak: 'break-word' },
      grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 },
      cell: { padding: '8px 10px', borderRadius: 8, background: 'rgba(127,127,127,0.10)' },
      cellLabel: { fontSize: 11, opacity: 0.65, marginBottom: 2 },
      cellValue: { fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      barRow: { marginBottom: 10 },
      barLabel: { display: 'flex', justifyContent: 'space-between', fontSize: 11, opacity: 0.75, marginBottom: 4 },
      barTrack: { height: 6, borderRadius: 999, background: 'rgba(127,127,127,0.20)', overflow: 'hidden' },
      barFill: { height: '100%', borderRadius: 999, background: 'linear-gradient(90deg,#22c55e,#16a34a)' },
      meta: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
      chip: {
        padding: '1px 8px',
        borderRadius: 999,
        fontSize: 11,
        background: 'rgba(127,127,127,0.16)',
      },
      hint: { opacity: 0.55, fontSize: 11, lineHeight: '16px' },
      sectionTitle: { fontSize: 11, opacity: 0.6, margin: '10px 0 6px' },
      chipsBox: { display: 'flex', flexWrap: 'wrap', gap: 4 },
      chipClick: { cursor: 'pointer' },
      chipActive: { background: 'rgba(34,197,94,0.22)', color: '#16a34a' },
      toolList: {
        marginTop: 6,
        maxHeight: 150,
        overflowY: 'auto',
        border: '1px solid rgba(127,127,127,0.22)',
        borderRadius: 8,
        padding: '6px 8px',
      },
      toolRow: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: '16px',
        opacity: 0.85,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      close: {
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        opacity: 0.5,
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: '14px',
        padding: 2,
      },
    }

    /**
     * 磁盘快照超过 12 小时就认为"可能过期"，返回人能读的时长（如 "7d"），否则空串。
     * 为什么需要：进程重启后 current.json 不会自动清，徽章会一直显示"收窄中"。
     */
    function staleAge(state) {
      const at = Number(state && (state.at || state.startedAt)) || 0
      if (!at) return ''
      const ms = Date.now() - at
      if (ms < 12 * 3600 * 1000) return ''
      const hours = Math.round(ms / 3600000)
      return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
    }

    /** 详情面板（纯展示，不持有状态） */
    /** 详情面板（纯展示；fixed 定位避免被 composer dock 的 overflow 裁掉） */
    function Panel(props) {
      const state = props.state || {}
      const anchor = props.anchor || { left: 12, bottom: 80 }
      const removed = Number(state.denyCount) || 0
      const kept = Number(state.keptCount) || 0
      const total = removed + kept
      const ratio = total > 0 ? Math.min(1, removed / total) : 0
      const perTurn = Number(state.savingsPerTurn) || 0
      const payback = Number(state.paybackTurns) || 0
      const groups = Array.isArray(state.groups) ? state.groups : []
      // ---- 名单：保留了什么 / 砍了什么（v0.2.1）----
      const keptTools = Array.isArray(state.keptTools) ? state.keptTools : []
      const deniedTools = Array.isArray(state.deniedTools) ? state.deniedTools : []
      const [filter, setFilter] = React.useState('')
      // 【v0.3.0】按"插件"分组，而不是按标签分组 —— 用户想知道的是"哪个插件被砍了"
      const toolOwners = state.toolOwners && typeof state.toolOwners === 'object' ? state.toolOwners : {}
      const deniedByOwner = Array.isArray(state.deniedByOwner) ? state.deniedByOwner : []
      const shown = filter ? deniedTools.filter((name) => toolOwners[name] === filter) : deniedTools
      const hasLists = keptTools.length > 0 || deniedTools.length > 0

      return h('div', {
        style: { ...S.panel, position: 'fixed', left: anchor.left, bottom: anchor.bottom, width: 300 },
        role: 'dialog',
        'data-tg-panel': '1',
        'aria-label': T.active,
        onClick: (e) => e.stopPropagation(),
      },
        h('div', { style: S.header },
          h('span', { style: S.title }, T.active),
          h('span', { style: S.badge }, T.running),
          h('button', { style: S.close, title: T.close, 'aria-label': T.close, onClick: props.onClose }, '✕'),
        ),
        state.goal ? h('div', { style: S.goal }, `${T.goal}${T.colon}${state.goal}`) : null,
        // 给第一次见到它的陌生人一句话说明（分享给别人时尤其重要）
        h('div', { style: { ...S.hint, marginBottom: 10 } }, T.what),
        h('div', { style: S.grid },
          h('div', { style: S.cell },
            h('div', { style: S.cellLabel }, T.removed),
            h('div', { style: S.cellValue, 'data-testid': 'tg-removed' }, String(removed)),
          ),
          h('div', { style: S.cell },
            h('div', { style: S.cellLabel }, T.kept),
            h('div', { style: S.cellValue }, String(kept)),
          ),
        ),
        h('div', { style: S.barRow },
          h('div', { style: S.barLabel },
            h('span', null, T.strength),
            h('span', null, `${Math.round(ratio * 100)}%`),
          ),
          h('div', { style: S.barTrack },
            h('div', { style: { ...S.barFill, width: `${Math.round(ratio * 100)}%` } }),
          ),
        ),
        perTurn > 0
          ? h('div', { style: { marginBottom: 8 } },
              `${T.saving} `,
              h('strong', null, `${fmt(perTurn)} ${T.token}`),
              payback > 0 ? ` · ${T.payback} ${payback} ${T.paybackUnit}` : '',
            )
          : null,
        groups.length > 0
          ? h('div', { style: S.meta },
              h('span', { style: { opacity: 0.65 } }, `${T.groups}${T.colon}`),
              ...groups.map((g) => h('span', { key: g, style: S.chip, title: g }, labelOf(g))),
            )
          : null,
        // ---- 名单区：先看保留（通常 <30 个），再看砍掉（按组过滤 + 滚动列表）----
        hasLists
          ? h('div', null,
              h('div', { style: S.sectionTitle }, `${T.keptTools}（${keptTools.length || kept}）`),
              h('div', { style: S.chipsBox },
                keptTools.length === 0
                  ? h('span', { style: S.hint }, T.empty)
                  : keptTools.map((name) => h('span', { key: name, style: S.chip, title: name }, name)),
              ),
              h('div', { style: S.sectionTitle }, `${T.deniedTools}（${deniedTools.length || removed}）`),
              h('div', { style: S.chipsBox },
                h('span', {
                  key: '__all',
                  style: { ...S.chip, ...S.chipClick, ...(filter ? {} : S.chipActive) },
                  onClick: () => setFilter(''),
                }, `${T.all} ${deniedTools.length}`),
                ...deniedByOwner.map(({ title, count }) =>
                  h('span', {
                    key: title,
                    style: { ...S.chip, ...S.chipClick, ...(filter === title ? S.chipActive : {}) },
                    title: `${title} × ${count}`,
                    onClick: () => setFilter(filter === title ? '' : title),
                  }, `${ownerLabel(title)} ${count}`),
                ),
              ),
              h('div', { style: S.toolList },
                shown.length === 0
                  ? h('div', { style: S.toolRow }, T.empty)
                  : shown.slice(0, 400).map((name) =>
                      h('div', { key: name, style: S.toolRow, title: name },
                        h('span', null, name),
                        toolOwners[name]
                          ? h('span', { style: { opacity: 0.45, marginLeft: 8 } }, ownerLabel(toolOwners[name]))
                          : null,
                      ),
                    ),
              ),
            )
          : h('div', { style: S.sectionTitle }, T.none),
        // 状态是磁盘上的快照：写得很久以前就可能是过期数据（进程重启/任务没正常结束）
        staleAge(state) ? h('div', { style: { ...S.hint, color: '#d97706', marginBottom: 6 } },
          T.stale.replace('{age}', staleAge(state))) : null,
        h('div', { style: S.hint }, T.hint),
      )
    }

    function Badge() {
      const [state, setState] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const wrapRef = React.useRef(null)

      /** 开关面板：打开前先量出胶囊的位置，面板用 fixed 贴在它上方 */
      const toggle = () => {
        if (open) {
          setOpen(false)
          return
        }
        try {
          const rect = wrapRef.current.getBoundingClientRect()
          setAnchor({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
            bottom: window.innerHeight - rect.top + 8,
          })
        } catch {
          setAnchor({ left: 12, bottom: 80 })
        }
        setOpen(true)
      }

      // 轮询 + 关闭交互（点外面 / Esc）——全部在 unmount 时清理
      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          try {
            const response = await fetch(ENDPOINT, { cache: 'no-store' })
            const data = await response.json()
            if (alive) setState(data)
          } catch {
            if (alive) setState({ active: false })
          }
        }
        tick()
        const timer = setInterval(tick, POLL_MS)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
          // 点面板自身不算"点外面"（面板是 fixed 定位，不在 wrapRef 里面）
          const target = event && event.target
          if (target && typeof target.closest === 'function' && target.closest('[data-tg-panel]')) return
          if (wrapRef.current && !wrapRef.current.contains(target)) setOpen(false)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('mousedown', onDown)
          document.removeEventListener('keydown', onKey)
        }
      }, [open])

      // 第一次还没回来 → 不占位，避免闪烁
      if (state === null) return null

      if (!state.active) {
        return h('span', { style: { ...S.pill, cursor: 'default', opacity: 0.55, border: 'none', background: 'transparent' } },
          h('span', { style: { ...S.dot, background: '#9ca3af' } }),
          h('span', { style: S.mellow }, T.inactive),
        )
      }

      const removed = Number(state.denyCount) || 0
      const perTurn = Number(state.savingsPerTurn) || 0
      const groups = Array.isArray(state.groups) && state.groups.length > 0 ? state.groups.map(labelOf).join(' + ') : '—'

      return h('span', { style: S.wrap, ref: wrapRef },
        h('span', {
          style: S.pill,
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open,
          title: `${T.active} · ${groups}`,
          onClick: toggle,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle()
            }
          },
        },
          h('span', { style: { ...S.dot, background: '#22c55e' } }),
          h('span', { style: S.label }, `${T.active} · ${groups}`),
          h('span', { style: S.mellow }, `−${removed}`),
          perTurn > 0 ? h('span', { style: S.mellow }, `${T.saving} ${fmt(perTurn)}`) : null,
        ),
        open ? h(Panel, { state, anchor, onClose: () => setOpen(false) }) : null,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'task-guard', order: 2 },
            Badge,
          ),
        )
      },
    }
  },
})
