/**
 * 共写文件层（纯逻辑，零依赖，可单测）。
 * 默认 .txt 纯文本，正文里不放任何 Markdown / HTML 记号。
 *   [[COEDIT:WRITE_HERE]]   AI 续写插入点
 *   [[COEDIT:END]]           文件结束锚点
 *   [[COEDIT:LOCK_START 名]] … [[COEDIT:LOCK_END]]
 *   [[COEDIT:AI_BLOCK_START 名]] … [[COEDIT:AI_BLOCK_END]]
 */
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync,
  readdirSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs'
import path from 'node:path'

// 共写目录里不预建任何文件夹：logs/ style/ 只在真的要写东西时才出现。
export const DIRS = []

export const TXT_HERE = '[[COEDIT:HERE]]'
export const TXT_END = '[[COEDIT:END]]'
export const TXT_WRITE = '[[COEDIT:WRITE_HERE]]'
export const MD_END = '<!-- COEDIT:END -->'
export const MD_WRITE = '<!-- COEDIT:WRITE_HERE -->'

const ALLOW_EXT = /\.(md|txt|json)$/i
const CHAPTER_RE = /^chapters\/(\d+)\.(md|txt)$/i

const LOCK_RE = new RegExp(
  '(?:<!--\\s*COEDIT:LOCK_START[^>]*-->([\\s\\S]*?)<!--\\s*COEDIT:LOCK_END\\s*-->)'
  + '|(?:\\[\\[COEDIT:LOCK_START[^\\]]*\\]\\]([\\s\\S]*?)\\[\\[COEDIT:LOCK_END\\]\\])',
  'g',
)

/** 越界与后缀防护：只允许共写目录内的 .md/.txt/.json。 */
export function safeRel(rel) {
  if (typeof rel !== 'string' || rel.trim() === '') throw new Error('path 无效')
  const norm = path.normalize(rel).split(path.sep).join('/')
  const parts = norm.split('/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || parts.includes('..') || parts.includes('.git')) {
    throw new Error('越界路径: ' + rel)
  }
  if (!ALLOW_EXT.test(norm)) throw new Error('只允许 .md / .txt / .json: ' + rel)
  return norm
}

/** 抽出每个锁区的正文，顺序稳定。 */
export function locks(text) {
  const out = []
  LOCK_RE.lastIndex = 0
  let m
  while ((m = LOCK_RE.exec(String(text))) !== null) out.push((m[1] !== undefined ? m[1] : m[2]).trim())
  return out
}

