/**
 * ============================================================================
 * test/state.test.mjs —— lib/state.js 的第一批测试
 * ============================================================================
 * 为什么先测这一层：它是"磁盘 → UI 状态"的唯一通道，之前一个测试都没有，
 * 而 v0.5.2 之前的三个 bug（旧阶段、239/274 口径、registered 缺失）全在这一层。
 * ============================================================================
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readTail, parseLines, recentEvents, probeInfo, readRegistry, readMode, buildState, STAGE_FRESH_MS } from '../lib/state.js'

const NOW = 1_800_000_000_000

function withTemp(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'tgbadge-'))
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content, 'utf8')
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('parseLines：坏行跳过，空行忽略', () => {
  const rows = parseLines('{"a":1}\n\nnot json\n{"b":2}\n')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].a, 1)
  assert.equal(rows[1].b, 2)
})

test('readTail：小文件整读（不丢第一行）', () => {
  withTemp({ 'log.jsonl': '{"a":1}\n{"a":2}\n' }, (dir) => {
    const text = readTail(join(dir, 'log.jsonl'))
    assert.equal(parseLines(text).length, 2)
  })
})

test('readTail：大文件只读尾部，且丢掉被截断的首行', () => {
  const lines = []
  for (let i = 0; i < 4000; i += 1) lines.push(JSON.stringify({ i, pad: 'x'.repeat(50) }))
  withTemp({ 'big.jsonl': lines.join('\n') }, (dir) => {
    const text = readTail(join(dir, 'big.jsonl'), 8 * 1024)
    const rows = parseLines(text)
    assert.ok(rows.length > 0, '应该读到一些行')
    assert.ok(rows.length < 4000, '不该整读')
    // 每一行都必须是完整 JSON（首行被截断时已丢弃）
    assert.equal(rows[rows.length - 1].i, 3999, '最后一行必须是最新的')
  })
})

test('readTail：文件不存在返回空串', () => {
  assert.equal(readTail(join(tmpdir(), 'definitely-not-here.jsonl')), '')
})

test('recentEvents：新的在前、限制条数、字段收敛', () => {
  const rows = [
    { t: 1, kind: 'switch', from: 'auto', to: 'art' },
    { t: 2, kind: 'restrict', stage: 'art', deny: 12 },
    { t: 3, kind: 'deny', tool: 'x', stage: 'art' },
    { notKind: true },
  ]
  const out = recentEvents(rows, 2)
  assert.equal(out.length, 2)
  assert.equal(out[0].kind, 'deny', '最新的一条在最前')
  assert.equal(out[1].kind, 'restrict')
  assert.equal(out[0].tool, 'x')
  assert.equal(out[1].deny, 12)
  // 字段缺失时给中性默认值，不能是 undefined（否则 JSON 里字段消失）
  assert.equal(out[0].from, '')
  assert.equal(out[1].kw, '')
})

test('probeInfo：10 分钟内的阶段算"新鲜"，超时不给阶段', () => {
  const fresh = probeInfo([{ at: NOW - 60_000, stage: 'unity-ui', tools: 176, toolsChars: 124171 }], { now: NOW })
  assert.equal(fresh.stage, 'unity-ui')
  assert.ok(fresh.stageAt > 0)
  assert.equal(fresh.tools, 176)

  const stale = probeInfo([{ at: NOW - STAGE_FRESH_MS - 1000, stage: 'art', tools: 200 }], { now: NOW })
  assert.equal(stale.stage, '', '过期记录不能当作当前阶段')
  assert.equal(stale.stageAt, 0)
  assert.equal(stale.tools, 200, '但工具数仍然可用')
})

test('probeInfo：空记录返回结构化默认值', () => {
  const info = probeInfo([], { now: NOW })
  assert.equal(info.stage, '')
  assert.equal(info.tools, 0)
  assert.deepEqual(info.recent, [])
})

test('readRegistry：count 缺失时回退到 tools.length；文件坏了返回空', () => {
  withTemp({ 'reg.json': JSON.stringify({ tools: ['a_x', 'b_y'] }) }, (dir) => {
    const reg = readRegistry(join(dir, 'reg.json'))
    assert.equal(reg.count, 2)
    assert.deepEqual(reg.tools, ['a_x', 'b_y'])
  })
  withTemp({ 'bad.json': '{not json' }, (dir) => {
    const reg = readRegistry(join(dir, 'bad.json'))
    assert.equal(reg.count, 0)
    assert.deepEqual(reg.tools, [])
  })
  assert.equal(readRegistry(join(tmpdir(), 'nope.json')).count, 0)
})

test('buildState：空态下用 registry 补工具数，并给出分组清单', () => {
  withTemp(
    {
      'current.json': JSON.stringify({ active: false, denyCount: 219, keptCount: 20 }),
      'reg.json': JSON.stringify({ count: 3, tools: ['unity_a', 'unity_b', 'screen_shot'] }),
    },
    (dir) => {
      const state = buildState({
        stateFile: join(dir, 'current.json'),
        registryFile: join(dir, 'reg.json'),
        now: NOW,
      })
      assert.equal(state.active, false)
      assert.equal(state.registeredTools, 3)
      assert.equal(state.knownTools, 3, '空态也要知道工具表多大')
      assert.equal(state.groups.length, 2)
      assert.deepEqual(state.groups[0], { tag: 'unity', count: 2 })
      assert.equal(state.toolsCount, 3, '没有探针数据时退回注册数')
    },
  )
})

test('buildState：有探针时 toolsCount 用真实发出数（口径统一）', () => {
  withTemp(
    {
      'current.json': JSON.stringify({ active: false }),
      'reg.json': JSON.stringify({ count: 239, tools: [] }),
      'probe.jsonl': `${JSON.stringify({ at: NOW - 1000, stage: 'auto', tools: 274, toolsChars: 240981 })}\n`,
    },
    (dir) => {
      const state = buildState({
        stateFile: join(dir, 'current.json'),
        registryFile: join(dir, 'reg.json'),
        probeFile: join(dir, 'probe.jsonl'),
        now: NOW,
      })
      assert.equal(state.registeredTools, 239)
      assert.equal(state.probe.tools, 274)
      assert.equal(state.toolsCount, 274, 'UI 默认显示真实发出数，避免同一面板两个数字')
      assert.equal(state.stage, 'auto')
    },
  )
})

test('readMode：auto 才返回 auto，其它一律 manual（保守）', () => {
  withTemp({ 'mode.json': JSON.stringify({ mode: 'auto' }) }, (dir) => {
    assert.equal(readMode(join(dir, 'mode.json')), 'auto')
  })
  withTemp({ 'mode.json': JSON.stringify({ mode: 'manual' }) }, (dir) => {
    assert.equal(readMode(join(dir, 'mode.json')), 'manual')
  })
  withTemp({ 'mode.json': JSON.stringify({ mode: 'weird' }) }, (dir) => {
    assert.equal(readMode(join(dir, 'mode.json')), 'manual', '未知值不能当 auto')
  })
  withTemp({ 'mode.json': '{broken' }, (dir) => {
    assert.equal(readMode(join(dir, 'mode.json')), 'manual', '坏文件不能当 auto')
  })
  assert.equal(readMode(join(tmpdir(), 'nope-mode.json')), 'manual', '没有文件默认 manual')
})

test('buildState：带出当前模式', () => {
  withTemp({ 'mode.json': JSON.stringify({ mode: 'auto' }) }, (dir) => {
    const state = buildState({ modeFile: join(dir, 'mode.json'), now: NOW })
    assert.equal(state.mode, 'auto')
  })
})

test('buildState：读不到任何文件也不抛错', () => {
  const state = buildState({ stateFile: join(tmpdir(), 'x1.json'), probeFile: join(tmpdir(), 'x2.jsonl'), now: NOW })
  assert.equal(state.active, false)
  assert.equal(state.history.length, 0)
  assert.equal(state.toolsCount, 0)
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(state))), JSON.stringify(state), '必须是无损 JSON')
})
