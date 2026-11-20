/**
 * 大纲共写 Host 半：共写目录服务 + 系统提示注入 + 面板接口。
 */
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { createStore, safeRel } from './lib/files.js'
import { scaffold } from './lib/scaffold.js'
import { writeStart } from './lib/start.js'
import { registerCoeditTools, toolStatus } from './lib/tools.js'

const HOME_DIR = process.env.USERPROFILE || process.env.HOME || homedir()
const BASE = '/dsh-outline-coedit'
const VERSION = '0.4.2'
const SECTION_NAME = 'outline-coedit'
const SECTION_ORDER = 860

// tools 不写进 inject：DSH 版本不同可能没有这个服务，缺了不该拖垮整个插件。
export const inject = ['webServer', 'systemPrompt']

export function apply(ctx, config) {
  const settings = config || {}

  const configuredDir = typeof settings.dir === 'string' && settings.dir.trim() !== ''
    ? path.resolve(settings.dir.trim())
    : null
  const coeditRoot = (workspaceRoot) => configuredDir || path.resolve(workspaceRoot)

  /**
   * 共写目录解析顺序：
   *   1. 这个工作区自己的记录（界面里切过）
   *   2. 工作区根本身（用户选了哪个文件夹就用哪个，不再套一层 coedit/）
   *   3. 插件配置的 dir（显式兜底，仅当拿不到工作区）
   */
  const resolveDir = (workspaceRoot) => {
    if (workspaceRoot && isPlausibleWorkspace(workspaceRoot)) {
      const chosen = overridesFor(workspaceRoot)[workspaceRoot]
      if (typeof chosen === 'string' && chosen.trim() !== '' && existsSync(chosen)) return path.resolve(chosen.trim())
      return path.resolve(workspaceRoot)
    }
    // 拿不到工作区时，用最近一次选择的目录，而不是报错。
    const latest = readSettings().latestDir
    if (typeof latest === 'string' && latest.trim() !== '' && existsSync(latest)) return path.resolve(latest.trim())
    if (configuredDir) return configuredDir
    return null
  }

  /** 在某个共写目录上开 store，并把当前目录记进指针文件。 */
  const storeAt = (target, workspaceRoot) => {
    try { writeFileSync(CURRENT_FILE, target + '\n', 'utf8') } catch { /* 忽略 */ }
    // 老目录可能没有 START.txt，这里补一份，保证 AI 一定读得到规则。
    try {
      if (existsSync(target) && !existsSync(path.join(target, 'START.txt'))) writeStart(target)
    } catch { /* 忽略 */ }
    return createStore(target, { workspace: workspaceRoot ? path.resolve(workspaceRoot) : null })
  }

  const storeOf = (workspaceRoot) => {
    const target = resolveDir(workspaceRoot)
    if (!target) {
      const error = new Error('拿不到当前工作区。请在侧栏里手动指定共写目录。')
      error.code = 'no-workspace'
      throw error
    }
    return storeAt(target, workspaceRoot)
  }

  /**
   * 工具调用没有 HTTP request，拿不到 ws 参数。所以按"侧栏里最近选过的目录"来定，
   * 并且用请求里的文件名反过来验证：哪个候选目录里真有这个文件，就用哪个。
   * 候选顺序：latestDir（用户刚在面板里点开的那本）→ 配置的 dir → 各工作区记过的选择 → 指针文件。
   */
  const toolTarget = (rel) => {
    const s = readSettings()
    const map = s.workspaces && typeof s.workspaces === 'object' ? s.workspaces : {}
    const candidates = []
    const push = (p) => {
      if (typeof p !== 'string' || p.trim() === '') return
      const r = path.resolve(p.trim())
      if (existsSync(r) && !candidates.includes(r)) candidates.push(r)
    }
    push(s.latestDir)
    push(s.dir)
    for (const v of Object.values(map)) push(v)
    const ws = recall()
    if (ws) { push(map[ws]); push(ws) }
    if (candidates.length === 0) return null

    let dir = candidates[0]
    if (typeof rel === 'string' && rel.trim() !== '') {
      const hit = candidates.find((d) => {
        try { return existsSync(path.join(d, rel)) } catch { return false }
      })
      if (hit) dir = hit
    }
    // 反查这个目录注册在哪个工作区名下，备份就跟着工作区走。
    let workspace = null
    for (const [k, v] of Object.entries(map)) {
      if (typeof v === 'string' && path.resolve(v) === dir) { workspace = k; break }
    }
    return { dir, workspace: workspace || dir }
  }

  // 这段文本必须逐字节稳定，否则会击穿 prompt 缓存。
  if (settings.injectPrompt !== false) {
    const promptService = ctx.get?.('systemPrompt') ?? ctx.systemPrompt
    if (promptService && typeof promptService.section === 'function') {
      ctx.effect(() => promptService.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
                                                        text: () => [
            "共写 mode。工具 coedit_read / coedit_write（必须填 confirm=用户原话）。",
            "版本、文件增减、内容取舍都属于人类。不要回滚、不要挑备份、不要新建或删除文件、不要替用户判断意图。",
            "没有明确指令就不动手；不确定就问一句。不列计划、不通读全章、不写总结报告。",
            "纯文本 .txt；锁区 [[COEDIT:LOCK_START]]…[[COEDIT:LOCK_END]] 一字不动。",
        ].join("\n"),
      }))
    }
  }

  // 原生工具：拿不到 tools 服务就跳过，不影响其余功能。
  try {
    ctx.effect(() => {
      try {
        registerCoeditTools(ctx, {
          store: (rel) => {
            const t = toolTarget(rel)
            if (!t) {
              const error = new Error('找不到共写目录：请先在侧栏打开共写面板，或手动指定目录。')
              error.code = 'no-workspace'
              throw error
            }
            return storeAt(t.dir, t.workspace)
          },
          writeStart,
        })
      } catch (error) {
        toolStatus.error = String(error && error.message ? error.message : error)
        ctx.logger?.warn?.('[outline-coedit] 工具注册失败（不影响侧栏）：' + toolStatus.error)
      }
    }, 'outline-coedit: tools')
  } catch (error) {
    ctx.logger?.warn?.('[outline-coedit] 工具注册跳过：' + (error && error.message ? error.message : error))
  }

  const server = ctx.get?.('webServer') ?? ctx.webServer
  if (!server || typeof server.register !== 'function') return

  const guard = (req, res, method) => {
    if (req.method !== method) { sendJson(res, 405, { error: 'method-not-allowed' }); return false }
    if (method === 'POST' && req.headers['x-outline-coedit'] !== '1') {
      sendJson(res, 403, { error: 'forbidden' }); return false
    }
    return true
  }

  const pending = []
  const register = (route, handler) => {
    if (pending.some((p) => p.route === route)) {
      ctx.logger?.warn?.('[outline-coedit] 重复路由已忽略: ' + route)
      return
    }
    pending.push({ route, handler })
  }

  const carets = new Map()

  register('/ping', async (req, res) => {
    sendJson(res, 200, { ok: true, version: VERSION, pid: process.pid, configuredDir, routes: pending.map((p) => p.route) })
  })

  register('/state', async (req, res) => {
    if (!guard(req, res, 'GET')) return
    try {
      const store = storeOf(workspaceOf(req, settings))
      store.ensureDirs()
      const snapshot = store.state()
      snapshot.hasStart = existsSync(path.join(store.root, 'START.txt'))
      sendJson(res, 200, snapshot)
    } catch (error) {
      sendJson(res, error && error.code === 'no-workspace' ? 409 : 500, { error: (error && error.code) || 'state-failed', message: messageOf(error) })
    }
  })

  // 自检：插件到底有没有把 coedit_* 工具递给 AI。AI 说"没有这个工具"时先看这里。
  register('/diag', async (req, res) => {
    if (!guard(req, res, 'GET')) return
    sendJson(res, 200, {
      version: VERSION,
      tools: {
        service: toolStatus.service,
        source: toolStatus.source,
        registered: toolStatus.registered,
        error: toolStatus.error,
      },
      webRoutes: pending.map((p) => p.route),
    })
  })

  register('/file', async (req, res) => {
    if (!guard(req, res, 'GET')) return
    try {
      const url = new URL(req.url || '', 'http://localhost')
      const rel = url.searchParams.get('path')
      const store = storeOf(workspaceOf(req, settings))
      sendJson(res, 200, { path: safeRel(rel), content: store.read(rel), stamp: store.stampOf(rel) })
    } catch (error) {
      sendJson(res, 400, { error: 'read-failed', message: messageOf(error) })
    }
  })

  register('/save', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      const store = storeOf(workspaceOf(req, settings))
      const result = store.save(body.path, body.content, {
        force: body.force === true,
        expectedStamp: body.expectedStamp,
        // 自动保存不备份，否则每停手一秒就多一个版本文件。
        backup: body.noBackup === true ? false : undefined,
      })
      writeStart(store.root)
      sendJson(res, 200, result)
    } catch (error) {
      if (error && error.code === 'lock-violation') {
        return sendJson(res, 409, { error: 'lock-violation', message: messageOf(error), locked: error.locks })
      }
      if (error && error.code === 'stale-conflict') {
        return sendJson(res, 409, {
          error: 'stale-conflict',
          message: messageOf(error),
          diskStamp: error.diskStamp,
          diskContent: error.diskContent,
        })
      }
      sendJson(res, 400, { error: 'save-failed', message: messageOf(error) })
    }
  })

  register('/append', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      const store = storeOf(workspaceOf(req, settings))
      const result = store.append(body.path, body.body)
      writeStart(store.root)
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, 400, { error: 'append-failed', message: messageOf(error) })
    }
  })

  register('/backup', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      sendJson(res, 200, { ok: true, backup: storeOf(workspaceOf(req, settings)).backup(body.path) })
    } catch (error) {
      sendJson(res, 400, { error: 'backup-failed', message: messageOf(error) })
    }
  })

  register('/rollback', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string' || typeof body.backup !== 'string') {
      return sendJson(res, 400, { error: 'bad-request' })
    }
    try {
      sendJson(res, 200, storeOf(workspaceOf(req, settings)).rollback(body.path, body.backup))
    } catch (error) {
      sendJson(res, 400, { error: 'rollback-failed', message: messageOf(error) })
    }
  })

  register('/caret', async (req, res) => {
    if (req.method === 'GET') {
      try {
        const url = new URL(req.url || '', 'http://localhost')
        const ws = workspaceOf(req, settings) || ''
        const rel = url.searchParams.get('path')
        return sendJson(res, 200, (rel && carets.get(ws + '|' + rel)) || null)
      } catch (error) {
        return sendJson(res, 400, { error: 'caret-failed', message: messageOf(error) })
      }
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (req.headers['x-outline-coedit'] !== '1') return sendJson(res, 403, { error: 'forbidden' })
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      const ws = workspaceOf(req, settings)
      carets.set((ws || '') + '|' + body.path, {
        path: body.path, index: Number(body.index) || 0, line: Number(body.line) || 1,
        tail: typeof body.tail === 'string' ? body.tail.slice(-60) : '', at: new Date().toISOString(),
      })
      return sendJson(res, 200, { ok: true })
    } catch (error) {
      return sendJson(res, 400, { error: 'caret-failed', message: messageOf(error) })
    }
  })

  register('/create', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      const store = storeOf(workspaceOf(req, settings))
      const result = store.create(body.path, body.content == null ? '' : body.content)
      writeStart(store.root)
      sendJson(res, 200, result)
    } catch (error) {
      sendJson(res, error && error.code === 'exists' ? 409 : 400, { error: (error && error.code) || 'create-failed', message: messageOf(error) })
    }
  })

  register('/delete-backup', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.backup !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      sendJson(res, 200, storeOf(workspaceOf(req, settings)).deleteBackup(body.backup))
    } catch (error) {
      sendJson(res, 400, { error: 'delete-failed', message: messageOf(error) })
    }
  })

  register('/prune', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      sendJson(res, 200, storeOf(workspaceOf(req, settings)).pruneBackups(body.path, body.keep == null ? 5 : body.keep))
    } catch (error) {
      sendJson(res, 400, { error: 'prune-failed', message: messageOf(error) })
    }
  })

  // 读/改设置：dir 是共写目录的绝对路径。
  register('/settings', async (req, res) => {
    if (req.method === 'GET') {
      const ws = workspaceOf(req, settings)
      const perWs = ws ? overridesFor(ws)[ws] : null
      return sendJson(res, 200, {
        workspace: ws,
        override: typeof perWs === 'string' ? perWs : null,
        dir: (() => { try { return resolveDir(ws) } catch { return null } })(),
        effectiveDir: (() => { try { return storeOf(ws).root } catch { return null } })(),
        configuredDir,
        isDefault: !perWs,
      })
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (req.headers['x-outline-coedit'] !== '1') return sendJson(res, 403, { error: 'forbidden' })
    const body = await readJson(req)
    if (!body || typeof body.dir !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    const target = path.resolve(body.dir.trim())
    if (!existsSync(target)) {
      return sendJson(res, 400, { error: 'not-exists', message: '这个路径不存在：' + target })
    }
    if (!isPlausibleWorkspace(target)) {
      return sendJson(res, 400, { error: 'unsafe', message: '不允许把共写目录设在系统目录下：' + target })
    }
    try {
      const stat = statSync(target)
      if (!stat.isDirectory()) {
        return sendJson(res, 400, { error: 'not-a-dir', message: '不是文件夹：' + target })
      }
      // 工作区优先取 body.workspace（JSON 走 UTF-8，中文安全），其次 query/推断。
      let ws = typeof body.workspace === 'string' && body.workspace.trim() !== ''
        ? path.resolve(body.workspace.trim())
        : null
      if (ws && !isPlausibleWorkspace(ws)) ws = null
      if (!ws) ws = workspaceOf(req, settings)
      if (ws) rememberFor(ws, target)
      else writeSettings({ dir: target })
      writeSettings({ updatedAt: new Date().toISOString() })
      // 立刻建好目录结构，用户切过去就能用
      const store = createStore(target, { workspace: ws })
      store.ensureDirs()
      // 刷新指针文件：静态提示词靠它找到真实目录
      try { writeFileSync(CURRENT_FILE, store.root + '\n', 'utf8') } catch { /* 忽略 */ }
      // 切过去立刻给一份 START.txt，AI 第一次读就能拿到规则
      try { writeStart(store.root) } catch { /* 忽略 */ }
      return sendJson(res, 200, { ok: true, dir: target, workspace: ws, state: store.state() })
    } catch (error) {
      return sendJson(res, 500, { error: 'settings-failed', message: messageOf(error) })
    }
  })

  // 恢复默认：清掉这个工作区的覆盖，回到 <工作区>/coedit
  register('/reset-dir', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    try {
      const ws = workspaceOf(req, settings)
      if (ws) {
        const all = overridesFor(ws)
        delete all[ws]
        writeSettings({ workspaces: all })
      } else {
        const s = readSettings()
        delete s.dir
        writeSettings(s)
      }
      const store = storeOf(ws)
      store.ensureDirs()
      try { writeFileSync(CURRENT_FILE, store.root + '\n', 'utf8') } catch { /* 忽略 */ }
      return sendJson(res, 200, { ok: true, dir: store.root, state: store.state() })
    } catch (error) {
      return sendJson(res, 500, { error: 'reset-failed', message: messageOf(error) })
    }
  })

  // 浏览目录：给界面的文件夹选择器用。
  register('/browse', async (req, res) => {
    if (!guard(req, res, 'GET')) return
    try {
      const url = new URL(req.url || '', 'http://localhost')
      const raw = url.searchParams.get('path')
      const target = raw && raw.trim() !== '' ? path.resolve(raw.trim()) : homedir()
      if (!existsSync(target)) return sendJson(res, 400, { error: 'not-exists', message: target })
      const entries = readdirSync(target, { withFileTypes: true })
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, 'zh'))
        .slice(0, 300)
      const parent = path.dirname(target)
      return sendJson(res, 200, {
        path: target,
        parent: parent === target ? null : parent,
        dirs,
        home: homedir(),
        isCoedit: ['START.txt', 'AGENTS.md'].some((n) => existsSync(path.join(target, n))),
      })
    } catch (error) {
      return sendJson(res, 400, { error: 'browse-failed', message: messageOf(error) })
    }
  })

  // 新对话快速进入状态：一次拿到工作区、章节、大纲摘要、最近正文尾巴。
  register('/context', async (req, res) => {
    if (!guard(req, res, 'GET')) return
    try {
      const ws = workspaceOf(req, settings)
      const store = storeOf(ws)
      const st = store.state()
      const readSafe = (rel) => {
        try { return rel && existsSync(store.abs(rel)) ? store.read(rel) : null } catch { return null }
      }
      const outline = readSafe(st.outline)
      const style = readSafe(st.style)
      const last = st.chapters.length > 0 ? st.chapters[st.chapters.length - 1] : null
      const text = last ? readSafe(last.path) || '' : ''
      sendJson(res, 200, {
        workspace: ws,
        coeditRoot: store.root,
        chapters: st.chapters.map((c) => c.path + ' (' + c.chars + '字)'),
        outlineHead: outline ? outline.split('\n').slice(0, 18).join('\n') : null,
        styleRules: style ? style.split('\n').slice(0, 10).join('\n') : null,
        lastChapter: last ? last.path : null,
        lastChapterTail: text ? text.slice(-500) : null,
        backups: st.backups.length,
        hasAgents: existsSync(store.abs('AGENTS.md')),
      })
    } catch (error) {
      sendJson(res, error && error.code === 'no-workspace' ? 409 : 500, {
        error: (error && error.code) || 'context-failed', message: messageOf(error),
      })
    }
  })

  // 撤回 AI 的写入：退到「最近一次 tool 写入之前」那一版，跳过用户自己的保存。
  register('/undo-ai', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    const body = await readJson(req)
    if (!body || typeof body.path !== 'string') return sendJson(res, 400, { error: 'bad-request' })
    try {
      const store = storeOf(workspaceOf(req, settings))
      const st = store.state()
      const no = (/^chapters\/(\d+)/.exec(body.path) || /^(\d+)/.exec(body.path) || [])[1]
      if (!no) return sendJson(res, 400, { error: 'not-chapter', message: '不是章节文件' })

      // 从历史日志里找出最近一次 tool 写入对应的备份号。
      const logPath = path.join(store.root, 'logs', no + '.history.txt')
      let logText = ''
      try { logText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '' } catch { logText = '' }
      const lines = logText.split('\n').filter(Boolean).reverse()
      let target = null
      for (const line of lines) {
        const m = /\|\s*(append|save):tool\s*\|\s*备份\s+(backups\/[^\s|]+)/.exec(line)
        if (m && m[2]) { target = m[2]; break }
      }
      if (!target) {
        // 没有来源标记时，退到最新备份，并明确告知
        const mine = st.backups.filter((f) => f.replace(/^backups\//, '').indexOf(no + '.v') === 0).sort().reverse()
        target = mine[0] || null
      }
      if (!target) return sendJson(res, 400, { error: 'no-backup', message: '没有可撤回的备份' })

      // 告诉前端：撤回后会和「你后来保存的那版」差多少，让用户自己决定。
      const latestUser = (() => {
        for (const line of lines) {
          const m = /\|\s*(?:save|append):user\s*\|\s*备份\s+(backups\/[^\s|]+)/.exec(line)
          if (m && m[1]) return m[1]
        }
        return null
      })()
      const r = store.rollback(body.path, target)
      writeStart(store.root)
      sendJson(res, 200, Object.assign({ ok: true, target, latestUser }, r))
    } catch (error) {
      sendJson(res, 400, { error: 'undo-failed', message: messageOf(error) })
    }
  })

  register('/scaffold', async (req, res) => {
    if (!guard(req, res, 'POST')) return
    try {
      const ws = workspaceOf(req, settings)
      const base = storeOf(ws)
      const store = scaffold(base.root, { workspace: ws ? path.resolve(ws) : null })
      writeStart(store.root)
      sendJson(res, 200, store.state())
    } catch (error) {
      sendJson(res, 500, { error: 'scaffold-failed', message: messageOf(error) })
    }
  })

  ctx.effect(() => {
    const dispose = []
    for (const item of pending) {
      try {
        dispose.push(server.register({ kind: 'exact', path: BASE + item.route, handler: item.handler }))
      } catch (error) {
        ctx.logger?.warn?.('[outline-coedit] 注册失败 ' + item.route + '：' + messageOf(error))
      }
    }
    return () => {
      for (const d of dispose) {
        try { if (typeof d === 'function') d() } catch { /* 忽略 */ }
      }
    }
  }, 'outline-coedit: routes')

  ctx.logger?.info?.('[outline-coedit] 已启用 v' + VERSION + '，路由 ' + pending.length + ' 条')
}