/** 锁区内容必须逐字不变。 */
export function locksIntact(before, after) {
  const a = locks(before)
  const b = locks(after)
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

/**
 * 找正文插入点，按优先级：
 *   1. [[COEDIT:HERE]]  用户亲手放的续写标记（最高）
 *   2. [[COEDIT:END]]   文件结束锚点
 *   3. [[COEDIT:WRITE_HERE]] / 旧 md 注释
 * 返回 -1 表示没有标记，调用方追加到末尾。
 */
function insertionIndex(src) {
  const order = [TXT_HERE, TXT_END, TXT_WRITE, MD_END, MD_WRITE]
  for (const marker of order) {
    const i = src.lastIndexOf(marker)
    if (i >= 0) return { index: i, marker }
  }
  return { index: -1, marker: null }
}

/** 在 END 锚点之前插入正文；没有锚点就追加到文件末尾。 */
export function appendBody(text, body) {
  const piece = String(body == null ? '' : body).replace(/\r\n/g, '\n').trim()
  if (piece === '') return String(text)
  const src = String(text)
  const hit = insertionIndex(src)
  if (hit.index < 0) {
    const base = src.replace(/\s+$/, '')
    return base === '' ? piece + '\n' : base + '\n\n' + piece + '\n'
  }
  const { index, marker } = hit
  // HERE 是「从这里接着写」：插在标记之后，标记本身留着。
  if (marker === TXT_HERE) {
    const lineEnd = src.indexOf('\n', index)
    const cut = lineEnd < 0 ? src.length : lineEnd + 1
    const head = src.slice(0, cut).replace(/\s+$/, '')
    const tail = src.slice(cut).replace(/^\s+/, '')
    return head + '\n\n' + piece + '\n' + (tail === '' ? '' : '\n' + tail)
  }
  const head = src.slice(0, index).replace(/\s+$/, '')
  return (head === '' ? '' : head + '\n\n') + piece + '\n\n' + src.slice(index)
}

export function chapterOf(rel) {
  const name = safeRel(rel)
  const m = CHAPTER_RE.exec(name) || /^(\d+)\.(md|txt)$/i.exec(name)
  if (!m) throw new Error('不是章节文件: ' + rel)
  return m[1]
}

const pad = (n) => String(n).padStart(3, '0')

/** 共写目录对象：所有落盘动作都经它，便于测试注入临时目录。 */
export function createStore(root, options = {}) {
  const abs = (rel) => path.join(root, safeRel(rel))

  const ensureDirs = () => {
    // 共写目录本身要存在（就是用户选的那个文件夹，不额外套子目录）
    if (!existsSync(root)) mkdirSync(root, { recursive: true })
    for (const d of DIRS) {
      const full = path.join(root, d)
      if (!existsSync(full)) mkdirSync(full, { recursive: true })
    }
    // 旧版本留下的空壳目录，清掉；里面还有东西就不动（那是用户的文件）
    for (const legacy of ['chapters', 'backups']) {
      const full = path.join(root, legacy)
      try {
        if (existsSync(full) && readdirSync(full).length === 0) rmdirSync(full)
      } catch { /* 忽略 */ }
    }
  }

  const readJson = (file, fallback) => {
    try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
  }
  // 元数据写不进去不影响正文；这里永远不抛错。
  const writeJson = (file, obj) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8')
    } catch { /* 忽略 */ }
  }
  // 元数据放隐藏目录，用户的正文文件夹里只剩正文本身
  const projectPath = () => path.join(ensureBackupDir() || backupDir(), 'project.json')

  const chapterNames = () => readdirSync(root).filter((n) => /^\d+\.(md|txt)$/i.test(n)).sort()

  /**
   * 备份一律落在工作区里的隐藏目录，且不在共写目录内部：
   *   <工作区>/.coedit-backups/<共写目录相对路径压平>/
   * AI 在共写目录里既看不到 backups/，也看不到这个隐藏目录。
   */
  // 只有「像样的工作区」才能当备份根：盘符根、C:\Users、C:\Windows 这类
  // 普通进程没写权限，历史设置里的坏键曾把备份拼到 C:\Users\.coedit-backups 下面，
  // 建目录一失败就把整个写入锁死。
  const usableWorkspace = (ws) => {
    if (!ws) return null
    const r = path.resolve(ws)
    if (path.dirname(r) === r) return null           // 盘符根 C:\ D:\
    const base = path.basename(r).toLowerCase()
    if (base === 'users' || base === 'windows' || base === 'program files' || base === 'program files (x86)') return null
    return r
  }

  const backupDir = () => {
    const name = path.basename(root)
    const rt = path.resolve(root)
    const ws = usableWorkspace(options.workspace)
    if (ws && rt !== ws && rt.startsWith(ws + path.sep)) {
      const flat = path.relative(ws, rt).replace(/[\\/]+/g, '_')
      return path.join(ws, '.coedit-backups', flat)
    }
    // 共写目录就是工作区根时没有「外面」可用，只能放里面，但仍是隐藏名
    if (ws && rt === ws) return path.join(rt, '.coedit-backups', name)
    return path.join(path.dirname(rt), '.coedit-backups', name)
  }

  // 备份目录只在第一次真正要写时才建；建不出来就降级，绝不因此挡住正文写入。
  let backupDirMemo
  const ensureBackupDir = () => {
    if (backupDirMemo !== undefined) return backupDirMemo
    const rt = path.resolve(root)
    const candidates = [
      backupDir(),
      path.join(path.dirname(rt), '.coedit-backups', path.basename(rt)),
    ]
    for (const d of candidates) {
      try {
        if (!existsSync(d)) mkdirSync(d, { recursive: true })
        backupDirMemo = d
        return d
      } catch { /* 换下一个位置 */ }
    }
    backupDirMemo = null
    return null
  }

  const nextVersion = (ch) => {
    const dir = ensureBackupDir()
    if (!dir) return 1
    const re = new RegExp('^' + ch + '\\.v(\\d+)\\.(md|txt)$')
    let max = 0
    for (const f of readdirSync(dir)) {
      const m = re.exec(f)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return max + 1
  }

  /** 返回 null 表示这次没备份（备份目录不可用）；调用方照常写入正文。 */
  const backup = (rel) => {
    const dir = ensureBackupDir()
    if (!dir) return null
    const ch = chapterOf(rel)
    const v = nextVersion(ch)
    const ext = path.extname(rel) || '.txt'
    const name = ch + '.v' + pad(v) + ext   // 只留文件名，不含 backups/
    copyFileSync(abs(rel), path.join(dir, name))
    const proj = readJson(projectPath(), {})
    proj.version = Math.max(Number(proj.version) || 0, v)
    writeJson(projectPath(), proj)
    return { version: v, file: name }
  }

  // 来源：'user'（侧栏保存）或 'tool'（AI 调工具）。撤回时优先退到最近一次 tool 写入之前。
  let origin = 'user'
  const setOrigin = (v) => { origin = v === 'tool' ? 'tool' : 'user' }
  const getOrigin = () => origin

  // 操作历史也是元数据，放隐藏目录，正文文件夹里永远不出现 logs/
  const logDir = () => {
    const d = ensureBackupDir()
    return d ? path.join(d, 'logs') : null
  }

  const logLine = (rel, action, note) => {
    let ch
    try { ch = chapterOf(rel) } catch { return }
    try {
      const dir = logDir()
      if (!dir) return
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const file = path.join(dir, ch + '.history.txt')
      const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
      const header = existsSync(file) ? '' : '时间 | 动作 | 说明\n---- | ---- | ----\n'
      appendFileSync(file, header + stamp + ' | ' + action + ' | ' + (note || '') + '\n', 'utf8')
    } catch { /* 日志失败不影响正文 */ }
  }

  const read = (rel) => readFileSync(abs(rel), 'utf8')

  const state = () => {
    const proj = readJson(projectPath(), {})
    // 章节就是共写目录里的 NNN.txt。残留的 chapters/ 只有真装着章节时才回退显示，免得丢旧稿。
    const chapters = []
    const cdir = path.join(root, 'chapters')
    for (const f of readdirSync(root).filter((n) => /^\d+\.(md|txt)$/i.test(n)).sort()) {
      const full = path.join(root, f)
      chapters.push({
        path: f,
        chars: readFileSync(full, 'utf8').replace(/\s/g, '').length,
        mtime: statSync(full).mtime.toISOString(),
      })
    }
    if (chapters.length === 0 && existsSync(cdir)) {
      for (const f of readdirSync(cdir).filter((n) => /^\d+\.(md|txt)$/i.test(n)).sort()) {
        const full = path.join(cdir, f)
        chapters.push({
          path: 'chapters/' + f,
          chars: readFileSync(full, 'utf8').replace(/\s/g, '').length,
          mtime: statSync(full).mtime.toISOString(),
        })
      }
    }
    const backups = []
    const bdir = ensureBackupDir() || backupDir()
    if (existsSync(bdir)) {
      // 只把真正的版本文件列出来；project.json 之类元数据不算备份
      for (const f of readdirSync(bdir).sort()) {
        if (/^\d+\.v\d+\.(md|txt)$/i.test(f)) backups.push(f)
      }
    }
    const outline = ['outline.txt', 'outline.md'].find((n) => existsSync(path.join(root, n))) || null
    const style = ['style/style-rules.txt', 'style/style-rules.md'].find((n) => existsSync(path.join(root, n))) || null
    const extras = []
    if (existsSync(cdir)) {
      for (const f of readdirSync(cdir)) {
        if (!/\.(md|txt)$/i.test(f)) extras.push('chapters/' + f)
      }
    }
    let max = 0
    for (const f of chapterNames()) {
      const m = /^(\d+)/.exec(f)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return {
      project: proj, chapters, backups, outline, style, extras, root,
      format: 'txt', nextChapter: pad(max + 1), layout: layout(),
    }
  }

  /** 文件指纹：用大小 + 修改时间，便宜且够用。 */
  const stampOf = (rel) => {
    try {
      const full = abs(rel)
      if (!existsSync(full)) return null
      const st = statSync(full)
      return st.size + ':' + Math.floor(st.mtimeMs)
    } catch {
      return null
    }
  }

  /**
   * 保存：默认先备份；锁区被改且未 force 时拒绝。
   * expectedStamp：调用方打开文件时拿到的指纹。若磁盘已被外部（AI）改动，拒绝静默覆盖。
   */
  const save = (rel, content, options = {}) => {
    const target = abs(rel)
    const before = existsSync(target) ? readFileSync(target, 'utf8') : ''
    const after = String(content == null ? '' : content)
    // 冲突检测：只有在内容真的不同、且调用方声明了基线时才检查。
    if (options.expectedStamp != null && options.force !== true && before !== after) {
      const now = stampOf(rel)
      if (now !== null && now !== String(options.expectedStamp)) {
        const error = new Error('文件在侧栏打开后被外部改动过（可能是 AI 写入）。已拒绝覆盖，避免丢失内容。')
        error.code = 'stale-conflict'
        error.diskStamp = now
        error.diskContent = before
        throw error
      }
    }
    if (!locksIntact(before, after) && options.force !== true) {
      const error = new Error('锁区被改动，已拒绝保存。确认要改请带 force')
      error.code = 'lock-violation'
      error.locks = locks(before)
      throw error
    }
    const bk = before && options.backup !== false ? backup(rel) : null
    writeFileSync(target, after, 'utf8')
    logLine(rel, 'save:' + (options.origin || 'user'), bk ? '备份 ' + bk.file : '无备份')
    // 必须回传新指纹：否则侧栏一直拿着旧基线，第二次保存就会被自己上次的写入判成冲突。
    return { ok: true, path: rel, backup: bk, stamp: stampOf(rel) }
  }

  const append = (rel, body, options = {}) => {
    const before = existsSync(abs(rel)) ? read(rel) : ''
    const bk = before === '' ? null : backup(rel)
    writeFileSync(abs(rel), appendBody(before, body), 'utf8')
    logLine(rel, 'append:' + (options.origin || 'user'), bk ? '备份 ' + bk.file : '新建')
    return { ok: true, backup: bk }
  }

  const rollback = (rel, backupRel) => {
    // 兼容两种写法：'057.v077.txt' 或 'backups/057.v077.txt'
    const name = String(backupRel).replace(/^backups\//, '')
    if (!/^[\w.-]+\.(md|txt)$/.test(name)) throw new Error('备份名无效: ' + backupRel)
    const dir = ensureBackupDir()
    if (!dir) throw new Error('备份目录不可用，无法回滚')
    const srcPath = path.join(dir, name)
    if (!existsSync(srcPath)) throw new Error('备份不存在: ' + name)
    const guard = backup(rel)
    copyFileSync(srcPath, abs(rel))
    logLine(rel, 'rollback', '来源 ' + name + '，回滚前已存为 ' + (guard ? guard.file : '（未备份）'))
    return { ok: true, restored: name, preserved: guard ? guard.file : null }
  }

  /** 新建文件；已存在则拒绝，避免误覆盖。 */
  const create = (rel, content) => {
    const name = safeRel(rel)
    const target = abs(name)
    if (existsSync(target)) {
      const error = new Error('文件已存在: ' + name)
      error.code = 'exists'
      throw error
    }
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, String(content == null ? '' : content), 'utf8')
    logLine(name, 'create', '')
    return { ok: true, path: name }
  }

  /** 布局恒为 root：章节永远直接放在用户选的那个文件夹里。 */
  const layout = () => 'root'

  const nextChapterName = (ext = '.txt') => {
    let max = 0
    const pool = chapterNames().slice()
    // 残留的 chapters/ 里如果还有旧稿，编号要接着往下排，别撞号
    const legacy = path.join(root, 'chapters')
    if (existsSync(legacy)) {
      for (const n of readdirSync(legacy)) if (/^\d+\.(md|txt)$/i.test(n)) pool.push(n)
    }
    for (const f of pool) {
      const m = /^(\d+)/.exec(f)
      if (m) max = Math.max(max, Number(m[1]))
    }
    return pad(max + 1) + ext
  }

  /** 删除一个备份文件，只允许 backups/ 下。 */
  const deleteBackup = (backupRel) => {
    const name = String(backupRel).replace(/^backups\//, '')
    const dir = ensureBackupDir()
    if (!dir) throw new Error('备份不存在: ' + name)
    const target = path.join(dir, name)
    if (!existsSync(target)) throw new Error('备份不存在: ' + name)
    unlinkSync(target)
    return { ok: true, deleted: name }
  }

  /** 某章只保留最近 keep 个备份，更早的删掉。 */
  const pruneBackups = (rel, keep = 5) => {
    const ch = chapterOf(rel)
    const n = Math.max(0, Math.floor(Number(keep) || 0))
    const dir = ensureBackupDir()
    if (!dir || !existsSync(dir)) return { ok: true, removed: [] }
    const re = new RegExp('^' + ch + '\\.v(\\d+)\\.(md|txt)$')
    const files = readdirSync(dir)
      .map((f) => ({ f, v: Number((re.exec(f) || [])[1]) }))
      .filter((x) => Number.isFinite(x.v))
      .sort((a, b) => a.v - b.v)
    const drop = files.slice(0, Math.max(0, files.length - n))
    for (const x of drop) unlinkSync(path.join(dir, x.f))
    return { ok: true, removed: drop.map((x) => x.f) }
  }

  return {
    root, ensureDirs, read, state, save, append, rollback, backup, stampOf,
    create, nextChapterName, deleteBackup, pruneBackups,
    readJson, writeJson, projectPath, abs, logDir, backupDir,
  }
}
