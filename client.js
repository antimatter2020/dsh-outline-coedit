/**
 * 大纲共写 Client 半：右侧栏「共写」标签页。
 *
 * 布局（上下分布）：
 *   顶栏   —— 目录（可折叠）+ 操作按钮
 *   写作区 —— 独占剩余宽高
 *   底栏   —— 锁定块 / 备份（可删、可清理）
 *
 * 光标颜色、配色都走显式十六进制，不依赖宿主主题继承。
 */
window.__ModuleLoader__.load({
  id: 'dsh-outline-coedit',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const BASE = '/dsh-outline-coedit'
    const KIND = 'coedit'
    const ID = 'dsh-outline-coedit'

    // ---- 配色方案 ----
    const THEMES = {
      ink: {
        name: '墨',
        bg: '#faf8f4', fg: '#2b2723', muted: '#8a8378', line: '#e2dcd2',
        accent: '#8b5e34', accentFg: '#ffffff', soft: 'rgba(139,94,52,.14)',
        lockBg: 'rgba(178,58,38,.12)', lockFg: '#8a2b1e',
      },
      night: {
        name: '夜',
        bg: '#1e2024', fg: '#e6e3dd', muted: '#8d8a84', line: '#33363c',
        accent: '#c9a227', accentFg: '#1e2024', soft: 'rgba(201,162,39,.16)',
        lockBg: 'rgba(220,120,90,.16)', lockFg: '#e8a68e',
      },
      paper: {
        name: '纸',
        bg: '#fbfaf6', fg: '#3a3733', muted: '#9a948a', line: '#e8e3d9',
        accent: '#5f7f6a', accentFg: '#ffffff', soft: 'rgba(95,127,106,.15)',
        lockBg: 'rgba(150,110,60,.14)', lockFg: '#7a5228',
      },
      slate: {
        name: '灰',
        bg: '#f2f3f4', fg: '#2a2d31', muted: '#85898f', line: '#dcdee1',
        accent: '#4a6fa5', accentFg: '#ffffff', soft: 'rgba(74,111,165,.14)',
        lockBg: 'rgba(160,70,60,.13)', lockFg: '#87352b',
      },
    }
    const THEME_ORDER = ['ink', 'night', 'paper', 'slate']
    /**
     * 「定位」提示词：给空白对话用。
     * 目标是最省 token —— 不含背景故事，只给路径、工具调用形状、禁令，
     * 并明令禁止复述/探查/解释，避免模型先想一堆再动手。
     */
    const buildLocatePrompt = (root, cur) => {
      const win = (s) => String(s).replace(/\//g, '\\')
      const lines = ['共写插件已连好。直接做，不要复述任务、不要探查目录、不要解释思路。']
      if (cur) {
        const rel = String(cur)
        lines.push('文件：' + String(root).replace(/\\$/, '') + '\\' + win(rel))
        lines.push('读：coedit_read({path:"' + rel + '"})；写：coedit_write({path:"' + rel + '", text:"…", confirm:"<用户原话>"})')
        lines.push('限定：只追加或改小段；不 ls、不读别的文件、不回滚、不挑版本、不写临时脚本。')
      } else {
        lines.push('共写目录：' + root + '（还没打开具体文件）')
        lines.push('先 coedit_read() 不带参数看概览，再 coedit_read({path:"…"}) 读那一章。')
        lines.push('限定：不 ls、不回滚、不挑版本、不写临时脚本。')
      }
      return lines.join('\n')
    }

    const copyText = async (s) => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(s)
          return true
        }
      } catch { /* 落到下面的兜底 */ }
      try {
        const ta = document.createElement('textarea')
        ta.value = s
        ta.style.position = 'fixed'
        ta.style.top = '-1000px'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch { return false }
    }

    const THEME_KEY = 'dsh-outline-coedit.theme'
    const LAST_KEY = 'dsh-outline-coedit.lastFile'

    const readLastFile = (root) => {
      try {
        const all = JSON.parse(window.localStorage.getItem(LAST_KEY) || '{}')
        return (all && typeof all[root] === 'string') ? all[root] : ''
      } catch { return '' }
    }
    const saveLastFile = (root, rel) => {
      try {
        const all = JSON.parse(window.localStorage.getItem(LAST_KEY) || '{}')
        all[root] = rel
        window.localStorage.setItem(LAST_KEY, JSON.stringify(all))
      } catch { /* 忽略 */ }
    }

    const DICT = {
      zh: {
        label: '共写', guideTitle: '大纲共写',
        guideDescription: '在侧栏直接改正文，AI 在对话里读写同一份文件',
        outline: '大纲', style: '风格', chapters: '章节',
        noFile: '还没有章节，点「新建」开始',
        unsaved: '未保存', saved: '已同步', saving: '保存中',
        reload: '重新读取', backup: '备份', save: '保存',
        locks: '锁定块', backups: '备份', none: '无', chars: '字',
        rollback: '回滚', delBackup: '删除这个备份',
        confirmDel: '删除这个备份？删了就找不回来了。',
        confirmSwitch: '当前文件有未保存改动，确定切换？',
        lockRejected: '锁区被改动，已拒绝保存。',
        newChapter: '新建', prune: '清理', pruneHint: '只留最近几版',
        savedHint: '已保存', backedUp: '上一版备份 ', reloaded: '已重新读取',
        showList: '展开目录', hideList: '收起目录', theme: '配色',
        confirmPrune: '只保留最近几版备份？',
        pick: '选择章节…',
        staleHint: '这个文件在你打开后被改动过（可能是 AI 写的）。已拒绝覆盖，避免丢内容。',
        staleReload: '点确定载入最新版本，点取消保留你现在的编辑。',
        conflictTitle: '磁盘已被外部改动 —— 自动保存已暂停',
        conflictLock: '锁区被改动 —— 自动保存已暂停',
        conflictRead: '载入磁盘版本',
        conflictKeep: '保留我的编辑',
        undo: '撤回', undoHint: '退回 AI 上一次写入之前；你自己保存的内容不受影响',
        undoNone: '还没有备份，没东西可撤回',
        undoDone: '已撤回',
        dirBtn: '目录', changeDir: '切换共写目录',
        currentDir: '共写目录', apply: '切换', cancel: '取消',
        noSubdir: '（没有子文件夹）',
        dirHint: '默认就是当前工作区根目录，选哪个文件夹就直接在那个文件夹里读写，不会再套子目录。',
        workspace: '工作区', reset: '跟随工作区', resetHint: '清掉手动指定，回到 工作区/coedit',
        caretInsert: '放标记', caretHint: '在光标处放续写标记 [[COEDIT:HERE]]，AI 会从这里接着写（Ctrl+Enter）',
        locate: '定位', locateHint: '复制一段极简提示词，粘贴到新对话里，AI 立刻知道改哪个文件',
        locateDone: '已复制。粘贴到新对话，直接说要改什么。',
        locateFail: '自动复制被浏览器拦了，手动全选复制下面这段：',
        locateClose: '收起',
      },
      en: {
        label: 'Co-edit', guideTitle: 'Outline co-edit',
        guideDescription: 'Edit the draft in the sidebar while the agent reads and writes the same file',
        outline: 'Outline', style: 'Style', chapters: 'Chapters',
        noFile: 'No chapter yet — click New',
        unsaved: 'Unsaved', saved: 'In sync', saving: 'Saving',
        reload: 'Reload', backup: 'Backup', save: 'Save',
        locks: 'Locked', backups: 'Backups', none: 'none', chars: ' chars',
        rollback: 'roll back', delBackup: 'Delete this backup',
        confirmDel: 'Delete this backup? It cannot be recovered.',
        confirmSwitch: 'This file has unsaved changes. Switch anyway?',
        lockRejected: 'A locked block changed; save refused.',
        newChapter: 'New', prune: 'Prune', pruneHint: 'Keep latest only',
        savedHint: 'Saved', backedUp: 'Previous version backed up as ', reloaded: 'Reloaded',
        showList: 'Show files', hideList: 'Hide files', theme: 'Theme',
        confirmPrune: 'Keep only the latest backups?',
        pick: 'Select chapter…',
        staleHint: 'This file changed on disk after you opened it (the agent may have written). Save refused to avoid losing content.',
        staleReload: 'OK loads the newest version; Cancel keeps your edits.',
        conflictTitle: 'File changed on disk — autosave paused',
        conflictLock: 'A locked block changed — autosave paused',
        conflictRead: 'Load disk version',
        conflictKeep: 'Keep my edits',
        undo: 'Undo', undoHint: 'Revert to before the last write (restore newest backup)',
        undoNone: 'No backup to undo',
        undoDone: 'Reverted',
        dirBtn: 'Folder', changeDir: 'Change co-edit folder',
        currentDir: 'Co-edit folder', apply: 'Switch', cancel: 'Cancel',
        noSubdir: '(no subfolders)',
        dirHint: 'Defaults to <workspace>/coedit, so it follows the workspace and machine. A picked folder applies to this workspace only.',
        workspace: 'Workspace', reset: 'Follow workspace', resetHint: 'Clear the override and use <workspace>/coedit',
        caretInsert: 'Mark', caretHint: 'Drop a [[COEDIT:HERE]] marker at the caret; the agent continues there (Ctrl+Enter)',
      },
    }

    const detectLang = (ctx) => {
      try {
        const lang = ctx && ctx.locale && typeof ctx.locale.language === 'function' ? ctx.locale.language() : ''
        return String(lang).toLowerCase().startsWith('en') ? 'en' : 'zh'
      } catch {
        return 'zh'
      }
    }

    let workspaceRoot = ''

    const withWs = (route) => BASE + route + (workspaceRoot
      ? (route.includes('?') ? '&' : '?') + 'ws=' + encodeURIComponent(workspaceRoot)
      : '')

    const post = (route, payload) => fetch(withWs(route), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-outline-coedit': '1' },
      body: JSON.stringify(payload || {}),
    }).then((r) => r.json())

    const getJson = (route) => fetch(withWs(route), { headers: { 'x-outline-coedit': '1' } }).then((r) => r.json())

    const readTheme = () => {
      try {
        const v = window.localStorage.getItem(THEME_KEY)
        return v && THEMES[v] ? v : 'ink'
      } catch {
        return 'ink'
      }
    }
    const writeTheme = (v) => { try { window.localStorage.setItem(THEME_KEY, v) } catch { /* 忽略 */ } }

    const GLOBAL_CSS = [
      '@keyframes coedit-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}',
      '.coedit-spin{animation:coedit-spin .55s linear}',
      '.coedit-root,.coedit-root *{box-sizing:border-box}',
      '.coedit-root textarea{box-sizing:border-box;width:100%;max-width:100%;margin:0;display:block;',
      'resize:none;outline:none;overflow-y:auto;overflow-x:hidden;overflow-wrap:break-word;word-break:break-word}',
      '.coedit-files::-webkit-scrollbar{height:6px}',
      '.coedit-files::-webkit-scrollbar-thumb{background:rgba(128,128,128,.35);border-radius:3px}',
    ].join('')

    // 错误边界：任何渲染异常都要显示出来，绝不能白屏。
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      componentDidCatch(error) {
        try { console.error('[outline-coedit] 渲染异常', error) } catch { /* 忽略 */ }
      }
      render() {
        if (this.state.error) {
          const msg = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)
          return h('div', {
            style: { padding: 14, fontSize: 12, lineHeight: 1.6, color: '#8a2b1e', background: '#fdf2f0', height: '100%', overflow: 'auto' },
          },
            h('div', { style: { fontWeight: 600, marginBottom: 6 } }, '共写面板渲染失败'),
            h('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, fontSize: 11 } }, msg),
            h('button', {
              type: 'button',
              style: { marginTop: 10, padding: '3px 10px', cursor: 'pointer' },
              onClick: () => this.setState({ error: null }),
            }, '重试'),
          )
        }
        return this.props.children
      }
    }

    // 最外层安全网：即便 Boundary 自己也炸，也给出可读信息。
    function SafeBody(props) {
      try {
        return h(Boundary, null, h(CoeditBody, props))
      } catch (error) {
        return h('div', { style: { padding: 14, fontSize: 12, color: '#8a2b1e' } },
          '共写面板初始化失败：' + (error && error.message ? error.message : String(error)))
      }
    }

    function CoeditBody(props) {
      const { t } = props
      // 工作区由 host 侧决定（配置 dir / 环境变量），前端不再依赖会话快照。
      // 这样即使 useSessions 不存在或返回结构变了，面板也不会崩。
      // 会话 cwd 就是工作区根。选择器只返回字符串，避免无限重渲染。
      const sessionCwd = props && typeof props.useSessions === 'function' && props.sessionId
        ? (props.useSessions((s) => (s && s.byId ? s.byId[props.sessionId] && s.byId[props.sessionId].cwd : undefined)) || '')
        : ''
      if (sessionCwd) workspaceRoot = sessionCwd
      else if (props && typeof props.workspaceRoot === 'string' && props.workspaceRoot !== '') workspaceRoot = props.workspaceRoot

      const [themeId, setThemeId] = React.useState(readTheme)
      const [state, setState] = React.useState(null)
      const [cur, setCur] = React.useState(null)
      const [text, setText] = React.useState('')
      const [saved, setSaved] = React.useState('')
      const [note, setNote] = React.useState('')
      const [locate, setLocate] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [conflict, setConflict] = React.useState(null)
      const [spinning, setSpinning] = React.useState(false)
      const [listOpen, setListOpen] = React.useState(true)
      const [dirOpen, setDirOpen] = React.useState(false)
      const [browsePath, setBrowsePath] = React.useState('')
      const [browseDirs, setBrowseDirs] = React.useState([])
      const [browseParent, setBrowseParent] = React.useState(null)
      const [dirInput, setDirInput] = React.useState('')
      const curRef = React.useRef(null)
      const myBackupsRef = React.useRef([])
      const stampRef = React.useRef(null)
      curRef.current = cur
      const taRef = React.useRef(null)
      const onWriteHereRef = React.useRef(null)
      const [caretPos, setCaretPos] = React.useState(0)

      const theme = THEMES[themeId] || THEMES.ink
      const dirty = cur !== null && text !== saved

      const loadState = React.useCallback(() => getJson('/state').then((s) => {
        if (s && !s.error) setState(s)
        return s
      }).catch(() => null), [])

      const open = React.useCallback((rel) => {
        if (!rel) return Promise.resolve()
        return getJson('/file?path=' + encodeURIComponent(rel)).then((d) => {
          if (!d || d.error) { setNote(d && d.message ? d.message : 'error'); return }
          setCur(d.path)
          setText(d.content)
          setSaved(d.content)
          stampRef.current = d.stamp || null
          setNote('')
          if (workspaceRoot || d.path) saveLastFile(state && state.root ? state.root : '', d.path)
        }).catch(() => setNote('error'))
      }, [])

      // 首次加载：优先恢复上次选中的文件；没有就打开最后一章（通常是最新进度）。
      React.useEffect(() => {
        let cancelled = false
        loadState().then((s) => {
          if (cancelled || !s || !s.chapters || s.chapters.length === 0) return
          const last = readLastFile(s.root)
          const exists = last && s.chapters.some((c) => c.path === last)
          const target = exists ? last : s.chapters[s.chapters.length - 1].path
          open(target)
        })
        return () => { cancelled = true }
      }, [loadState, open])

      const pick = React.useCallback((rel) => {
        if (!rel) return
        if (dirty && rel !== curRef.current && !window.confirm(t.confirmSwitch)) return
        saveLastFile(state && state.root ? state.root : '', rel)
        setCur(null)
        open(rel)
      }, [dirty, open, t, state])

      const reload = React.useCallback(() => {
        setSpinning(true)
        setTimeout(() => setSpinning(false), 620)
        Promise.resolve(cur === null ? loadState() : open(cur)).then(() => setNote(t.reloaded))
      }, [cur, loadState, open, t])

      // silent = 自动保存：不打断输入、不弹窗、不产生版本文件。
      const save = React.useCallback((force, silent) => {
        if (cur === null) return
        if (silent !== true) setBusy(true)
        post('/save', {
          path: cur,
          content: text,
          force: force === true,
          expectedStamp: stampRef.current,
          noBackup: silent === true,
        }).then((d) => {
          if (silent !== true) setBusy(false)
          if (d && d.error) {
            if (d.error === 'stale-conflict') {
              // 磁盘被外部（AI）改过：停下自动保存，交给人来选，绝不静默覆盖。
              setConflict({ reason: 'stale', disk: typeof d.diskContent === 'string' ? d.diskContent : null })
              return
            }
            if (d.error === 'lock-violation') {
              setConflict({ reason: 'lock', disk: null })
              return
            }
            setNote(d.message || d.error)
            return
          }
          setSaved(text)
          setConflict(null)
          // 关键：拿到新指纹，否则下一次保存会被自己上次的写入判成冲突。
          if (d && d.stamp) stampRef.current = d.stamp
          if (silent !== true) setNote(t.savedHint + (d && d.backup ? ' · ' + t.backedUp + d.backup.file : ''))
          loadState()
        }).catch(() => { if (silent !== true) { setBusy(false); setNote('error') } })
      }, [cur, text, t, loadState])

      // 自动落盘：停手 900 毫秒就写回磁盘。
      // 不自动保存的话，磁盘上是旧内容（新文件甚至一直是空的）——
      // 外部工具一读就读到空，然后整篇写回，人刚写的字就没了。
      React.useEffect(() => {
        if (cur === null || !dirty || conflict) return undefined
        const timer = setTimeout(() => { save(false, true) }, 900)
        return () => clearTimeout(timer)
      }, [cur, text, dirty, conflict, save])

      // 记录光标位置，并在文本变化后保持不跳。
      const syncCaret = React.useCallback(() => {
        const el = taRef.current
        if (!el) return
        setCaretPos(el.selectionStart == null ? 0 : el.selectionStart)
      }, [])

      // 在光标处放一个续写标记 [[COEDIT:HERE]]。
      // 不插入文字、不假设光标还活着：标记是文本的一部分，AI 按字面读得到。
      const writeAtCaret = React.useCallback(() => {
        const el = taRef.current
        if (cur === null || !el) return
        const at = el.selectionStart == null ? text.length : el.selectionStart
        const end = el.selectionEnd == null ? at : el.selectionEnd
        // 已存在标记就先删掉旧的，保证全文件只有一个。
        const existing = /\[\[COEDIT:HERE\]\][ \t]*\n?/g
        let head = text.slice(0, at)
        let tail = text.slice(end)
        const before = (head + tail).match(existing)
        if (before) {
          head = head.replace(existing, '')
          tail = tail.replace(existing, '')
        }
        const glueBefore = head === '' || /\n\s*$/.test(head) ? '' : '\n\n'
        const marker = '[[COEDIT:HERE]]'
        const glueAfter = /\s*$/.test(tail) ? '\n\n' : '\n\n'
        const next = head + glueBefore + marker + glueAfter + tail.replace(/^\s+/, '')
        setText(next)
        const pos = (head + glueBefore + marker + glueAfter).length
        requestAnimationFrame(() => {
          const node = taRef.current
          if (node) { node.focus(); node.setSelectionRange(pos, pos) }
        })
        setNote('已放好续写标记 [[COEDIT:HERE]]，记得保存。之后让我「从标记接着写」就行。')
      }, [cur, text])

      // 光标位置上报给 host：AI 侧可以读到「用户停在哪个字符」。
      const reportTimer = React.useRef(null)
      React.useEffect(() => {
        if (cur === null) return
        if (reportTimer.current) clearTimeout(reportTimer.current)
        reportTimer.current = setTimeout(() => {
          const before = text.slice(0, Math.max(0, Math.min(caretPos, text.length)))
          const line = before.split('\n').length
          post('/caret', { path: cur, index: caretPos, line, tail: before.slice(-60) }).catch(() => {})
        }, 400)
        return () => { if (reportTimer.current) clearTimeout(reportTimer.current) }
      }, [cur, caretPos, text])


      React.useEffect(() => {
        onWriteHereRef.current = () => {
          // Ctrl+Enter：在光标处开一个新段落，交给 AI 或自己接着写。
          writeAtCaret('')
        }
      }, [writeAtCaret])

      const onEditorKeyDown = React.useCallback((e) => {
        const mod = e.ctrlKey || e.metaKey
        if (!mod) return
        if (e.key === 's' || e.key === 'S') { e.preventDefault(); e.stopPropagation(); save(false); return }
        if (e.key === 'r' || e.key === 'R') { e.preventDefault(); e.stopPropagation(); reload(); return }
        // 光标写入：Ctrl+Enter 从光标处续写
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (onWriteHereRef.current) onWriteHereRef.current() }
      }, [save, reload])

      // 下一个章号：优先用 host 给的，其次前端自己按已有文件推算。
      const nextChapterNo = () => {
        if (state && state.nextChapter) return state.nextChapter
        let max = 0
        for (const c of (state && state.chapters) || []) {
          const m = /^chapters\/(\d+)/.exec(c.path) || /^(\d+)/.exec(c.path)
          if (m) max = Math.max(max, Number(m[1]))
        }
        return String(max + 1).padStart(3, '0')
      }

      // 打开目录选择面板，并载入当前目录
      const openDirPicker = React.useCallback(() => {
        setDirOpen(true)
        const start = state && state.root ? state.root : ''
        setDirInput(start)
        const at = start ? start : ''
        getJson('/browse' + (at ? '?path=' + encodeURIComponent(at) : '')).then((d) => {
          if (!d || d.error) return
          setBrowsePath(d.path)
          setBrowseDirs(d.dirs || [])
          setBrowseParent(d.parent)
          if (!dirInput) setDirInput(d.path)
        }).catch(() => {})
      }, [state, dirInput])

      const browseTo = React.useCallback((p) => {
        getJson('/browse?path=' + encodeURIComponent(p)).then((d) => {
          if (!d || d.error) { setNote(d && d.message ? d.message : '无法打开'); return }
          setBrowsePath(d.path)
          setBrowseDirs(d.dirs || [])
          setBrowseParent(d.parent)
          setDirInput(d.path)
        }).catch(() => setNote('浏览失败'))
      }, [])

      const applyDir = React.useCallback(() => {
        const target = (dirInput || browsePath || '').trim()
        if (!target) { setNote('请先选择或填写一个目录'); return }
        setNote('正在切换目录…')
        post('/settings', { dir: target, workspace: workspaceRoot || undefined }).then((d) => {
          if (!d || d.error) { setNote('切换失败：' + (d && d.message ? d.message : '未知错误')); return }
          setNote('已切换到 ' + d.dir)
          setDirOpen(false)
          setCur(null)
          setText('')
          setSaved('')
          return loadState().then((s) => {
            if (!s || !s.chapters || s.chapters.length === 0) return
            const remembered = readLastFile(s.root)
            const ok = remembered && s.chapters.some((c) => c.path === remembered)
            open(ok ? remembered : s.chapters[s.chapters.length - 1].path)
          })
        }).catch((e) => setNote('切换异常：' + String(e && e.message ? e.message : e)))
      }, [dirInput, browsePath, loadState, open])

      // 恢复成「跟着工作区走」的默认目录
      const doResetDir = React.useCallback(() => {
        post('/reset-dir', {}).then((d) => {
          if (!d || d.error) { setNote('恢复失败：' + (d && d.message ? d.message : '?')); return }
          setNote('已恢复默认：' + d.dir)
          setDirOpen(false)
          setCur(null); setText(''); setSaved('')
          return loadState().then((s) => {
            if (s && s.chapters && s.chapters.length > 0) open(s.chapters[0].path)
          })
        }).catch((e) => setNote('恢复异常：' + String(e && e.message ? e.message : e)))
      }, [loadState, open])

      const doNew = () => {
        const name = nextChapterNo() + '.txt'
        setNote('正在新建 ' + name + ' …')
        post('/create', { path: name, content: '' }).then((d) => {
          if (!d) { setNote('新建失败：接口无响应'); return }
          if (d.error) { setNote('新建失败：' + (d.message || d.error)); return }
          setNote('已新建 ' + name)
          return loadState().then(() => { setCur(null); return open(name) })
        }).catch((e) => setNote('新建异常：' + String(e && e.message ? e.message : e)))
      }

      const doLocate = async () => {
        if (!state || !state.root) { setNote('还没连上共写目录，稍等一下重试'); return }
        const prompt = buildLocatePrompt(state.root, cur)
        const ok = await copyText(prompt)
        if (ok) { setLocate(null); setNote(t.locateDone) } else { setLocate(prompt); setNote(t.locateFail) }
      }

      const doBackup = () => {
        if (cur === null) return
        post('/backup', { path: cur }).then((d) => {
          if (d && d.backup) { setNote(t.backedUp + d.backup.file); loadState() }
        })
      }

      const doRollback = (file) => {
        if (cur === null) return
        if (!window.confirm(t.confirmRollback || '回滚到这一版？当前内容会先备份。')) return
        post('/rollback', { path: cur, backup: file }).then((d) => {
          if (d && d.error) { setNote(d.message || d.error); return }
          setNote('→ ' + d.restored)
          loadState().then(() => open(cur))
        })
      }

      // 一键撤回：把当前文件恢复到最新那个备份（= 上一次写入之前的内容）。
      // 撤回 AI 的写入：退到最近一次 AI 写入之前，你自己那几次保存不会被撤掉。
      const doUndo = React.useCallback(() => {
        if (cur === null) return
        setNote('正在撤回 AI 的写入…')
        post('/undo-ai', { path: cur }).then((d) => {
          if (!d || d.error) {
            setNote(d && d.error === 'no-backup' ? t.undoNone : ('撤回失败：' + (d && d.message ? d.message : '?')))
            return
          }
          const base = t.undoDone + '（回到 ' + String(d.target || '').replace('backups/', '') + ' 之前'
          const extra = d.latestUser ? '；你之后保存的 ' + String(d.latestUser).replace('backups/', '') + ' 还在备份里，可从下方列表恢复' : ''
          setNote(base + extra + '）')
          return loadState().then(() => open(cur))
        }).catch((e) => setNote('撤回异常：' + String(e && e.message ? e.message : e)))
      }, [cur, loadState, open, t])

      const doDeleteBackup = (file) => {
        if (!window.confirm(t.confirmDel)) return
        post('/delete-backup', { backup: file }).then((d) => {
          if (d && d.error) { setNote(d.message || d.error); return }
          setNote('已删除 ' + d.deleted)
          loadState()
        })
      }

      const doPrune = () => {
        if (cur === null) return
        if (!window.confirm(t.confirmPrune)) return
        post('/prune', { path: cur, keep: 3 }).then((d) => {
          if (d && d.error) { setNote(d.message || d.error); return }
          setNote('清理了 ' + d.removed.length + ' 个旧备份')
          loadState()
        })
      }

      const doScaffold = () => {
        setNote('正在初始化共写目录…')
        return post('/scaffold', {}).then((d) => {
          if (d && d.error) { setNote('初始化失败：' + (d.message || d.error)); return }
          return loadState().then((s) => {
            if (s && s.chapters && s.chapters.length > 0) open(s.chapters[0].path)
            setNote('已初始化')
          })
        }).catch((e) => setNote('初始化异常：' + String(e && e.message ? e.message : e)))
      }

      const lockedBlocks = React.useMemo(() => {
        const re = /\[\[COEDIT:LOCK_START([^\]]*)\]\]([\s\S]*?)\[\[COEDIT:LOCK_END\]\]/g
        const out = []
        let m
        while ((m = re.exec(text)) !== null) out.push(m[2].trim().slice(0, 26))
        return out
      }, [text])

      const files = []
      if (state) {
        if (typeof state.outline === 'string') files.push({ path: state.outline, label: t.outline })
        if (typeof state.style === 'string') files.push({ path: state.style, label: t.style })
        for (const c of state.chapters) files.push({ path: c.path, label: c.path.replace('chapters/', ''), meta: c.chars + t.chars })
      }
      // 当前章自己的备份，按版本倒序；备份多了只显示最近 30 个，其余仍在目录里。
      // 章节编号从路径里取：可能是 '057.txt'，也可能是旧稿的 'chapters/057.txt'。
      const curNo = cur ? (/^chapters\/(\d+)/.exec(cur) || /^(\d+)/.exec(cur) || [])[1] : null
      // 备份名可能是 '057.v077.txt' 也可能是旧的 'backups/057.v077.txt'
      const bare = (f) => String(f).replace(/^backups\//, '')
      const myBackups = (state ? state.backups : [])
        .filter((f) => (curNo ? bare(f).indexOf(curNo + '.v') === 0 : false))
        .sort()
        .reverse()
      myBackupsRef.current = myBackups

      const rootStyle = {
        display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden',
        fontSize: 13, background: theme.bg, color: theme.fg,
      }
      const chipStyle = (on) => ({
        font: 'inherit', fontSize: 12, padding: '2px 9px', borderRadius: 999, whiteSpace: 'nowrap',
        cursor: 'pointer', flexShrink: 0, background: on ? theme.soft : 'transparent',
        border: '1px solid ' + (on ? theme.accent : theme.line),
        color: on ? theme.accent : theme.fg, fontWeight: on ? 600 : 400,
      })
      const btnStyle = (primary) => ({
        font: 'inherit', fontSize: 12, padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
        whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
        background: primary ? theme.accent : 'transparent',
        border: '1px solid ' + (primary ? theme.accent : theme.line),
        color: primary ? theme.accentFg : theme.fg,
      })

      const top = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, padding: '6px 10px', borderBottom: '1px solid ' + theme.line, flexShrink: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
          h('select', {
            value: cur === null ? '' : cur,
            title: t.pick,
            style: {
              flex: 1, minWidth: 0, font: 'inherit', fontSize: 12, padding: '3px 6px',
              border: '1px solid ' + theme.line, borderRadius: 5,
              background: theme.bg, color: theme.fg, cursor: 'pointer', outline: 'none',
            },
            onChange: (e) => pick(e.target.value),
          },
            cur === null ? h('option', { value: '' }, t.pick) : null,
            ...files.map((f) => h('option', { key: f.path, value: f.path }, f.meta ? f.label + '  ' + f.meta : f.label)),
          ),
          h('button', {
            type: 'button', style: btnStyle(dirOpen), title: t.changeDir,
            onClick: () => (dirOpen ? setDirOpen(false) : openDirPicker()),
          }, '📁 ' + t.dirBtn),
          h('button', { type: 'button', style: btnStyle(false), title: t.newChapter, onClick: doNew }, '+ ' + t.newChapter),
        ),
        state && state.root ? h('div', {
          title: '共写目录：' + state.root,
          style: { fontSize: 10, color: theme.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
        }, state.root.replace(/\\/g, ' › ')) : null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 10, padding: '1px 7px', borderRadius: 99, whiteSpace: 'nowrap', background: dirty ? theme.soft : (theme.line + '66'), color: dirty ? theme.accent : theme.muted } },
            cur === null ? '' : (busy ? t.saving : dirty ? t.unsaved : t.saved)),
          cur === null ? null : h('span', { style: { fontSize: 10, color: theme.muted, whiteSpace: 'nowrap' } },
            '第 ' + (text.slice(0, Math.max(0, Math.min(caretPos, text.length))).split('\n').length) + ' 行'),
          h('span', { style: { flex: 1 } }),
          h('span', { style: { fontSize: 10, color: theme.muted } }, t.theme),
          ...THEME_ORDER.map((id) => h('button', {
            key: id, type: 'button', title: THEMES[id].name,
            style: {
              width: 14, height: 14, borderRadius: 99, padding: 0, cursor: 'pointer',
              border: '2px solid ' + (themeId === id ? theme.accent : 'transparent'),
              background: THEMES[id].bg, boxShadow: 'inset 0 0 0 1px ' + THEMES[id].line,
            },
            onClick: () => { setThemeId(id); writeTheme(id) },
          })),
          h('button', { type: 'button', style: btnStyle(false), disabled: busy, title: t.reload, onClick: reload },
            h('span', { className: spinning ? 'coedit-spin' : '' }, '⟳'), t.reload),
          h('button', { type: 'button', style: btnStyle(false), title: t.locateHint, onClick: doLocate },
            '⌖ ', t.locate),
          h('button', {
            type: 'button', style: btnStyle(false), disabled: busy || cur === null,
            title: t.caretHint,
            onClick: () => writeAtCaret('\\n\\n'),
          }, t.caretInsert),
          h('button', { type: 'button', style: btnStyle(false), disabled: busy || cur === null, onClick: doBackup }, t.backup),
          h('button', {
            type: 'button', style: btnStyle(false), disabled: busy || cur === null,
            title: t.undoHint,
            onClick: doUndo,
          }, '↶ ' + t.undo),
          h('button', { type: 'button', style: btnStyle(true), disabled: busy || cur === null, onClick: () => save(false) }, t.save),
        ),
      )

      const dirPanel = !dirOpen ? null : h('div', {
        style: {
          borderBottom: '1px solid ' + theme.line, padding: '8px 10px',
          background: theme.soft, flexShrink: 0, fontSize: 12,
        },
      },
        h('div', { style: { fontSize: 10, color: theme.muted, marginBottom: 5 } },
          t.workspace + '：' + (state && state.root ? state.root : '—')),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 } },
          h('span', { style: { color: theme.muted, fontSize: 11 } }, t.currentDir),
          h('input', {
            value: dirInput,
            onChange: (e) => setDirInput(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') applyDir() },
            style: {
              flex: 1, minWidth: 0, font: 'inherit', fontSize: 11, padding: '3px 6px',
              border: '1px solid ' + theme.line, borderRadius: 4,
              background: theme.bg, color: theme.fg, outline: 'none',
            },
            spellCheck: false,
          }),
          h('button', { type: 'button', style: btnStyle(true), onClick: applyDir }, t.apply),
          h('button', { type: 'button', style: btnStyle(false), title: t.resetHint, onClick: doResetDir }, t.reset),
          h('button', { type: 'button', style: btnStyle(false), onClick: () => setDirOpen(false) }, t.cancel),
        ),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 } },
          browseParent ? h('button', { type: 'button', style: { font: 'inherit', fontSize: 11, padding: '0 6px', border: '1px solid ' + theme.line, borderRadius: 4, background: 'transparent', color: theme.fg, cursor: 'pointer' }, onClick: () => browseTo(browseParent) }, '↑ 上一级') : null,
          h('span', { style: { color: theme.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, browsePath),
        ),
        h('div', {
          style: { display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 120, overflow: 'auto' },
          className: 'coedit-files',
        },
          browseDirs.length === 0
            ? h('span', { style: { color: theme.muted, fontSize: 11 } }, t.noSubdir)
            : browseDirs.map((d) => h('button', {
              key: d, type: 'button',
              style: {
                font: 'inherit', fontSize: 11, padding: '2px 7px', cursor: 'pointer',
                border: '1px solid ' + theme.line, borderRadius: 4,
                background: theme.bg, color: theme.fg,
              },
              onClick: () => browseTo((browsePath.endsWith('\\') ? browsePath : browsePath + '\\') + d),
            }, d)),
        ),
        h('div', { style: { marginTop: 5, color: theme.muted, fontSize: 10 } }, t.dirHint),
      )

      const editorStyle = {
        flex: '1 1 auto', minHeight: 0, minWidth: 0, border: 0, margin: 0,
        padding: '14px 20px', background: 'transparent', color: theme.fg,
        caretColor: theme.accent, cursor: 'text',
        font: '14px/1.9 ui-monospace, Consolas, "Microsoft YaHei", monospace',
      }

      const body = cur === null
        ? h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: theme.muted, padding: 20, textAlign: 'center' } },
          files.length === 0
            ? h('button', { type: 'button', style: btnStyle(true), onClick: doScaffold }, t.newChapter)
            : h('span', null, t.noFile))
        : h('textarea', {
          ref: taRef,
          style: editorStyle,
          spellCheck: false,
          value: text,
          onChange: (e) => { setText(e.target.value); syncCaret() },
          onKeyDown: onEditorKeyDown,
          onKeyUp: syncCaret,
          onClick: syncCaret,
          onSelect: syncCaret,
        })

      const bottom = h('div', { style: { display: 'flex', gap: 14, padding: '5px 10px', borderTop: '1px solid ' + theme.line, flexShrink: 0, maxHeight: 100, overflow: 'auto', fontSize: 11 } },
        h('div', { style: { minWidth: 0 } },
          h('div', { style: { fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: theme.muted, marginBottom: 3 } }, t.locks + ' ' + lockedBlocks.length),
          lockedBlocks.length === 0
            ? h('span', { style: { color: theme.muted, opacity: .7 } }, t.none)
            : lockedBlocks.map((x, i) => h('span', {
              key: i, title: x,
              style: { display: 'inline-block', background: theme.lockBg, color: theme.lockFg, borderRadius: 4, padding: '1px 6px', margin: '0 4px 3px 0', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' },
            }, x)),
        ),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 } },
            h('span', { style: { fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: theme.muted } }, t.backups + ' ' + myBackups.length),
            myBackups.length > 3 ? h('button', {
              type: 'button', title: t.pruneHint,
              style: { font: 'inherit', fontSize: 10, padding: '0 5px', border: '1px solid ' + theme.line, borderRadius: 3, background: 'transparent', color: theme.muted, cursor: 'pointer' },
              onClick: doPrune,
            }, t.prune) : null,
          ),
          myBackups.length === 0
            ? h('span', { style: { color: theme.muted, opacity: .7 } }, t.none)
            : myBackups.slice(0, 30).map((f) => h('span', { key: f, style: { display: 'inline-flex', alignItems: 'center', margin: '0 4px 3px 0', border: '1px solid ' + theme.line, borderRadius: 4, overflow: 'hidden' } },
              h('button', {
                type: 'button', title: t.rollback,
                style: { font: 'inherit', fontSize: 10, padding: '1px 6px', border: 0, background: 'transparent', color: theme.fg, cursor: 'pointer' },
                onClick: () => doRollback(f),
              }, f.replace('backups/', '').replace(/\.(md|txt)$/, '')),
              h('button', {
                type: 'button', title: t.delBackup,
                style: { font: 'inherit', fontSize: 10, padding: '1px 5px', border: 0, borderLeft: '1px solid ' + theme.line, background: 'transparent', color: theme.muted, cursor: 'pointer' },
                onClick: () => doDeleteBackup(f),
              }, '×'),
            )),
          myBackups.length > 30 ? h('span', { style: { color: theme.muted, fontSize: 10 } }, '… 其余 ' + (myBackups.length - 30) + ' 个已收进隐藏目录') : null,
        ),
      )

      const conflictBar = !conflict ? null : h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '6px 10px', flexShrink: 0,
          background: theme.lockBg, borderTop: '1px solid ' + theme.line, borderBottom: '1px solid ' + theme.line,
        },
      },
        h('span', { style: { fontSize: 11, color: theme.lockFg, flex: 1, minWidth: 140 } },
          conflict.reason === 'lock' ? t.conflictLock : t.conflictTitle),
        h('button', {
          type: 'button', style: btnStyle(false),
          onClick: () => { setConflict(null); open(cur) },
        }, t.conflictRead),
        h('button', {
          type: 'button', style: btnStyle(true),
          onClick: () => { setConflict(null); save(true, false) },
        }, t.conflictKeep),
      )

      const locateBox = !locate ? null : h('div', {
        style: { borderTop: '1px solid ' + theme.line, padding: '6px 10px', background: theme.soft, flexShrink: 0 },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
          h('span', { style: { fontSize: 10, color: theme.muted, flex: 1 } }, t.locateFail),
          h('button', { type: 'button', style: btnStyle(false), onClick: () => setLocate(null) }, t.locateClose),
        ),
        h('textarea', {
          readOnly: true,
          value: locate,
          rows: 5,
          autoFocus: true,
          onFocus: (e) => e.target.select(),
          style: {
            width: '100%', boxSizing: 'border-box', font: 'inherit', fontSize: 11,
            lineHeight: 1.55, padding: '6px 8px', borderRadius: 6, resize: 'vertical',
            background: theme.bg, color: theme.fg, border: '1px solid ' + theme.line,
          },
        }),
      )

      return h('div', { style: rootStyle, className: 'coedit-root' },
        h('style', null, GLOBAL_CSS),
        top,
        dirPanel,
        body,
        conflictBar,
        locateBox,
        bottom,
        note ? h('div', { style: { padding: '3px 12px', fontSize: 11, color: theme.muted, borderTop: '1px solid ' + theme.line, flexShrink: 0 } }, note) : null,
      )
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'],
      apply(ctx) {
        const t = DICT[detectLang(ctx)] || DICT.zh
        const Body = (props) => h(SafeBody, Object.assign({}, props, { t }))

        // 先确认服务在不在，缺了就明确报错，而不是抛异常导致整个插件被卸载。
        const missing = []
        if (!ctx.slots) missing.push('slots')
        if (!ctx.sidebarRightTabs) missing.push('sidebarRightTabs')
        if (!ctx.sidebarRight) missing.push('sidebarRight')
        if (missing.length > 0) {
          ctx.logger?.warn?.('[outline-coedit] 缺少服务：' + missing.join(', '))
          return
        }

        ctx.effect(() => {
          try {
            return ctx.sidebarRightTabs.register({
              id: ID,
              kind: KIND,
              priority: 'builtin',
              title: () => t.label,
              guide: [{
                id: 'coedit',
                order: 20,
                title: () => t.guideTitle,
                description: () => t.guideDescription,
              }],
            })
          } catch (error) {
            ctx.logger?.warn?.('[outline-coedit] 注册 tab 类型失败：' + (error && error.message ? error.message : error))
            console.error('[outline-coedit] 注册 tab 类型失败', error)
            return undefined
          }
        }, 'outline-coedit: tab type')

        ctx.effect(() => {
          try {
            return ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
              { name: 'sidebar.right.pane.tab', key: ID }, Body,
            ))
          } catch (error) {
            console.error('[outline-coedit] 注册 tab body 失败', error)
            return undefined
          }
        }, 'outline-coedit: tab body')

        ctx.effect(() => {
          try {
            return ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
              { name: 'sidebar.right.pane.tab.title', key: ID },
              () => h(React.Fragment, null, '\u25A4 ', t.label),
            ))
          } catch (error) {
            console.error('[outline-coedit] 注册 tab title 失败', error)
            return undefined
          }
        }, 'outline-coedit: tab title')
      },
    }
  },
})