/* ------------------------------------------------------------------ */

const POINTER = path.join(HOME_DIR, '.dsh', 'outline-coedit-workspace.txt')
const SETTINGS_FILE = path.join(HOME_DIR, '.dsh', 'outline-coedit-settings.json')
// 指针文件：提示词必须静态，所以让 AI 读这个固定路径拿到当前共写目录。
const CURRENT_FILE = path.join(HOME_DIR, '.dsh', 'outline-coedit-current.txt')

/** 按工作区取用户选的共写目录。 */
function overridesFor(dir) {
  const s = readSettings()
  return s && s.workspaces && typeof s.workspaces === 'object' ? s.workspaces : {}
}

/** 记住某个工作区的共写目录。 */
function rememberFor(workspace, coeditDir) {
  const all = overridesFor(workspace)
  all[workspace] = coeditDir
  // latestDir：最近一次选择，任何工作区都兜底用它，避免"切了却记不住"。
  writeSettings({ workspaces: all, latestDir: coeditDir })
}

/** 读用户设置；读不到就返回空对象。 */
function readSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return {}
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** 写用户设置：先写临时文件再改名，避免写一半留下坏文件。 */
function writeSettings(patch) {
  const next = Object.assign(readSettings(), patch)
  const tmp = SETTINGS_FILE + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  try {
    renameSync(tmp, SETTINGS_FILE)
  } catch {
    writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8')
  }
  return next
}

