/**
 * 单元测试（零依赖）：纯文本文件层 + 锚点 + 备份回滚。
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createStore, safeRel, locks, locksIntact, appendBody } from './lib/files.js'
import { scaffold } from './lib/scaffold.js'
import { buildStart } from './lib/start.js'
import { registerCoeditTools } from './lib/tools.js'

const results = []

// 工具 schema 必须符合 DSH 的 JSON schema 子集：
// required 只能是对象级字符串数组，属性级 required:true 会让整批注册失败且被 try/catch 吞掉。
{
  const { READ_SPEC, WRITE_SPEC, schemaProblems } = await import('./lib/tools.js')
  for (const [name, spec] of [['coedit_read', READ_SPEC], ['coedit_write', WRITE_SPEC]]) {
    const probs = schemaProblems(spec.output.schema, name + '.output')
    results.push({ name: name + ' 的 output.schema 符合 DSH 子集', ok: probs.length === 0, error: probs.join('; ') })
  }
}

// 注意：check 必须 await fn()。之前写成同步调用，异步断言抛的错变成 unhandled rejection，
// 测试照样显示 PASS —— "deps is not defined" 就是这么漏过去的。
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }) } catch (e) { results.push({ name, ok: false, error: e.message }) }
}
function fresh() {
  const root = mkdtempSync(path.join(tmpdir(), 'coedit-unit-'))
  scaffold(root)
  return createStore(root)
}

await check('脚手架只建正文，不造模板', () => {
  const s = fresh()
  const st = s.state()
  assert.equal(st.chapters.length, 1)
  assert.equal(st.chapters[0].path, '001.txt', '空目录默认写在根目录')
  assert.equal(st.outline, null, '不应自动生成大纲模板')
  assert.equal(st.style, null, '不应自动生成风格模板')
  assert.equal(readFileSync(path.join(s.root, '001.txt'), 'utf8'), '')
})

await check('appendBody 插在 [[COEDIT:END]] 之前', () => {
  const src = 'A\n\n[[COEDIT:WRITE_HERE]]\n\n[[COEDIT:END]]\n'
  const out = appendBody(src, 'B')
  assert.ok(out.indexOf('B') < out.indexOf('[[COEDIT:END]]'))
  assert.ok(out.indexOf('A') < out.indexOf('B'))
})

await check('appendBody 无锚点追加到末尾', () => {
  assert.equal(appendBody('A\n', 'B').trim(), 'A\n\nB')
  assert.equal(appendBody('', 'B').trim(), 'B')
})

await check('锁区（纯文本方括号）可判定', () => {
  const a = 'x\n[[COEDIT:LOCK_START s]]\n原文\n[[COEDIT:LOCK_END]]\ny'
  assert.deepEqual(locks(a), ['原文'])
  assert.equal(locksIntact(a, a.replace('原文', '被改')), false)
  assert.equal(locksIntact(a, a + '\n追加'), true)
})

await check('锁区（旧 md 注释）仍兼容读取', () => {
  const a = '<!-- COEDIT:LOCK_START s -->\n原文\n<!-- COEDIT:LOCK_END -->'
  assert.deepEqual(locks(a), ['原文'])
})

await check('safeRel 拒绝越界与 docx', () => {
  assert.throws(() => safeRel('../../etc/passwd'))
  assert.throws(() => safeRel('a.docx'))
  assert.equal(safeRel('chapters/001.txt'), 'chapters/001.txt')
})

await check('测试2 用户改稿后继续：保留改动且追加', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), '我手动改过这句。\n')
  s.append('001.txt', 'AI 追加的新段落。')
  const after = s.read('001.txt')
  assert.ok(after.includes('我手动改过这句'))
  assert.ok(after.indexOf('AI 追加的新段落。') > after.indexOf('我手动改过这句'))
  assert.ok(s.state().backups.length >= 1)
})

await check('测试3 锁区被改 → 拒绝保存且文件不变', () => {
  const s = fresh()
  const locked = '正文。\n[[COEDIT:LOCK_START s]]\n用户资产\n[[COEDIT:LOCK_END]]\n'
  writeFileSync(path.join(s.root, '001.txt'), locked)
  let threw = null
  try { s.save('001.txt', locked.replace('用户资产', '被改了')) } catch (e) { threw = e }
  assert.ok(threw && threw.code === 'lock-violation')
  assert.ok(s.read('001.txt').includes('用户资产'))
  s.save('001.txt', locked + '锁区外追加。\n')
})

await check('测试4 只改指定段：前后不动', () => {
  const s = fresh()
  const src = '前文。\n他拿起手机。旧内容。她没有回答。\n后文。\n'
  writeFileSync(path.join(s.root, '002.txt'), src)
  s.save('002.txt', src.replace('旧内容', '新内容'))
  const after = s.read('002.txt')
  assert.ok(after.includes('前文。') && after.includes('后文。'))
  assert.ok(after.includes('新内容') && !after.includes('旧内容'))
})

await check('测试5 回滚：恢复旧版且不误伤其他章', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '002.txt'), 'v1\n')
  s.save('002.txt', 'v2\n')
  s.save('002.txt', 'v3\n')
  const bks = s.state().backups.sort()
  const v1 = bks.find((f) => /^002\.v001\.txt$/.test(f))
  assert.ok(v1, '备份应在 state 里可见')
  s.rollback('002.txt', v1)
  assert.equal(s.read('002.txt'), 'v1\n')
  assert.ok(existsSync(path.join(s.root, '001.txt')))
  assert.equal(existsSync(path.join(s.root, 'backups')), false, '备份不应出现在共写目录')
})


await check('新建文件：不覆盖已有文件', () => {
  const s = fresh()
  const name = s.nextChapterName()
  assert.equal(name, '002.txt', '根目录布局下新章落在根目录')
  s.create(name, '新章\n')
  assert.equal(s.read(name), '新章\n')
  assert.throws(() => s.create(name, 'x'), /已存在/)
  assert.equal(s.state().chapters.length, 2)
})

await check('删除备份：从隐藏目录删，非法名报错', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), 'a\n')
  s.save('001.txt', 'b\n')
  const bk = s.state().backups[0]
  assert.ok(bk)
  s.deleteBackup(bk)
  assert.equal(s.state().backups.length, 0)
  assert.throws(() => s.deleteBackup('../evil.txt'), /不存在/)
})

await check('清理备份：只留最近 N 版', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), 'v0\n')
  for (let i = 1; i <= 6; i += 1) s.save('001.txt', 'v' + i + '\n')
  assert.ok(s.state().backups.length >= 6)
  const r = s.pruneBackups('chapters/001.txt', 3)
  assert.equal(s.state().backups.length, 3)
  assert.equal(r.removed.length >= 3, true)
})


await check('HERE 标记：插在标记之后，标记保留', () => {
  const src = '前文。\n\n[[COEDIT:HERE]]\n\n后文。\n'
  const out = appendBody(src, '新内容。')
  assert.ok(out.includes('[[COEDIT:HERE]]'), '标记必须保留')
  assert.ok(out.indexOf('新内容。') > out.indexOf('[[COEDIT:HERE]]'), '新内容在标记之后')
  assert.ok(out.indexOf('新内容。') < out.indexOf('后文。'), '新内容在后文之前')
})

await check('HERE 优先级高于 END', () => {
  const src = 'A\n\n[[COEDIT:HERE]]\n\nB\n\n[[COEDIT:END]]\n'
  const out = appendBody(src, 'C')
  assert.ok(out.indexOf('C') > out.indexOf('[[COEDIT:HERE]]'))
  assert.ok(out.indexOf('C') < out.indexOf('[[COEDIT:END]]'))
  assert.ok(out.indexOf('C') < out.indexOf('B'))
})

await check('无任何标记时追加到末尾', () => {
  assert.equal(appendBody('A\n', 'B').trim(), 'A\n\nB')
})


await check('START.txt 随脚手架生成，且一屏能读完', () => {
  const s = fresh()
  const start = buildStart(s.root)
  assert.ok(start.includes('共写状态'))
  assert.ok(start.length < 1200, 'START 应保持精简，实际 ' + start.length)
})

await check('START.txt 反映最新状态（章节/字数/锁区/标记）', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '002.txt'), '前文。\n\n[[COEDIT:HERE]]\n\n[[COEDIT:LOCK_START s]]\n锁\n[[COEDIT:LOCK_END]]\n')
  const start = buildStart(s.root)
  assert.ok(start.includes('002.txt'))
  assert.ok(start.includes('锁区'))
  assert.ok(start.includes('[有标记]'))
})


await check('外部改动后保存会被拦截（不覆盖 AI 内容）', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), '用户内容\n')
  const stamp = s.stampOf('001.txt')
  // 模拟 AI 直接改盘
  writeFileSync(path.join(s.root, '001.txt'), '用户内容 + AI续写\n')
  let threw = null
  try {
    s.save('001.txt', '用户内容\n', { expectedStamp: stamp })
  } catch (e) { threw = e }
  assert.ok(threw && threw.code === 'stale-conflict')
  assert.ok(s.read('001.txt').includes('AI续写'), 'AI 写的内容必须保留')
})

await check('连续保存不会自己把自己判成冲突（save 必须回传新指纹）', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), '第一版\n')
  const r1 = s.save('001.txt', '第二版\n', { expectedStamp: s.stampOf('001.txt') })
  assert.ok(r1.stamp, 'save 返回里必须带 stamp')
  // 用回传的指纹接着保存——以前这里会 409，用户改的字被自己上次的写入挤掉。
  const r2 = s.save('001.txt', '第三版\n', { expectedStamp: r1.stamp })
  assert.equal(r2.ok, true)
  assert.equal(s.read('001.txt'), '第三版\n')
})

await check('force 可以强制覆盖', () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), 'a\n')
  const stamp = s.stampOf('001.txt')
  writeFileSync(path.join(s.root, '001.txt'), 'b\n')
  s.save('001.txt', 'c\n', { expectedStamp: stamp, force: true })
  assert.equal(s.read('001.txt'), 'c\n')
})


await check('原生工具：只注册 2 个，没有 undo（回滚是用户的权限）', () => {
  const defs = {}
  const s = fresh()
  registerCoeditTools({ tools: { register: (d) => { defs[d.name] = d; return () => {} } }, logger: {} },
    { store: () => s, writeStart: () => {} })
  assert.deepEqual(Object.keys(defs).sort(), ['coedit_read', 'coedit_write'])
  assert.equal(defs.coedit_write.parameters.mode.enum.includes('create'), false, '不能新建文件')
  assert.equal(defs.coedit_write.parameters.confirm.required, true, '必须引用用户原话')
})

function wire(s) {
  const defs = {}
  registerCoeditTools({ tools: { register: (d) => { defs[d.name] = d; return () => {} } }, logger: {} },
    { store: (rel) => { assert.ok(typeof rel === 'string' || rel === undefined); return s }, writeStart: () => {} })
  return defs
}

await check('原生工具：read 无 path 返回概览，有 path 返回正文', async () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), '甲乙丙\n')
  const defs = wire(s)
  assert.equal((await defs.coedit_read.execute({ path: '001.txt' })).content, '甲乙丙\n')
  const ov = await defs.coedit_read.execute({})
  assert.equal(ov.chapters.length, 1)
  assert.ok(ov.message.includes('001.txt'))
})

await check('原生工具：execute 真的能跑（防闭包丢失）', async () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), '开头\n')
  const defs = wire(s)
  const r = await defs.coedit_write.execute({ path: '001.txt', text: '后面\n', confirm: '继续写' })
  assert.equal(r.ok, true)
  assert.ok(readFileSync(path.join(s.root, '001.txt'), 'utf8').includes('后面'))
})

await check('原生工具：没有 confirm 一律拒绝写入', async () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), '开头\n')
  const defs = wire(s)
  await assert.rejects(() => defs.coedit_write.execute({ path: '001.txt', text: '偷写\n' }), /confirm/)
  assert.equal(readFileSync(path.join(s.root, '001.txt'), 'utf8'), '开头\n')
})

// —— 备份目录曾被坏工作区带到 C:\Users 下，写入因此全挂；下面三条守住这个坑 ——

await check('坏工作区（C:\\Users）不会被当成备份根', async () => {
  const s = fresh()
  writeFileSync(path.join(s.root, '001.txt'), '旧\n')
  const bad = createStore(s.root, { workspace: 'C:\\Users' })
  const r = bad.save('001.txt', '新\n')
  assert.equal(r.ok, true)
  const expectDir = path.join(path.dirname(s.root), '.coedit-backups', path.basename(s.root))
  assert.ok(existsSync(path.join(expectDir, r.backup.file)), '备份应落在共写目录旁边，而不是 C:\\Users')
})

await check('备份目录建不出来时跳过备份，正文照样写入', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'coedit-block-'))
  const root = path.join(base, '周2')
  scaffold(root)
  writeFileSync(path.join(root, '001.txt'), '旧\n')
  // 用同名文件占住 .coedit-backups 的位置，两层退路都建不出来
  writeFileSync(path.join(base, '.coedit-backups'), '占位')
  const st = createStore(root, { workspace: base })
  const r = st.save('001.txt', '新\n')
  assert.equal(r.ok, true, '备份失败不能挡住正文')
  assert.equal(r.backup, null)
  assert.equal(readFileSync(path.join(root, '001.txt'), 'utf8'), '新\n')
  assert.equal(st.state().chapters.length, 1, 'state 也不能因为备份目录坏掉就抛错')
  assert.equal(st.logDir(), null)
})

const passed = results.filter((r) => r.ok).length
for (const r of results) console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '\n      ' + r.error))
console.log('\n结果: ' + passed + '/' + results.length)
process.exit(passed === results.length ? 0 : 1)
