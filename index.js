/**
 * ============================================================================
 * dsh-task-guard-badge · Host 半边
 * ============================================================================
 * 三件事：
 *   1. GET  /task-guard/state   一次性完整状态（JSON）
 *   2. GET  /task-guard/stream  SSE，每 2 秒推一帧（断开由浏览器重连）
 *   3. POST /task-guard/action  手动收窄/恢复：写请求文件，由 task-guard 消费
 *
 * 组装状态的逻辑在 lib/state.js（可单测），这里只管 HTTP。
 * ============================================================================
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildState } from './lib/state.js'

export const name = 'task-guard-badge'
export const inject = ['webServer']

const STATE_DIR = join(homedir(), '.dsh', 'task-guard')
const ROUTER_DIR = join(homedir(), '.dsh', 'minimal-router')
const FILES = {
  stateFile: join(STATE_DIR, 'current.json'),
  registryFile: join(STATE_DIR, 'tool-registry.json'),
  requestFile: join(STATE_DIR, 'request.json'),
  resultFile: join(STATE_DIR, 'request-result.json'),
  activityFile: join(ROUTER_DIR, 'activity.jsonl'),
  probeFile: join(ROUTER_DIR, 'usage.jsonl'),
}
const PROFILE_DIR = join(homedir(), '.dsh', 'profiles', process.env.DSH_PROFILE || 'desktop')

/** 读上一次动作的结果（UI 用来显示"成功/失败原因"） */
function lastActionResult() {
  try {
    if (!existsSync(FILES.resultFile)) return null
    return JSON.parse(readFileSync(FILES.resultFile, 'utf8'))
  } catch {
    return null
  }
}

/** 组装状态：复用可测的 buildState，再补一个"上一次动作" */
function snapshot() {
  const state = buildState({ ...FILES, profileDir: PROFILE_DIR })
  const action = lastActionResult()
  if (action && typeof action === 'object') state.lastAction = action
  return state
}

/** 读请求体（限制大小，防止被塞大文件） */
function readBody(request, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        request.destroy()
        resolve('')
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve(''))
  })
}

export function apply(ctx, config = {}) {
  const routePath = typeof config.routePath === 'string' && config.routePath.startsWith('/') ? config.routePath : '/task-guard/state'
  const base = routePath.endsWith('/state') ? routePath.slice(0, -'/state'.length) : routePath
  const streamPath = `${base}/stream`
  const actionPath = `${base}/action`
  const pushMs = Number.isFinite(config.pushMs) ? Math.max(1000, Math.trunc(config.pushMs)) : 2000

  // 1) 一次性状态
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: routePath,
      handler(_request, response) {
        let body = '{}'
        try {
          body = JSON.stringify(snapshot())
        } catch (error) {
          body = JSON.stringify({ active: false, error: String((error && error.message) || error) })
        }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(body)
      },
    }),
  )

  // 2) SSE 推送
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
            response.write(`data: ${JSON.stringify(snapshot())}\n\n`)
          } catch {
            // 对端断开
          }
        }
        send()
        const timer = setInterval(send, pushMs)
        const stop = () => clearInterval(timer)
        request.on('close', stop)
        response.on('close', stop)
        if (typeof response.setTimeout === 'function') response.setTimeout(0)
      },
    }),
  )

  // 3) 手动动作：写请求文件，由 task-guard 在下一次工具调用前消费
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: actionPath,
      handler: async (request, response) => {
        const reply = (code, payload) => {
          response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(JSON.stringify(payload))
        }
        if (request.method !== 'POST') return reply(405, { ok: false, error: 'use POST' })
        const text = await readBody(request)
        let payload = {}
        try {
          payload = JSON.parse(text || '{}')
        } catch {
          return reply(400, { ok: false, error: 'invalid JSON' })
        }
        const action = payload && typeof payload.action === 'string' ? payload.action : ''
        if (action !== 'start' && action !== 'end') return reply(400, { ok: false, error: 'action must be start|end' })
        const groups = Array.isArray(payload.groups) ? payload.groups.filter((g) => typeof g === 'string' && g).slice(0, 40) : []
        if (action === 'start' && groups.length === 0) return reply(400, { ok: false, error: 'start requires groups' })
        const request_id = randomUUID()
        try {
          writeFileSync(
            FILES.requestFile,
            JSON.stringify({ id: request_id, action, groups, ts: Date.now() }),
            'utf8',
          )
        } catch (error) {
          return reply(500, { ok: false, error: `write failed: ${String((error && error.message) || error)}` })
        }
        return reply(200, {
          ok: true,
          id: request_id,
          note: '请求已排队，会在下一次工具调用前生效（通常就是这一轮）。',
        })
      },
    }),
  )
}