function workspaceOf(req, settings) {
  try {
    const url = new URL(req.url || '', 'http://localhost')
    const ws = url.searchParams.get('ws')
    if (ws && ws.trim() !== '') {
      const resolved = path.resolve(ws.trim())
      if (isPlausibleWorkspace(resolved)) { remember(resolved); return resolved }
    }
  } catch { /* 继续 */ }

  if (typeof settings.dir === 'string' && settings.dir.trim() !== '') {
    return path.dirname(path.resolve(settings.dir.trim()))
  }

  const env = process.env.DSH_COEDIT_WORKSPACE
  if (typeof env === 'string' && env.trim() !== '') return path.resolve(env.trim())

  const saved = recall()
  if (saved) return saved

  const scanned = scanRecentWorkspace()
  if (scanned && isPlausibleWorkspace(scanned)) { remember(scanned); return scanned }

  return null
}

const FORBIDDEN = [/^[a-zA-Z]:\\?$/, /^[a-zA-Z]:\\Users\\?$/i, /^[a-zA-Z]:\\Windows\\?$/i, /^[a-zA-Z]:\\Program/i]

function isPlausibleWorkspace(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return false
  const resolved = path.resolve(dir)
  for (const bad of FORBIDDEN) {
    if (bad.test(resolved) || bad.test(resolved + path.sep)) return false
  }
  return true
}

