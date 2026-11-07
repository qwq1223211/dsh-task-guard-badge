/**
 * ============================================================================
 * dsh-task-guard-badge · Client 半边（浏览器里跑）
 * ============================================================================
 * 形态：底部一枚胶囊 → 点开是一张卡片（三个 tab：概览 / 工具 / 历史）
 *
 * 这一版解决的问题（对照 v0.4.0 的审计结论）：
 *   · 主题适配：不再写死颜色，改用 color-mix(currentColor) + 系统色，深浅主题都跟手
 *   · 响应式：宽度 min(360px, 100vw - 32px)，窄屏不溢出
 *   · 找得到东西：工具页有搜索框，按插件折叠成树
 *   · 有层次：环形进度 + 大数字 + 迷你柱状图 + 事件流
 *   · 少延迟：优先用 SSE 推送，断了自动退回轮询
 *
 * 纪律：
 *   1. 工厂函数不做副作用，只在 render / effect 里干活
 *   2. 定时器、EventSource 必须在 unmount 时清掉
 *   3. 所有颜色都从 currentColor 派生，不假设浅色或深色
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-guard-badge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ENDPOINT = '/task-guard/state'
    const STREAM = '/task-guard/stream'
    const ACTION = '/task-guard/action'
    const POLL_MS = 4000

    // ---------------------------------------------------------------------
    // 文案
    // ---------------------------------------------------------------------
    const COPY = {
      zh: {
        title: '任务收窄',
        running: '收窄中',
        off: '未开启',
        fullTable: '工具表：全开',
        what: '只保留任务需要的工具，其余从工具表里摘掉——省的是每轮都要付的声明开销。',
        tabOverview: '概览',
        tabTools: '工具',
        tabHistory: '历史',
        removed: '摘掉',
        kept: '保留',
        strength: '收窄强度',
        saving: '每轮省',
        payback: '回本',
        turns: '轮',
        token: 'token',
        stage: '最近请求的阶段',
        noStage: '还没有请求记录',
        toolsNow: '工具表大小',
        groups: '保留范围',
        goal: '目标',
        search: '搜索工具名或插件…',
        allOwners: '全部',
        keptTools: '保留的工具',
        removedTools: '砍掉的工具',
        empty: '（没有）',
        noMatch: '没有匹配的工具',
        expand: '展开',
        collapse: '收起',
        historyEmpty: '还没有事件记录',
        refresh: '刷新',
        close: '关闭',
        hintEnd: '想恢复全部工具：说「结束任务」或调用 task_end',
        stale: '这个状态可能已过期（{age} 前写入）',
        unknownOwner: '未识别来源',
        eventSwitch: '切阶段',
        eventBlock: '闸门拦截',
        eventDeny: '调用被拦',
        eventRestrict: '改工具表',
        eventGrant: '临时放开',
        eventReset: '复位',
        eventDegrade: '降级',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
        manualTitle: '手动调工具表',
        manualHint: '点这里：选工具组 → 收窄；或一键恢复',
        pickGroups: '选要保留的工具组（不选=全部保留）',
        applyNarrow: '收窄到所选',
        endTask: '结束任务（恢复全部工具）',
        queued: '已排队：下一次工具调用前生效',
        failed: '失败',
        lastAction: '上一次动作',
        selectAll: '全选',
        clearAll: '清空',
        registered: '注册',
        actualSent: '实发',
        modeAuto: '自动（AI 决定）',
        modeManual: '手动',
        modeHintAuto: 'AI 会在需要时自己收窄工具表',
        modeHintManual: '由你选组收窄',
        modeNoteAuto: '自动模式下：提示词会告诉 AI"你自己决定工具表"，它会在需要时调用 route_use / task_start。',
        modeNoteManual: '手动模式下：只有你点按钮或调用工具时才会改工具表。',
      },
      en: {
        title: 'Task narrowing',
        running: 'active',
        off: 'off',
        fullTable: 'Tools: full table',
        what: 'Only the tools this task needs stay available; the rest leave the tool table, saving the per-turn declaration cost.',
        tabOverview: 'Overview',
        tabTools: 'Tools',
        tabHistory: 'History',
        removed: 'Removed',
        kept: 'Kept',
        strength: 'Narrowing',
        saving: 'Saved / turn',
        payback: 'Payback',
        turns: 'turns',
        token: 'token',
        stage: 'Last request stage',
        noStage: 'no request recorded yet',
        toolsNow: 'Tool table',
        groups: 'Scope',
        goal: 'Goal',
        search: 'Search a tool or plugin…',
        allOwners: 'All',
        keptTools: 'Kept tools',
        removedTools: 'Removed tools',
        empty: '(none)',
        noMatch: 'No matching tool',
        expand: 'Expand',
        collapse: 'Collapse',
        historyEmpty: 'No events yet',
        refresh: 'Refresh',
        close: 'Close',
        hintEnd: 'To restore every tool: say "end the task" or call task_end',
        stale: 'This state may be stale (written {age} ago)',
        unknownOwner: 'Unknown source',
        eventSwitch: 'stage switch',
        eventBlock: 'gate blocked',
        eventDeny: 'call denied',
        eventRestrict: 'tool table',
        eventGrant: 'granted',
        eventReset: 'reset',
        eventDegrade: 'degraded',
        justNow: 'just now',
        minutesAgo: '{n}m ago',
        hoursAgo: '{n}h ago',
        daysAgo: '{n}d ago',
        manualTitle: 'Adjust the tool table',
        manualHint: 'Click to pick groups, narrow, or restore',
        pickGroups: 'Keep these groups (none selected = keep everything)',
        applyNarrow: 'Narrow to selection',
        endTask: 'End task (restore all tools)',
        queued: 'Queued: takes effect before the next tool call',
        failed: 'failed',
        lastAction: 'Last action',
        selectAll: 'All',
        clearAll: 'Clear',
        registered: 'registered',
        actualSent: 'sent',
        modeAuto: 'Auto (AI decides)',
        modeManual: 'Manual',
        modeHintAuto: 'The AI narrows the tool set itself when needed',
        modeHintManual: 'You pick the groups',
        modeNoteAuto: 'Auto mode: the prompt tells the model "you decide the tool set", so it will call route_use / task_start when it matters.',
        modeNoteManual: 'Manual mode: the tool table only changes when you click a button or call a tool.',
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

    // ---------------------------------------------------------------------
    // 颜色：全部从 currentColor 派生，深浅主题都跟手
    // ---------------------------------------------------------------------
    const SUPPORTS_MIX = (() => {
      try {
        return typeof CSS !== 'undefined' && CSS.supports && CSS.supports('color', 'color-mix(in srgb, red 10%, transparent)')
      } catch {
        return false
      }
    })()
    /** 用当前文字色的 p% 做一层底色/边框（不支持 color-mix 就退回中性灰） */
    const tint = (pct) => (SUPPORTS_MIX ? `color-mix(in srgb, currentColor ${pct}%, transparent)` : `rgba(127,127,127,${pct / 100})`)
    const ACCENT = '#22c55e'
    const ACCENT_SOFT = SUPPORTS_MIX ? 'color-mix(in srgb, #22c55e 18%, transparent)' : 'rgba(34,197,94,0.18)'
    const WARN = '#d97706'
    const MUTED = SUPPORTS_MIX ? 'color-mix(in srgb, currentColor 55%, transparent)' : 'rgba(127,127,127,0.75)'

    // ---------------------------------------------------------------------
    // 格式化
    // ---------------------------------------------------------------------
    function fmt(n) {
      const v = Number(n) || 0
      if (v >= 1e6) return `${Math.round(v / 1e5) / 10}M`
      if (v >= 1000) return `${Math.round(v / 100) / 10}K`
      return String(v)
    }
    function ageText(at) {
      const ms = Date.now() - (Number(at) || 0)
      if (!Number.isFinite(ms) || ms < 0) return ''
      const min = Math.round(ms / 60000)
      if (min < 1) return T.justNow
      if (min < 60) return T.minutesAgo.replace('{n}', String(min))
      const hours = Math.round(min / 60)
      if (hours < 48) return T.hoursAgo.replace('{n}', String(hours))
      return T.daysAgo.replace('{n}', String(Math.round(hours / 24)))
    }
    function clockOf(t) {
      try {
        const d = new Date(Number(t) || 0)
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      } catch {
        return ''
      }
    }
    function staleAge(state) {
      const at = Number(state && (state.at || state.startedAt)) || 0
      if (!at) return ''
      const ms = Date.now() - at
      if (ms < 12 * 3600 * 1000) return ''
      const hours = Math.round(ms / 3600000)
      return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
    }
    function ownerLabel(title) {
      if (title === '(未归属)') return T.unknownOwner
      return title || T.unknownOwner
    }

    // ---------------------------------------------------------------------
    // 样式（全部从 tint() 派生）
    // ---------------------------------------------------------------------
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
        border: `1px solid ${tint(26)}`,
        background: tint(10),
        color: 'inherit',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
      },
      dot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: ACCENT },
      dotOff: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto', background: tint(45) },
      mellow: { opacity: 0.62 },
      panel: {
        position: 'fixed',
        zIndex: 60,
        width: 'min(380px, calc(100vw - 32px))',
        maxHeight: 'min(72vh, 560px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 14,
        border: `1px solid ${tint(24)}`,
        background: 'Canvas',
        color: 'CanvasText',
        boxShadow: '0 12px 36px rgba(0,0,0,0.28)',
        fontSize: 12,
        lineHeight: '18px',
      },
      header: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 8px' },
      title: { fontWeight: 600, fontSize: 13 },
      badge: { marginLeft: 'auto', padding: '1px 8px', borderRadius: 999, fontSize: 11, background: ACCENT_SOFT, color: ACCENT },
      badgeOff: { marginLeft: 'auto', padding: '1px 8px', borderRadius: 999, fontSize: 11, background: tint(14), opacity: 0.7 },
      close: { border: 'none', background: 'transparent', color: 'inherit', opacity: 0.5, cursor: 'pointer', fontSize: 14, lineHeight: '14px', padding: 2 },
      tabs: { display: 'flex', gap: 4, padding: '0 10px 8px', borderBottom: `1px solid ${tint(14)}` },
      tab: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: '4px 10px', borderRadius: 8, fontSize: 12, opacity: 0.6 },
      tabActive: { background: tint(12), opacity: 1, fontWeight: 500 },
      body: { padding: '12px 14px 14px', overflowY: 'auto' },
      row: { display: 'flex', alignItems: 'center', gap: 8 },
      sectionTitle: { fontSize: 11, opacity: 0.6, margin: '12px 0 6px' },
      grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
      cell: { padding: '8px 10px', borderRadius: 10, background: tint(9) },
      cellLabel: { fontSize: 11, opacity: 0.62, marginBottom: 2 },
      cellValue: { fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
      chipsBox: { display: 'flex', flexWrap: 'wrap', gap: 4 },
      chip: { padding: '1px 8px', borderRadius: 999, fontSize: 11, background: tint(14) },
      chipClick: { cursor: 'pointer' },
      chipActive: { background: ACCENT_SOFT, color: ACCENT },
      search: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '5px 10px',
        borderRadius: 8,
        border: `1px solid ${tint(22)}`,
        background: tint(6),
        color: 'inherit',
        fontSize: 12,
        outline: 'none',
      },
      treeGroup: { marginTop: 6 },
      treeHead: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 6px',
        borderRadius: 8,
        cursor: 'pointer',
        background: tint(7),
      },
      treeCount: { marginLeft: 'auto', opacity: 0.6, fontSize: 11 },
      toolList: { marginTop: 4, paddingLeft: 10 },
      toolRow: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: '17px',
        opacity: 0.85,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      eventRow: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', borderBottom: `1px dashed ${tint(12)}` },
      eventKind: { fontSize: 11, padding: '0 6px', borderRadius: 6, background: tint(12) },
      eventTime: { marginLeft: 'auto', opacity: 0.5, fontSize: 11, fontVariantNumeric: 'tabular-nums' },
      hint: { opacity: 0.55, fontSize: 11, lineHeight: '16px' },
      emptyBox: { padding: '10px 0', opacity: 0.6 },
    }

    // ---------------------------------------------------------------------
    // 小组件
    // ---------------------------------------------------------------------
    /** 环形进度 */
    function Ring(props) {
      const ratio = Math.max(0, Math.min(1, Number(props.ratio) || 0))
      const size = props.size || 68
      const stroke = 7
      const r = (size - stroke) / 2
      const c = 2 * Math.PI * r
      return h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, style: { flex: '0 0 auto' } },
        h('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: tint(16), strokeWidth: stroke }),
        h('circle', {
          cx: size / 2,
          cy: size / 2,
          r,
          fill: 'none',
          stroke: ACCENT,
          strokeWidth: stroke,
          strokeLinecap: 'round',
          strokeDasharray: `${c}`,
          strokeDashoffset: `${c * (1 - ratio)}`,
          transform: `rotate(-90 ${size / 2} ${size / 2})`,
          style: { transition: 'stroke-dashoffset 300ms ease' },
        }),
        h('text', {
          x: '50%',
          y: '52%',
          textAnchor: 'middle',
          dominantBaseline: 'middle',
          fill: 'currentColor',
          fontSize: 13,
          fontWeight: 600,
        }, `${Math.round(ratio * 100)}%`),
      )
    }

    /** 迷你柱状图：最近几次请求的工具表大小 */
    function Bars(props) {
      const items = Array.isArray(props.items) ? props.items.filter((x) => Number(x.tools) > 0) : []
      if (items.length === 0) return h('div', { style: S.hint }, T.empty)
      const max = Math.max(...items.map((x) => Number(x.tools) || 0))
      const width = 6
      return h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 34 } },
        ...items.map((item, i) => {
          const value = Number(item.tools) || 0
          const ratio = max > 0 ? value / max : 0
          return h('div', {
            key: i,
            title: `${value} tools · ${fmt(item.toolsChars)} chars`,
            style: {
              width,
              height: `${Math.max(6, Math.round(ratio * 34))}px`,
              borderRadius: 2,
              background: i === items.length - 1 ? ACCENT : tint(34),
            },
          })
        }),
      )
    }

    function Tab(props) {
      return h('button', {
        style: { ...S.tab, ...(props.active ? S.tabActive : {}) },
        onClick: props.onClick,
      }, props.label)
    }

    /** 主按钮 / 次按钮的统一样式 */
    function buttonStyle(primary, disabled) {
      return {
        border: `1px solid ${primary ? ACCENT : tint(26)}`,
        background: primary ? ACCENT_SOFT : tint(8),
        color: 'inherit',
        borderRadius: 8,
        padding: '5px 12px',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 120ms ease, opacity 120ms ease',
      }
    }

    // ---------------------------------------------------------------------
    // 手动调工具表（空态也能用）
    // ---------------------------------------------------------------------
    function ManualView(props) {
      const state = props.state || {}
      const groups = Array.isArray(state.groups) ? state.groups : []
      const [picked, setPicked] = React.useState([])
      const busy = Boolean(props.busy)
      const notice = props.notice || ''
      const lastAction = state.lastAction && typeof state.lastAction === 'object' ? state.lastAction : null

      const toggle = (tag) => {
        setPicked((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]))
      }
      const registered = Number(state.registeredTools) || 0
      const actual = Number(state.probe && state.probe.tools) || 0

      return h('div', null,
        h('div', { style: { ...S.cell, marginBottom: 10 } },
          h('div', { style: S.cellLabel }, T.fullTable),
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, `${Number(state.toolsCount) || 0}`),
          h('div', { style: S.hint },
            registered && actual && registered !== actual
              ? `${T.registered} ${registered} · ${T.actualSent} ${actual}`
              : '',
          ),
        ),
        // 当前模式说明：让"谁来决定"一眼可见
        h('div', { style: { ...S.hint, marginBottom: 8 } }, state.mode === 'auto' ? T.modeNoteAuto : T.modeNoteManual),
        h('div', { style: S.sectionTitle }, T.pickGroups),
        groups.length === 0
          ? h('div', { style: S.hint }, T.empty)
          : h('div', { style: S.chipsBox },
              ...groups.map((group) =>
                h('span', {
                  key: group.tag,
                  style: { ...S.chip, ...S.chipClick, ...(picked.includes(group.tag) ? S.chipActive : {}) },
                  title: `${group.tag} · ${group.count}`,
                  onClick: () => toggle(group.tag),
                }, `${group.tag} ${group.count}`),
              ),
            ),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' } },
          h('button', {
            style: buttonStyle(true, busy || picked.length === 0),
            disabled: busy || picked.length === 0,
            onClick: () => props.onAction && props.onAction({ action: 'start', groups: picked }),
          }, T.applyNarrow),
          h('button', {
            style: buttonStyle(false, busy),
            disabled: busy,
            onClick: () => {
              setPicked([])
              if (props.onAction) props.onAction({ action: 'end' })
            },
          }, T.endTask),
        ),
        notice ? h('div', { style: { ...S.hint, marginTop: 8, color: ACCENT } }, notice) : null,
        lastAction
          ? h('div', { style: { ...S.hint, marginTop: 8 } },
              `${T.lastAction}：${lastAction.action || ''} ${lastAction.ok ? '✓' : `✗ ${lastAction.error || ''}`}`,
            )
          : null,
      )
    }

    // ---------------------------------------------------------------------
    // 概览
    // ---------------------------------------------------------------------
    function OverviewTab(props) {
      const state = props.state || {}
      const removed = Number(state.denyCount) || 0
      const kept = Number(state.keptCount) || 0
      const total = removed + kept
      const ratio = total > 0 ? Math.min(1, removed / total) : 0
      const perTurn = Number(state.savingsPerTurn) || 0
      const payback = Number(state.paybackTurns) || 0
      const groups = Array.isArray(state.groups) ? state.groups : []
      const probe = state.probe || {}
      const recent = Array.isArray(probe.recent) ? probe.recent : []
      const stage = state.stage || ''
      const age = staleAge(state)

      return h('div', null,
        h('div', { style: { ...S.row, gap: 14, marginBottom: 12 } },
          h(Ring, { ratio }),
          h('div', { style: { minWidth: 0 } },
            h('div', { style: S.cellLabel }, T.strength),
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, `${removed} / ${total}`),
            h('div', { style: S.hint }, perTurn > 0 ? `${T.saving} ${fmt(perTurn)} ${T.token}` : '—'),
          ),
        ),
        h('div', { style: S.grid2 },
          h('div', { style: S.cell },
            h('div', { style: S.cellLabel }, T.removed),
            h('div', { style: S.cellValue }, String(removed)),
          ),
          h('div', { style: S.cell },
            h('div', { style: S.cellLabel }, T.kept),
            h('div', { style: S.cellValue }, String(kept)),
          ),
        ),
        h('div', { style: S.sectionTitle }, T.toolsNow),
        h('div', { style: S.row },
          h(Bars, { items: recent }),
          h('div', { style: { marginLeft: 'auto', textAlign: 'right' } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, probe.tools ? String(probe.tools) : '—'),
            h('div', { style: S.hint }, probe.toolsChars ? `${fmt(probe.toolsChars)} chars` : ''),
          ),
        ),
        h('div', { style: S.sectionTitle }, T.stage),
        h('div', { style: S.row },
          stage ? h('span', { style: { ...S.chip, background: ACCENT_SOFT, color: ACCENT } }, stage) : h('span', { style: S.hint }, T.noStage),
          h('span', { style: { marginLeft: 'auto', ...S.hint } }, payback > 0 ? `${T.payback} ${payback} ${T.turns}` : ''),
        ),
        groups.length > 0
          ? h('div', null,
              h('div', { style: S.sectionTitle }, T.groups),
              h('div', { style: S.chipsBox }, ...groups.map((g) => h('span', { key: g, style: S.chip }, g))),
            )
          : null,
        state.goal ? h('div', null, h('div', { style: S.sectionTitle }, T.goal), h('div', { style: S.hint }, state.goal)) : null,
        age ? h('div', { style: { ...S.hint, color: WARN, marginTop: 8 } }, T.stale.replace('{age}', age)) : null,
        h('div', { style: { ...S.hint, marginTop: 10 } }, T.hintEnd),
      )
    }

    // ---------------------------------------------------------------------
    // 工具（搜索 + 按插件折叠）
    // ---------------------------------------------------------------------
    function ToolsTab(props) {
      const state = props.state || {}
      const denied = Array.isArray(state.deniedTools) ? state.deniedTools : []
      const kept = Array.isArray(state.keptTools) ? state.keptTools : []
      const owners = state.toolOwners && typeof state.toolOwners === 'object' ? state.toolOwners : {}
      const [query, setQuery] = React.useState('')
      const [open, setOpen] = React.useState({})

      const q = query.trim().toLowerCase()
      const match = (name) => !q || name.toLowerCase().includes(q) || String(owners[name] || '').toLowerCase().includes(q)
      const shownDenied = denied.filter(match)
      const shownKept = kept.filter(match)

      // 按插件分组
      const groups = new Map()
      for (const tool of shownDenied) {
        const key = ownerLabel(owners[tool])
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(tool)
      }
      const groupList = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)

      return h('div', null,
        h('input', {
          style: S.search,
          placeholder: T.search,
          value: query,
          onChange: (e) => setQuery(e.target.value),
        }),
        h('div', { style: S.sectionTitle }, `${T.keptTools}（${shownKept.length}）`),
        shownKept.length === 0
          ? h('div', { style: S.hint }, q ? T.noMatch : T.empty)
          : h('div', { style: S.chipsBox }, ...shownKept.map((name) => h('span', { key: name, style: S.chip, title: name }, name))),
        h('div', { style: S.sectionTitle }, `${T.removedTools}（${shownDenied.length}）`),
        groupList.length === 0
          ? h('div', { style: S.hint }, q ? T.noMatch : T.empty)
          : h('div', null,
              ...groupList.map(([owner, list]) =>
                h('div', { style: S.treeGroup, key: owner },
                  h('div', {
                    style: S.treeHead,
                    onClick: () => setOpen((prev) => ({ ...prev, [owner]: !prev[owner] })),
                  },
                    h('span', { style: { opacity: 0.55, width: 10 } }, open[owner] ? '▾' : '▸'),
                    h('span', null, owner),
                    h('span', { style: S.treeCount }, String(list.length)),
                  ),
                  open[owner]
                    ? h('div', { style: S.toolList },
                        ...list.map((name) => h('div', { key: name, style: S.toolRow, title: name }, name)),
                      )
                    : null,
                ),
              ),
            ),
      )
    }

    // ---------------------------------------------------------------------
    // 历史
    // ---------------------------------------------------------------------
    const KIND_LABEL = {
      switch: () => T.eventSwitch,
      block: () => T.eventBlock,
      deny: () => T.eventDeny,
      restrict: () => T.eventRestrict,
      grant: () => T.eventGrant,
      reset: () => T.eventReset,
      degrade: () => T.eventDegrade,
    }

    function HistoryTab(props) {
      const state = props.state || {}
      const events = Array.isArray(state.history) ? state.history : []
      if (events.length === 0) return h('div', { style: S.emptyBox }, T.historyEmpty)
      return h('div', null,
        ...events.map((event, i) => {
          const label = KIND_LABEL[event.kind] ? KIND_LABEL[event.kind]() : event.kind
          const detail =
            event.kind === 'switch' || event.kind === 'block'
              ? `${event.from || '?'} → ${event.to || '?'}${event.kw ? `（${event.kw}）` : ''}`
              : event.kind === 'deny'
                ? `${event.tool || ''}${event.stage ? ` @${event.stage}` : ''}`
                : event.kind === 'restrict'
                  ? `${event.stage || ''}${event.deny ? ` −${event.deny}` : ''}`
                  : event.by || ''
          return h('div', { key: i, style: S.eventRow },
            h('span', { style: S.eventKind }, label),
            h('span', { style: { fontSize: 11, opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, detail),
            h('span', { style: S.eventTime }, clockOf(event.t)),
          )
        }),
      )
    }

    // ---------------------------------------------------------------------
    // 面板
    // ---------------------------------------------------------------------
    function Panel(props) {
      const state = props.state || {}
      const anchor = props.anchor || { left: 12, bottom: 80 }
      const [tab, setTab] = React.useState('overview')
      const [visible, setVisible] = React.useState(false)
      const inactive = !state.active

      React.useEffect(() => {
        const id = requestAnimationFrame(() => setVisible(true))
        return () => cancelAnimationFrame(id)
      }, [])

      return h('div', {
        style: {
          ...S.panel,
          left: anchor.left,
          bottom: anchor.bottom,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(6px)',
          transition: 'opacity 120ms ease, transform 120ms ease',
        },
        role: 'dialog',
        'aria-label': T.title,
        'data-tg-panel': '1',
        onClick: (e) => e.stopPropagation(),
      },
        h('div', { style: S.header },
          h('span', { style: S.title }, T.title),
          // 模式开关：auto = 模型自己决定；manual = 人手动选
          h('button', {
            style: { ...S.chip, ...S.chipClick, border: 'none', background: state.mode === 'auto' ? ACCENT_SOFT : tint(14), color: state.mode === 'auto' ? ACCENT : 'inherit' },
            title: state.mode === 'auto' ? T.modeHintAuto : T.modeHintManual,
            onClick: () => props.onAction && props.onAction({ action: 'mode', mode: state.mode === 'auto' ? 'manual' : 'auto' }),
          }, state.mode === 'auto' ? T.modeAuto : T.modeManual),
          h('span', { style: inactive ? S.badgeOff : S.badge }, inactive ? T.off : T.running),
          h('button', { style: S.close, title: T.close, 'aria-label': T.close, onClick: props.onClose }, '✕'),
        ),
        // 空态没有"收窄中/工具/历史"可看，直接给手动控制
        inactive
          ? null
          : h('div', { style: S.tabs },
              h(Tab, { label: T.tabOverview, active: tab === 'overview', onClick: () => setTab('overview') }),
              h(Tab, { label: T.tabTools, active: tab === 'tools', onClick: () => setTab('tools') }),
              h(Tab, { label: T.tabHistory, active: tab === 'history', onClick: () => setTab('history') }),
            ),
        h('div', { style: S.body },
          inactive
            ? h(ManualView, { state, onAction: props.onAction, busy: props.busy, notice: props.notice })
            : tab === 'overview'
              ? h(OverviewTab, { state })
              : tab === 'tools'
                ? h(ToolsTab, { state })
                : h(HistoryTab, { state }),
        ),
        inactive
          ? null
          : h('div', { style: { padding: '0 14px 12px' } },
              h('button', {
                style: buttonStyle(false, props.busy),
                disabled: props.busy,
                onClick: () => props.onAction && props.onAction({ action: 'end' }),
              }, T.endTask),
            ),
      )
    }

    // ---------------------------------------------------------------------
    // 胶囊
    // ---------------------------------------------------------------------
    function Badge() {
      const [state, setState] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const wrapRef = React.useRef(null)

      /** 手动动作：POST 给 host，由它写请求文件；生效在"下一次工具调用前" */
      const runAction = async (payload) => {
        if (!payload || busy) return
        setBusy(true)
        setNotice('')
        try {
          const response = await fetch(ACTION, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const data = await response.json()
          setNotice(data && data.ok ? T.queued : `${T.failed}: ${(data && data.error) || '?'}`)
        } catch (error) {
          setNotice(`${T.failed}: ${String((error && error.message) || error)}`)
        } finally {
          setBusy(false)
        }
      }

      // 数据：优先 SSE，失败/卡住就退回轮询
      React.useEffect(() => {
        let alive = true
        let es = null
        let timer = null
        let watchdog = null
        let lastFrame = 0
        const apply = (data) => {
          if (alive && data && typeof data === 'object') setState(data)
        }
        const startPolling = () => {
          if (timer || !alive) return
          const tick = async () => {
            try {
              const response = await fetch(ENDPOINT, { cache: 'no-store' })
              apply(await response.json())
            } catch {
              /* 网络抖动忽略 */
            }
          }
          tick()
          timer = setInterval(tick, POLL_MS)
        }
        const stopStream = () => {
          if (!es) return
          try {
            es.close()
          } catch {
            /* ignore */
          }
          es = null
        }
        try {
          if (typeof EventSource === 'function') {
            es = new EventSource(STREAM)
            es.onmessage = (event) => {
              lastFrame = Date.now()
              try {
                apply(JSON.parse(event.data))
              } catch {
                /* 坏帧忽略 */
              }
            }
            es.onerror = () => {
              // 规范里 CONNECTING(0) 表示"正在重连"，只有 CLOSED(2) 才是真断
              if (es && es.readyState === 2) {
                stopStream()
                startPolling()
              }
            }
            lastFrame = Date.now()
            // 看门狗：连上了但 6 秒没帧（服务端卡死 / 代理吞流）→ 退回轮询
            watchdog = setInterval(() => {
              if (!alive) return
              if (es && Date.now() - lastFrame > 6000) {
                stopStream()
                startPolling()
              }
            }, 3000)
          } else {
            startPolling()
          }
        } catch {
          startPolling()
        }
        return () => {
          alive = false
          stopStream()
          if (timer) clearInterval(timer)
          if (watchdog) clearInterval(watchdog)
        }
      }, [])

      // 点外面 / Esc 关闭
      React.useEffect(() => {
        if (!open) return undefined
        const onDown = (event) => {
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

      const toggle = () => {
        if (open) {
          setOpen(false)
          return
        }
        try {
          const rect = wrapRef.current.getBoundingClientRect()
          setAnchor({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - 396)),
            bottom: window.innerHeight - rect.top + 8,
          })
        } catch {
          setAnchor({ left: 12, bottom: 80 })
        }
        setOpen(true)
      }

      if (state === null) return null

      // 空态：说清"它在看什么"，并且**可以点开手动调工具表**
      if (!state.active) {
        const known = Number(state.toolsCount) || Number(state.knownTools) || 0
        return h('span', { style: S.wrap, ref: wrapRef },
          h('span', {
            style: { ...S.pill, background: 'transparent', border: `1px dashed ${tint(22)}`, opacity: 0.9 },
            role: 'button',
            tabIndex: 0,
            'aria-expanded': open,
            title: T.manualHint,
            onClick: toggle,
            onKeyDown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                toggle()
              }
            },
            onFocus: (e) => {
              e.currentTarget.style.boxShadow = `0 0 0 2px ${ACCENT_SOFT}`
            },
            onBlur: (e) => {
              e.currentTarget.style.boxShadow = 'none'
            },
          },
            h('span', { style: S.dotOff }),
            h('span', { style: S.mellow }, `${T.fullTable}${known > 0 ? `（${known}）` : ''}`),
            h('span', { style: { opacity: 0.45, fontSize: 11 } }, '▾'),
          ),
          open ? h(Panel, { state, anchor, onClose: () => setOpen(false), onAction: runAction, busy, notice }) : null,
        )
      }

      const removed = Number(state.denyCount) || 0
      const perTurn = Number(state.savingsPerTurn) || 0
      const groups = Array.isArray(state.groups) && state.groups.length > 0 ? state.groups.join(' + ') : '—'
      const stage = state.stage || ''

      return h('span', { style: S.wrap, ref: wrapRef },
        h('span', {
          style: S.pill,
          role: 'button',
          tabIndex: 0,
          'aria-expanded': open,
          title: `${T.title} · ${groups}`,
          onClick: toggle,
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggle()
            }
          },
          onFocus: (e) => {
            e.currentTarget.style.boxShadow = `0 0 0 2px ${ACCENT_SOFT}`
          },
          onBlur: (e) => {
            e.currentTarget.style.boxShadow = 'none'
          },
        },
          h('span', { style: S.dot }),
          h('span', { style: { fontWeight: 500 } }, stage ? `${stage}` : groups),
          h('span', { style: S.mellow }, `−${removed}`),
          perTurn > 0 ? h('span', { style: S.mellow }, `${T.saving} ${fmt(perTurn)}`) : null,
        ),
        open ? h(Panel, { state, anchor, onClose: () => setOpen(false), onAction: runAction, busy, notice }) : null,
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
