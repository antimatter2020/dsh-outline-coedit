/**
 * 生成 START.txt：新对话读这一个文件就够，不再依赖 AGENTS.md。
 * 规则写死在生成器里，保证任何目录都有。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const RULES = [
  '规则：',
  '- 纯文本 .txt，不写 Markdown 记号，段落空一行。',
  '- 禁止自作主张：用户没说写就不要建文件、不要补大纲、不要顺手改别的章。',
  '- 先重读目标文件再动笔；只能追加，或替换用户点名的那段。',
  '- [[COEDIT:LOCK_START]] 与 [[COEDIT:LOCK_END]] 之间一字不动。',
  '- [[COEDIT:HERE]] 之后续写；没有标记就追加到末尾。',
  '- 写完一句说清改了哪个文件、多少字。',
]

export function buildStart(root) {
  const read = (rel) => {
    try { return existsSync(path.join(root, rel)) ? readFileSync(path.join(root, rel), 'utf8') : '' } catch { return '' }
  }
  // 章节就在根目录；残留的 chapters/ 只在根目录没章节时才接管（不丢旧稿）。
  const chaptersDir = path.join(root, 'chapters')
  const fromSub = existsSync(chaptersDir)
    ? readdirSync(chaptersDir).filter((f) => /^\d+\.(md|txt)$/i.test(f)).map((f) => ({ name: f, dir: chaptersDir }))
    : []
  const fromRoot = readdirSync(root)
    .filter((f) => /^\d+\.(md|txt)$/i.test(f))
    .sort()
    .map((f) => ({ name: f, dir: root }))
  const chapters = (fromRoot.length > 0 ? fromRoot : fromSub)
    .sort((a, b) => a.name.localeCompare(b.name))

  const lines = []
  lines.push('共写状态（自动生成，勿手改）')
  lines.push('')

  const outline = read('outline.txt') || read('outline.md')
  if (outline.trim() !== '') {
    const filled = outline.split('\n').filter((l) => l.includes('：') && l.split('：').slice(1).join('：').trim() !== '')
    if (filled.length > 0) {
      lines.push('大纲：')
      for (const l of filled.slice(0, 8)) lines.push('  ' + l.trim())
      lines.push('')
    }
  }

  if (chapters.length === 0) {
    lines.push('章节：还没有')
  } else {
    lines.push('章节：')
    for (const c of chapters.slice(-5)) {
      const f = c.name
      const body = readFileSync(path.join(c.dir, f), 'utf8')
      const chars = body.replace(/\s/g, '').length
      const locks = (body.match(/\[\[COEDIT:LOCK_START/g) || []).length
      const here = body.includes('[[COEDIT:HERE]]') ? ' [有标记]' : ''
      lines.push('  ' + f + '  ' + chars + '字' + (locks ? ' · ' + locks + '锁区' : '') + here)
    }
    if (chapters.length > 5) lines.push('  …共 ' + chapters.length + ' 章')

    const last = chapters[chapters.length - 1]
    const clean = readFileSync(path.join(last.dir, last.name), 'utf8').replace(/\[\[COEDIT:[^\]]*\]\]/g, '').trim()
    const tail = clean.slice(-260).trim()
    if (tail !== '') {
      lines.push('')
      lines.push('上一章结尾（' + last.name + '）：')
      for (const l of tail.split('\n').filter(Boolean).slice(-4)) lines.push('  ' + l.trim())
    }
  }
  lines.push('')

  const style = read('style/style-rules.txt')
  const styleFilled = style.split('\n').filter((l) => l.includes('：') && l.split('：').slice(1).join('：').trim() !== '')
  if (styleFilled.length > 0) {
    lines.push('风格：')
    for (const l of styleFilled.slice(0, 4)) lines.push('  ' + l.trim())
    lines.push('')
  }

  lines.push(...RULES)
  return lines.join('\n') + '\n'
}

export function writeStart(root) {
  try {
    writeFileSync(path.join(root, 'START.txt'), buildStart(root), 'utf8')
    return true
  } catch {
    return false
  }
}
