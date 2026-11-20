/**
 * 冒烟测试：用假 ctx 真正 apply 一次插件，再调用工具。
 * 这一步覆盖"注册成功但 execute 报错"这类只在宿主里才暴露的问题。
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const home = mkdtempSync(path.join(tmpdir(), 'coedit-home-'))
process.env.USERPROFILE = home
process.env.HOME = home
mkdirSync(path.join(home, '.dsh'), { recursive: true })

const ws = mkdtempSync(path.join(tmpdir(), 'coedit-ws-'))
const bookDir = path.join(ws, '测试')
mkdirSync(bookDir, { recursive: true })
writeFileSync(path.join(bookDir, '001.txt'), '正文开头\n', 'utf8')

// 侧栏"最近选过的目录"
writeFileSync(path.join(home, '.dsh', 'outline-coedit-settings.json'),
  JSON.stringify({ workspaces: { [ws]: bookDir }, latestDir: bookDir }, null, 2), 'utf8')

const tools = {}
const ctx = {
  get: (name) => {
    if (name === 'tools') return { register: (d) => { tools[d.name] = d; return () => {} } }
    if (name === 'systemPrompt') return { section: () => () => {} }
    if (name === 'webServer') return { register: () => () => {} }
    return undefined
  },
  effect: (fn) => { fn(); return () => {} },
  logger: { info() {}, warn() {}, error() {} },
}

const mod = await import('./index.js')
mod.apply(ctx, {})

const checks = []
const check = async (name, fn) => {
  try { await fn(); checks.push([name, true]) } catch (e) { checks.push([name, false, e.message]) }
}

await check('工具注册到位', async () => {
  assert.deepEqual(Object.keys(tools).sort(), ['coedit_read', 'coedit_write'])
})

await check('coedit_read 按会话目录读到正文', async () => {
  const r = await tools.coedit_read.execute({ path: '001.txt' })
  assert.equal(r.content, '正文开头\n')
})

await check('coedit_write 追加落到同一本书', async () => {
  const r = await tools.coedit_write.execute({ path: '001.txt', text: '续写一句\n', confirm: '继续写' })
  assert.equal(r.ok, true)
  assert.ok(readFileSync(path.join(bookDir, '001.txt'), 'utf8').includes('续写一句'))
})

await check('coedit_read 不带 path 给概览', async () => {
  const r = await tools.coedit_read.execute({})
  assert.ok(r.message.includes('001.txt'), r.message)
})

let failed = 0
for (const [name, ok, err] of checks) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '\n      ' + err))
  if (!ok) failed++
}
console.log('\n冒烟: ' + (checks.length - failed) + '/' + checks.length)
process.exit(failed ? 1 : 0)
