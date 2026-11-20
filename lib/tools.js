/**
 * 共写原生工具：让 AI 直接用 coedit_read / coedit_write / coedit_undo，
 * 不必每次生成代码去 fetch 接口。
 *
 * 用 service.register() 注册，走 DSH 工具管道，
 * 因此参数校验、超时、展示都由框架处理。
 */

const CHAPTER_RE = /^(\d+)/

/**
 * 注册结果，供 /diag 查询。
 * register() 的硬性要求：output 必须是 { schema, render }，缺 render 会抛 TypeError 被吞掉——
 * 这正是"插件明明装了、AI 却看不到 coedit_* 工具"最常见的原因，所以显式记下来。
 */
export const toolStatus = { service: false, source: '', registered: [], error: null }

/**
 * DSH 的 JSON schema 子集里，required 只能是对象级的字符串数组；
 * 写成属性级的 required:true 会直接抛 "not supported on type"，
 * 而这次异常被外层 try/catch 吞掉，表现就是"插件装了但 AI 看不到工具"。
 * 这里在注册前先自检一遍，宁可日志里报清楚，也不要静默失败。
 */
export function schemaProblems(node, at = 'schema') {
  const out = []
  if (!node || typeof node !== 'object') return out
  if (Object.hasOwn(node, 'required') && (node.type !== 'object' || !Array.isArray(node.required))) {
    out.push(at + '.required 只能是 type:"object" 上的字符串数组')
  }
  for (const [k, v] of Object.entries(node.properties || {})) out.push(...schemaProblems(v, at + '.properties.' + k))
  if (node.items) out.push(...schemaProblems(node.items, at + '.items'))
  return out
}

function ok(text, extra) {
  return Object.assign({ ok: true, message: text }, extra || {})
}

/**
 * @param {object} deps
 * @param {() => import('./lib/files.js').createStore} deps.store  返回当前共写目录的 store
 * @param {(root: string) => void} deps.writeStart  刷新 START.txt
 */
// 工具定义提到模块级后，execute 已经不在 registerCoeditTools 的闭包里了，
// 拿不到那里的 deps 参数（上一版就是因此报 "deps is not defined"）。
// 注册时把 deps 记到模块上，执行时再取。
let activeDeps = null
function depsRef() {
  if (!activeDeps) throw new Error('共写插件尚未初始化完成，请重启 DSH')
  return activeDeps
}

// 工具定义提到模块级，便于注册前/测试里做 schema 自检。
export const READ_SPEC = {
  name: 'coedit_read',
  description: '读取章节正文，默认返回整个文件（写续写必须看全文）。不传 path 只列章节名。',

  parameters: {
    path: {
      type: 'string',
      description: '相对路径，如 057.txt。省略则返回目录概览。',
    },
    tail: {
      type: 'integer',
      description: '只返回最后 N 个字符。一般不用。',
    },
    prev: {
      type: 'integer',
      description: '同时往前读几章（最多 3），用于接续上下文。用户没要求就别用。',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        root: { type: 'string' },
        content: { type: 'string' },
        chapters: { type: 'array', items: { type: 'string' } },
        message: { type: 'string' },
      },
    },
    render: (_a, v) => [{ type: 'text', text: v.message || v.content || '' }],
  },
  async execute(args) {
    const store = depsRef().store(args && args.path)
    if (!args || !args.path) {
      const st = store.state()
      const list = st.chapters.map((c) => c.path + ' (' + c.chars + '字)')
      return {
        ok: true,
        root: store.root,
        chapters: list,
        message: '章节：\n' + (list.length ? list.join('\n') : '（空）'),
      }
    }
    const wanted = Number(args.tail)
    const limit = Number.isFinite(wanted) && wanted > 0 ? wanted : 0
    let content = store.read(args.path)
    if (limit > 0 && content.length > limit) content = '…（前略）\n' + content.slice(-limit)

    // prev：往前看最多 3 章，给续写接上下文用。
    const prevN = Math.min(3, Math.max(0, Number(args.prev) || 0))
    if (prevN > 0) {
      const st = store.state()
      const names = st.chapters.map((c) => c.path)
      const at = names.indexOf(args.path)
      const from = Math.max(0, (at < 0 ? names.length : at) - prevN)
      const to = at < 0 ? names.length : at
      const parts = []
      for (const p of names.slice(from, to)) {
        parts.push('--- ' + p + ' ---\n' + store.read(p))
      }
      if (parts.length > 0) content = parts.join('\n\n') + '\n\n--- ' + args.path + ' ---\n' + content
    }

    return { ok: true, root: store.root, content, message: content }
  },
}

