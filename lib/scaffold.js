/**
 * 脚手架：只建目录和最少文件，不生成任何模板内容。
 * 人类不需要 AI 替他写「题材：」「主角：」这种空表。
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createStore } from './files.js'
import { writeStart } from './start.js'

export function scaffold(root, options = {}) {
  const store = createStore(root, options)
  store.ensureDirs()

  const w = (rel, content) => {
    const target = path.join(root, rel)
    if (existsSync(target)) return false
    writeFileSync(target, content, 'utf8')
    return true
  }

  // 空正文放在选中的文件夹里（不建 chapters/ 子目录），跟用户习惯一致。
  // 不建 outline.txt（用户有自己的大纲就跟他说，没有就不该出现空表）。
  // 不建 style-rules.txt（同上，等用户真的给了规则再建）。
  w('001.txt', '')
  // 纪律说明：AI 读这个，人类可以改。
  try {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const skillPath = path.join(here, '..', 'skill', 'SKILL.md')
    if (existsSync(skillPath)) w('AGENTS.md', readFileSync(skillPath, 'utf8'))
  } catch { /* 忽略 */ }
  writeStart(root)
  return store
}
