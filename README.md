# dsh-outline-coedit · 大纲共写侧栏插件

在 DSH 右侧栏直接改正文，AI 在对话区读写**同一份文件**。
没有第二份副本，没有「生成完再复制粘贴」。正文是**纯文本 .txt**，不带任何 Markdown 语法。

## 界面

上下分布：

```text
┌───────────────────────────────────┐
│ [文件选择▾]  已同步   ⟳ 重新读取 备份 保存 │  ← 顶栏
├───────────────────────────────────┤
│                                   │
│   写作区（占满剩余宽度）              │  ← 主区
│                                   │
├───────────────────────────────────┤
│ 锁定块 2   |  备份 7   v007 v006 …  │  ← 底栏
└───────────────────────────────────┘
```

目录和附件都不再占左右两栏，写作区拿到全部宽度。
「重新读取」按钮点击时图标转一圈，表示真的重新读了盘。

打开方式：右侧栏引导页的「大纲共写」卡片。

快捷键（焦点在面板里时生效，不会抢宿主的 Ctrl+F）：

| 键 | 作用 |
| --- | --- |
| Ctrl+S | 保存 |
| Ctrl+R | 重新读取 |
| Ctrl+F | 查找（有选中就先填进去） |
| Ctrl+H | 查找并替换 |
| Enter / Shift+Enter | 查找框里跳到下一个 / 上一个 |
| F3 / Shift+F3 | 同上，查找框不用聚焦 |
| Esc | 关掉查找条，焦点回正文 |
| Ctrl+Enter | 在光标处放续写标记 |

查找条里的 `Aa` 管大小写，计数显示「当前位置 / 总数」。
命中位置用原生选区标出来——编辑框做不到给单个词上底色，
所以输入关键词时不抢焦点（能接着打字），按 Enter 或 ↑ ↓ 才把光标送到命中处。

## 格式：纯文本

正文是 `.txt`。不写 `#` 标题、不写 `**加粗**`、不写 `- 列表`、不写 `>` 引用。
段落之间空一行。

锚点用纯文本方括号，不再用 HTML 注释：

```text
正文……

[[COEDIT:END]]
```

- 续写插在 `[[COEDIT:END]]` 之前；没有锚点就追加到末尾。
- `[[COEDIT:LOCK_START 名]] … [[COEDIT:LOCK_END]]`：改动会被 **409 拒绝**，文件保持原样。
- `[[COEDIT:AI_BLOCK_START 名]] … [[COEDIT:AI_BLOCK_END]]`：只有说「重写这一块」才动。
- 旧的 `<!-- COEDIT:… -->` 写法仍能读取，但不再生成。

## 给其他 AI 的说明

插件自带 [AGENTS.md](AGENTS.md)，会随脚手架写进共写目录。
里面的内容就是给其他 AI（和未来的自己）看的操作手册：格式红线、锚点、允许的四类动作、
动手前检查清单、写完自查表、人类常用指令对照表。

同时 Host 半会把一份精简版协议注入系统提示，AI 每次动笔前都会看到。

## 接口

同源；POST 必须带 `x-outline-coedit: 1`；工作区用 `?ws=<urlencoded 路径>` 传。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/dsh-outline-coedit/state` | 目录、章节（字数）、备份列表 |
| GET | `/dsh-outline-coedit/file?path=` | 读一个共写文件 |
| POST | `/dsh-outline-coedit/save` | `{path,content,force?}` 先备份后写；锁区被改 → 409 |
| POST | `/dsh-outline-coedit/append` | `{path,body}` 只在 END 前追加 |
| POST | `/dsh-outline-coedit/backup` | `{path}` |
| POST | `/dsh-outline-coedit/rollback` | `{path,backup}`，回滚前内容另存 |
| POST | `/dsh-outline-coedit/scaffold` | 建共写目录骨架 |
| GET/POST | `/dsh-outline-coedit/settings` | 读/改共写目录 |
| GET | `/dsh-outline-coedit/browse?path=` | 浏览文件夹 |
| GET | `/dsh-outline-coedit/context` | 新对话上下文快照 |
| POST | `/dsh-outline-coedit/reset-dir` | 恢复成 工作区/coedit |

沙箱：只允许共写目录内的 `.md/.txt/.json`；拒绝 `..`、盘符、`.git`；`.docx` 一律拒绝。

## 备份放哪

备份和操作日志都在工作区里，不在共写目录内，AI 看不到：

    <工作区>/.coedit-backups/<共写目录名>/001.v007.txt
    <工作区>/.coedit-backups/<共写目录名>/logs/001.history.txt

绝不会写到 `~`、`C:\Users` 或用户电脑的其他位置。万一备份目录建不出来（权限、占位文件），
插件会退到共写目录的上一级再试一次；两次都失败就**跳过备份照常写入**——备份是保险，不是门禁。

## 安装 / 更新

```bash
npx @deepseek-ai/dsh plugin --profile web add github:<你的用户名>/dsh-outline-coedit
```

重启 DSH Desktop，再到右侧栏选择共写目录。

## 测试

```powershell
npm test    # 27 项单元测试 + 4 项冒烟，全通过才算出货
```

## 明确不做

OT/CRDT、多人实时同步、多 Agent 并发写同一文件、docx 原地改写、自动整本生成、无确认自动保存。