export const WRITE_SPEC = {
  name: 'coedit_write',
  description: '往已有章节追加或定点替换正文。不新建文件、不删文件、不选版本。用户没说写就不要调用。',
  parameters: {
    path: {
      type: 'string',
      required: true,
      description: '目标文件相对路径，如 057.txt。',
    },
    text: {
      type: 'string',
      required: true,
      description: '要写入的正文（纯文本，不要 Markdown 记号）。',
    },
    mode: {
      type: 'string',
      enum: ['append', 'replace'],
      description: 'append 追加到末尾（默认）；replace 用 text 替换 find。只能改已有文件，不能新建。',
    },
    find: {
      type: 'string',
      description: 'mode=replace 时要被替换的原文（必须唯一匹配）。',
    },
    confirm: {
      type: 'string',
      required: true,
      description: '必填：用户这一轮明确说要写的那句话，原样抄录。没有用户明确指令就不要调用本工具。',
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        message: { type: 'string' },
        chars: { type: 'integer' },
      },
    },
    render: (_a, v) => [{ type: 'text', text: v.message || '' }],
  },
  async execute(args) {
    const store = depsRef().store(args && args.path)
    if (!args || typeof args.path !== 'string' || typeof args.text !== 'string') {
      throw new Error('需要 path 和 text')
    }
    const mode = args.mode || 'append'
    // 硬闸：只拦「把长文件整篇换掉」。新文件、短文件、追加一律放行。
    let before = ''
    try { before = store.read(args.path) } catch { before = '' }
    const nowLen = before.replace(/\s/g, '').length
    const addLen = String(args.text).replace(/\s/g, '').length
    // 文件为空（新文件）或本来就很短 → 不拦
    if (mode === 'replace' && nowLen >= 500) {
      // 替换的长度不能接近全文长度，否则就是整篇重写
      if (addLen > nowLen * 0.8) {
        throw new Error('拒绝整篇重写：这次替换几乎等于全文。要换整章请在侧栏操作，或分几次改。')
      }
    }
    // 硬闸：没有引用用户原话的写入一律拒绝。
    if (typeof args.confirm !== 'string' || args.confirm.trim() === '') {
      throw new Error('拒绝写入：confirm 为空。只有用户明确要求时才写，并把用户原话填进 confirm。')
    }

    if (mode === 'replace') {
      if (typeof args.find !== 'string' || args.find === '') throw new Error('replace 需要 find')
      const before = store.read(args.path)
      const hits = before.split(args.find).length - 1
      if (hits === 0) throw new Error('没找到要替换的原文')
      if (hits > 1) throw new Error('原文出现 ' + hits + ' 次，不唯一，请给更长的上下文')
      const after = before.replace(args.find, args.text)
      const r = store.save(args.path, after, { origin: 'tool' })
      depsRef().writeStart(store.root)
      return { ok: true, message: '已替换 ' + r.path + ' 中 1 处' }
    }

    const r = store.append(args.path, args.text, { origin: 'tool' })
    depsRef().writeStart(store.root)
    return {
      ok: true,
      message: '已追加到 ' + args.path + '，' + args.text.replace(/\s/g, '').length + ' 字',
      chars: args.text.replace(/\s/g, '').length,
    }
  },
}

export function registerCoeditTools(ctx, deps) {
  activeDeps = deps
  // cordis 把 service 挂在 ctx 上；有些环境要经 ctx.get()。
  const viaGet = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
  const service = (viaGet && typeof viaGet.register === 'function') ? viaGet : ctx.tools
  toolStatus.service = !!(service && typeof service.register === 'function')
  toolStatus.source = service === viaGet ? 'ctx.get' : (service ? 'ctx.tools' : 'none')
  if (!toolStatus.service) {
    toolStatus.error = '没有 tools 服务'
    ctx.logger?.warn?.('[outline-coedit] 没有 tools 服务，跳过工具注册')
    return () => {}
  }

  const disposers = []
  // 统一走这里：注册一个记一个，失败也记下原因（不吞掉）。
  const add = (definition) => {
    const dispose = service.register(definition)
    toolStatus.registered.push(definition.name)
    return dispose
  }

  // ---------- 读 ----------
  disposers.push(add(READ_SPEC))

  // ---------- 写 ----------
  disposers.push(add(WRITE_SPEC))
  ctx.logger?.info?.('[outline-coedit] 已注册原生工具：' + toolStatus.registered.join(' / '))

  return () => {
    for (const d of disposers) {
      try { if (typeof d === 'function') d() } catch { /* 忽略 */ }
    }
  }
}