function remember(ws) {
  try {
    if (existsSync(POINTER) && readFileSync(POINTER, 'utf8').trim() === ws) return
    writeFileSync(POINTER, ws + '\n', 'utf8')
  } catch { /* 无所谓 */ }
}

function recall() {
  try {
    if (!existsSync(POINTER)) return null
    const value = readFileSync(POINTER, 'utf8').trim()
    return value !== '' && existsSync(value) ? value : null
  } catch {
    return null
  }
}

/** 会话目录名里的 ~XXXX 是 UTF-16 码点，可还原中文路径。 */
function decodeSessionDir(name) {
  const m = /^--(?:([A-Za-z])-)?(.+)--$/.exec(name)
  if (!m) return null
  const drive = m[1] ? m[1].toUpperCase() + ':\\' : '\\'
  const body = m[2]
  const parts = []
  let buf = ''
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === '~') {
      const hex = body.slice(i + 1, i + 5)
      if (/^[0-9A-Fa-f]{4}$/.test(hex)) {
        buf += String.fromCharCode(parseInt(hex, 16))
        i += 4
        continue
      }
    }
    if (ch === '-') { parts.push(buf); buf = ''; continue }
    buf += ch
  }
  if (buf !== '') parts.push(buf)
  return drive + parts.join('\\')
}

function scanRecentWorkspace() {
  try {
    const root = path.join(homedir(), '.dsh', 'sessions')
    if (!existsSync(root)) return null
    const entries = readdirSync(root)
      .filter((n) => !n.startsWith('.'))
      .map((name) => {
        try { return { name, mtime: statSync(path.join(root, name)).mtimeMs } } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
    for (const entry of entries) {
      const decoded = decodeSessionDir(entry.name)
      if (decoded && existsSync(decoded) && isPlausibleWorkspace(decoded)) return decoded
    }
    return null
  } catch {
    return null
  }
}

function messageOf(error) {
  return error && error.message ? error.message : String(error)
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readJson(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { req.destroy(); resolve(undefined); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')) } catch { resolve(undefined) }
    })
    req.on('error', () => resolve(undefined))
  })
}
