/**
 * 静态检查：Hooks 依赖数组里引用的变量，声明必须在使用之前。
 * 专门防「Cannot access 'X' before initialization」这类暂时性死区。
 */
import { readFileSync } from 'node:fs'

const files = ['client.js', 'index.js', 'lib/files.js', 'lib/scaffold.js']
let bad = 0

for (const file of files) {
  const src = readFileSync(new URL('./' + file, import.meta.url), 'utf8')
  const lines = src.split('\n')

  // 收集声明的名字及行号：const/let/function，以及解构赋值。
  const decls = new Map()
  lines.forEach((l, i) => {
    const m = /^\s*(?:const|let|function)\s+(\w+)/.exec(l)
    if (m && !decls.has(m[1])) decls.set(m[1], i + 1)
    // const { a, b } = ... 视为在使用前已声明
    const d = /^\s*(?:const|let)\s*\{([^}]*)\}\s*=/.exec(l)
    if (d) {
      for (const raw of d[1].split(',')) {
        const name = raw.split(':').pop().trim().replace(/=.*$/, '').trim()
        if (name && !decls.has(name)) decls.set(name, 0)
      }
    }
  })

  // 检查依赖数组
  for (let i = 0; i < lines.length; i += 1) {
    const dep = /\},\s*\[([^\]]*)\]\)\s*$/.exec(lines[i])
    if (!dep) continue
    for (const raw of dep[1].split(',')) {
      const name = raw.trim()
      if (!name) continue
      const at = decls.get(name)
      if (at && at > i + 1) {
        console.log('FAIL  ' + file + ':' + (i + 1) + '  依赖 ' + name + ' 定义在后面第 ' + at + ' 行')
        bad += 1
      }
    }
  }
}

// 检查 JSX/箭头函数里引用的名字是否在声明之后被调用（粗筛：函数体内第一次出现的位置）
for (const file of files) {
  const src = readFileSync(new URL('./' + file, import.meta.url), 'utf8')
  const lines = src.split('\n')
  const decls = new Map()
  lines.forEach((l, i) => {
    const m = /^\s*const\s+(\w+)\s*=\s*React\.useCallback/.exec(l)
    if (m) decls.set(m[1], i + 1)
  })
  for (const [name, at] of decls) {
    lines.forEach((l, i) => {
      if (i + 1 >= at) return
      if (new RegExp('\\b' + name + '\\s*\\(').test(l) && !l.includes('const ' + name)) {
        console.log('FAIL  ' + file + ':' + (i + 1) + '  提前调用了 ' + name + '（定义在第 ' + at + ' 行）')
        bad += 1
      }
    })
  }
}

console.log(bad === 0 ? '\n静态检查通过：无暂时性死区' : '\n共 ' + bad + ' 处问题')
process.exit(bad === 0 ? 0 : 1)
