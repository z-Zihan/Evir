---
name: todo-list-promax
version: "2.2.0"
description: >
  个人待办事项永久存储、智能分类与定时提醒系统。
  自动从聊天消息中捕获待办（文字/图片/附件），解析时间与优先级，每日晚上9点推送未完成提醒。
  当用户消息包含以下触发词时激活：
  【录入】"TODO:"、"帮我记录一下"、"记录："、"待办："、"加个待办"、"记一下"、"别忘了"、"记得提醒我"、"回头要做"、"备忘"、"提醒我"、"add todo"、"remind me to"、"don't forget"、"note this"
  【查询】"TODOLIST"、"待办列表"、"查看待办"、"看看待办"、"我有哪些待办"、"今天还有哪些未完成"、"还有什么没做"、"今天还要干嘛"、"今天的事做完了没"、"我的清单"、"my todos"、"todo list"、"what's pending"、"show todos"
  NOT for: 项目管理、日历集成、多人协作、自动执行任务。
---

# todo-list — 个人待办事项系统

## 语言规则

**检测用户使用的语言，全程使用同一语言输出。** 中文用户 → 读下方中文部分，全中文输出；English users → read the English section below, output in English only. 技术术语（JSON、ID 等）保留原文即可。

---

# 中文版

## 目标

为用户提供一个永久不丢失的待办事项管理系统。自动从聊天消息中捕获待办，智能解析时间和优先级，每日主动提醒未完成任务。

## 核心原则

1. **零摩擦录入** — 用户随意发一句话或一张图，系统自动识别并存储
2. **永久不丢** — 完成 = 标记 done，不等于删除。已删除 = 真正移除
3. **智能解析** — 从自然语言自动提取时间、优先级、任务内容
4. **主动提醒** — 有截止时间的未完成任务，每天 21:00 主动推送
5. **按需响应** — 用户不问不回复，避免打扰

## 主要职责

### 1. 待办录入

**触发词：** `TODO:`、`帮我记录一下`、`记录：`、`待办：`、`加个待办`、`记一下`、`别忘了`、`记得提醒我`、`回头要做`、`备忘`、`提醒我`、`add todo`、`remind me to`、`don't forget`、`note this`

**模糊输入判定规则：** 消息必须包含**动宾结构**或**明确动作词**才能触发录入。判断标准：

- ✅ 触发：含动词+宾语（"完成课程作业"、"买充电线"、"看完论文"）
- ✅ 触发：含明确动作+目标（"TODO: 复习期末考试"）
- ❌ 不触发：纯状态/意向陈述（"我打算吃饭"、"最近好累"、"想学 Rust"）
- ❓ 模糊时：**追问而非静默录入**。如"TODO: 搞一下那个东西" → 回复"你想记录什么待办？请具体说明一下任务内容"

**操作优先级**：如果同一条消息同时匹配录入和操作指令（如"删除这个 TODO: xxx"），优先执行操作指令（完成 > 删除 > 修改 > 录入），不创建重复待办。

**矛盾请求处理**：当用户消息包含矛盾指令时（如"完成了 #1 删除 #1"或"TODO: 删除所有待办"）：

- 操作间矛盾：按优先级执行第一个操作，忽略矛盾的第二个，并告知用户
- 批量操作（"删除所有"/"完成全部"）：列出受影响的项目，逐条确认，不可批量静默执行
- 越界请求（"帮我把待办同步到飞书项目"）：拒绝并提示"todo-list 仅管理本地待办，不支持外部同步"

**流程：**

1. 从用户消息中提取任务内容
2. 如果消息包含图片/附件，下载并保存到 `${workspace}/todo-list/attachments/`
3. 解析时间要求（如有）
4. 解析优先级（如有）
5. **提取对接人（contact）**（见下方对接人提取规则）
6. **提取备注（notes）**（见下方备注提取规则）
7. **提取标签（tags）**（见下方标签提取规则）
8. 生成唯一 ID，写入 `${workspace}/todo-list/todos.json`
9. 回复用户确认（完整一行：ID + 摘要 + 优先级 + 截止时间 + 对接人 + 标签 + 备注摘要）

**时间解析：**

- 相对时间：今天、明天、后天、下周一、本周五、今晚、月底 等
- 绝对时间：5月20日、5-20、2026/5/20 等
- 模糊时间：尽快、ASAP、有空时 → 不设截止时间
- 精确到"天"，不支持具体小时
- 无法解析时 → 不设截止时间，不追问

**优先级解析：**

| 级别 | 标记方式      | 自然语言线索                         |
| ---- | ------------- | ------------------------------------ |
| P0   | `[P0]`、`⚠️`  | "很紧急"、"立刻"、"马上"、"必须今天" |
| P1   | `[P1]` 或不标 | "重要"、"要做"（默认）               |
| P2   | `[P2]`、`⚡`  | "急但不重要"、"顺手做"               |
| P3   | `[P3]`、`📌`  | "有空再说"、"随手记一下"、"不急"     |

无法判断时默认 P1。

**对接人（contact）提取规则：**

从用户消息中识别对接人/负责人信息，提取到 `contact` 字段：

| 模式                | 示例                         | 提取结果        |
| ------------------- | ---------------------------- | --------------- |
| "XX：" 前缀         | "小李：输入框跟后台配置联动" | contact: "小李" |
| "@XXX"              | "@小王 翻译完了发过来"       | contact: "小王" |
| "对接人：XX"        | "适配 autoclaw，对接人小陈"  | contact: "小陈" |
| "找XX" / "跟XX对接" | "找小陈对接多语言"           | contact: "小陈" |
| "XX给XX后"          | "小王给翻译文本后加到项目"   | contact: "小王" |

提取原则：

- 如果消息中提及多处人名，提取最直接负责该任务的人
- 无法确定时 `contact` 为空，不追问
- **查询输出时**：有 contact → 显示 `👤 对接:XXX`；无 contact → 不显示

**备注（notes）提取规则：**

- **仅当用户明确提供备注信息时才记录**，如"备注：XX"、"注意：XX"
- **禁止自动脑补备注**：不要从 content 中推断、不要自行总结、不要把原文复述一遍
- 飞书文档链接等用户主动发送的参考资料可归入 notes
- `notes` 为空时不显示

**标签（tags）提取规则：**

默认标签集：`工作`、`学习`、`购物`、`生活`、`健康`、`其他`

提取方式：

1. **手动指定**：用户使用 `#标签名` 语法，如 `TODO: 完成报告 #工作` → tags: ["工作"]
2. **关键词映射**：从消息内容中识别名词类别关键词，自动映射到默认标签：

| 关键词示例                                     | 映射标签 |
| ---------------------------------------------- | -------- |
| 作业、报告、会议、邮件、项目、汇报、答辩、上线 | 工作     |
| 论文、看书、课程、考试、练习、学习、培训、作业 | 学习     |
| 买、购物、下单、充值、充电线、耳机             | 购物     |
| 打扫、做饭、取快递、缴费、搬家、洗衣服         | 生活     |
| 体检、运动、吃药、跑步、挂号、看医生           | 健康     |

3. **无匹配**：当消息中没有可识别的类别关键词且用户未手动指定标签时，tags 为空数组 `[]`
4. **多标签**：一条待办可以有多个标签，如 `TODO: 买体检套餐 #健康 #购物` → tags: ["健康", "购物"]
5. **自定义标签**：用户可以使用 `#标签名` 指定不在默认集中的标签，如 `TODO: 修复 bug #前端` → tags: ["前端"]

**附件处理：**

- 图片/文件：下载到 `${workspace}/todo-list/attachments/{todoId}_{原文件名}`
- json 中记录 `attachments: [{path, type}]`，type 枚举：`image`（图片）、`file`（其他文件）
- 同时有文字和图片时，两者都存储

**附件清理机制：**

- 每次操作 `todos.json` 时（录入、完成、删除、修改等），检查 `attachments/` 目录中是否存在已删除 todo 的附件
- 如果该附件关联的 todo 已被删除**超过 7 天**（根据 todo 的删除时间戳判断），则自动清理该附件文件
- 清理日志追加到 `${workspace}/todo-list/cleanup.log`

### 2. 待办查询

**触发词：** `TODOLIST`、`待办列表`、`查看待办`、`看看待办`、`我有哪些待办`、`今天还有哪些未完成`、`还有什么没做`、`今天还要干嘛`、`今天的事做完了没`、`我的清单`、`my todos`、`todo list`、`what's pending`、`show todos`

**查询模式：**

- 无条件 → 所有未完成待办，按截止时间升序（无截止排最后），同截止时间再按优先级排序（P0 > P1 > P2 > P3）
- 按日期 → "周一的 todo"、"5月18日的待办"、"今天的" → 筛选 `due_time` 匹配该日期的未完成项
- 按时间范围 → "本周"、"本月" → 筛选 `due_time` 在范围内
- 按优先级 → "有哪些紧急的" → 筛选特定级别
- 按标签 → "工作相关的待办" → 筛选 `tags` 包含对应标签

**输出格式：** 表格，内容列在最前，无 emoji，备注仅用户明确提供时显示。

```
| 内容 | # | P | 截止 | 对接人 | 备注 |
|---|:---:|:---:|:---:|---|---|
| 完成课程作业（附实验报告） | 1 | P0 | 今天 | 小李 | |
| 看完那篇论文 | 3 | P1 | 下周一 | | |
| 取快递 | 5 | P1 | | | |
```

**格式说明：**

- **内容列置首**，最重要信息优先
- 不使用 emoji（不要 🔴🟡🟠🟢），用 P 列直显优先级
- 备注/对接人为空时不显示（留空即可）
- 截止时间简洁显示：今天/明天/5/25，已过期标红
- 不显示 source_message（内容列已涵盖）

### 3. 待办操作

**完成：** "完成了 #1" 或 "TODO 完成 1" 或 "done #1" → 标记 `status: done`，记录 `completed_at`
**删除：** "删除 #1" 或 "TODO 删除 1" 或 "delete #1" → 回复待删除的 todo 内容摘要（ID + 内容 + 优先级），等用户确认后再移除。用户说"确认"或"删"时才执行
**修改：** "#1 改成明天" 或 "#1 change to tomorrow" → 更新对应字段，回复确认

**可修改字段：** `content`（内容）、`due_time`（截止时间）、`priority`（优先级）、`contact`（对接人）、`notes`（备注）、`tags`（标签）

**修改语法：**

- 字段名语法：`#N due_time:明天`、`#N priority:P0`、`#N content:新的任务描述`、`#N contact:小李`、`#N notes:补充信息`、`#N tags:学习,生活`
- 自然语言语法（同样支持）：`#1 截止:明天`、`#1 优先级:P0`、`#1 内容:新的任务描述`、`#1 对接人:小李`、`#1 备注:补充信息`
- 两种写法等价，系统都能识别

**撤销机制：**

- 用户说"撤销"或"undo"时，恢复到 `todos.json.bak` 中的上一版本
- **仅支持单步 undo**：连续两次 undo 时，第二次 undo 恢复到 bak 之前的版本（即 bak 文件中存储的状态，不会继续回退到更早版本）
- **undo 后的新操作**：undo 之后再执行任何新操作（录入/完成/删除/修改），新操作会覆盖 `todos.json.bak`，之前的 undo 状态不可再恢复
- 简言之：永远只能撤销最近一次操作，undo 不是无限回退栈

### 4. 每日提醒

- **时间：** 每天 21:00
- **配置方式（具体步骤）：**

  使用 OpenClaw cron 创建每日提醒任务，最小步骤如下：

  1. 创建 cron 任务，调度规则为 `0 21 * * *`（每天 21:00）
  2. cron 任务触发时执行以下流程：
     a. 读取 `${workspace}/todo-list/todos.json`
     b. 筛选条件：`status != "done"` 且 `due_time != null`
     c. 按截止时间升序排序（无截止排最后），同截止时间再按优先级排序（P0 > P1 > P2 > P3）
     d. 如有匹配项，生成紧凑列表消息并推送到用户聊天
     e. 如无匹配项，不推送
     f. 更新 `last_reminder_at` 为当前时间
  3. 推送消息末尾附操作指引：`回复"完成 #N"标记完成 · 回复"TODOLIST"查看全部 · 回复"#N due_time:X"修改 · 回复"撤销"恢复最近操作`
  4. cron 命令示例：`openclaw cron add --schedule "0 21 * * *" --task "Read todos.json, filter pending items with due_time, push reminder if any"`

- **降级策略：** cron 不可用或执行失败时，在下次用户交互时补充推送未提醒项（检查 `last_reminder_at`，若超过 24 小时则补推）

## 数据结构

存储文件：`${workspace}/todo-list/todos.json`（`workspace` 为当前 OpenClaw 工作目录）

```json
{
  "version": 2,
  "todos": [
    {
      "id": 1,
      "content": "完成课程作业",
      "status": "pending",
      "priority": "P0",
      "due_time": "2026-05-16",
      "contact": "小李",
      "notes": "需要附上实验报告",
      "tags": ["学习"],
      "created_at": "2026-05-16T09:30:00+08:00",
      "completed_at": null,
      "deleted_at": null,
      "attachments": [],
      "source_message": "TODO:今天下班前完成课程作业，对接人小李，需要附上实验报告"
    }
  ],
  "last_reminder_at": "2026-05-16T21:00:00+08:00"
}
```

字段说明：

- `id`: 自增整数，不重复使用
- `content`: 任务内容（纯文本摘要）
- `status`: `pending` | `done`
- `priority`: `P0` | `P1` | `P2` | `P3`
- `due_time`: 截止日期 YYYY-MM-DD，可为 null
- `contact`: 对接人/负责人姓名（可选，无则为空字符串 `""`）
- `notes`: 备注信息，含补充说明、参考链接等（可选，无则为空字符串 `""`）
- `tags`: 标签数组，用于分类和筛选（如 `["工作", "bug"]`），可为空数组
- `created_at`: 创建时间 ISO 8601
- `completed_at`: 完成时间 ISO 8601，完成时填入
- `deleted_at`: 删除时间 ISO 8601，删除时填入（用于附件 7 天清理判断）
- `attachments`: `[{path, type}]` 附件列表
- `source_message`: 原始消息内容（完整保留，永不修改）
- `last_reminder_at`: 上次提醒时间 ISO 8601（用于降级补推）

## 并发安全

写入 todos.json 时采用原子写模式：先写入临时文件 `todos.json.tmp`，写入成功后 `mv`（rename）替换原文件。避免两个 session 同时写导致数据丢失。

## 约束

- 存储路径：`${workspace}/todo-list/`（相对于当前工作目录）
- 附件路径：`${workspace}/todo-list/attachments/`
- ID 自增，已删除的 ID 不重复使用
- 不修改用户消息原文
- 删除操作必须二次确认
- 时间解析精确到天
- `todos.json` 或目录不存在时自动创建
- 写入 json 前自动备份上一版本到 `todos.json.bak`
- 读取 json 解析失败时，尝试使用 `todos.json.bak` 恢复
- 删除 todo 后，记录 `deleted_at` 时间戳，attachments 目录中的文件**保留 7 天**后自动清理（避免误删后无法恢复）
- 每次操作 todos.json 时检查是否有超过 7 天的已删除 todo 附件，有则清理
- Schema 升级：读取时检查 `version` 字段，若不匹配当前版本，执行迁移（如新增字段填默认值）并写回

---

---

# English Version

> **This skill is written in Chinese.** For full details, please read the Chinese section above.
> You can ask AI to translate the Chinese section if needed.

## Summary

**todo-list-promax** — Personal todo management system with permanent storage, smart categorization, and daily reminders.

### Core Principles

1. **Zero-friction input** — Auto-capture from casual messages or images
2. **Permanent storage** — Done ≠ delete; deleted = actually removed
3. **Smart parsing** — Auto-extract time, priority, tags from natural language
4. **Daily reminders** — Push unfinished tasks at 21:00 via cron
5. **On-demand** — Don't disturb unless asked

### Key Features

| Feature        | Details                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture        | Triggers: `TODO:`, `add todo`, `remind me to`, etc. Fuzzy input → ask, don't silently capture                                               |
| Query          | Triggers: `TODOLIST`, `my todos`, etc. Filter by date/range/priority/tags. Shows 👤contact, 📝notes, 💬source_message for every item        |
| Operations     | Complete, delete (with confirmation), modify, undo (single-step only)                                                                       |
| Tags           | Auto-extract via keyword mapping (工作/学习/购物/生活/健康/其他) or manual `#tag` syntax. Default: empty array                              |
| Daily reminder | Cron at 21:00: read todos.json → filter pending with due_time → push if any. Fallback: push on next interaction if >24h since last reminder |
| Attachments    | Saved to `attachments/`, auto-cleaned 7 days after todo deletion                                                                            |

### Modify Syntax

- Field name syntax: `#1 due_time:明天`, `#1 priority:P0`, `#1 content:新内容`, `#1 contact:小李`, `#1 notes:补充说明`, `#1 tags:学习,生活`
- Natural language also supported: `#1 截止:明天`, `#1 优先级:P0`, `#1 内容:新内容`, `#1 对接人:小李`
- Both are equivalent

### Undo Specification

- Single-step only: second consecutive undo restores to the bak version (no further rollback)
- After undo, any new operation overwrites bak — previous undo state is lost
- In short: always only the most recent operation can be undone

### Data Schema

```json
{
  "id": 1,
  "content": "...",
  "status": "pending|done",
  "priority": "P0|P1|P2|P3",
  "due_time": "YYYY-MM-DD|null",
  "contact": "string (optional)",
  "notes": "string (optional)",
  "tags": [],
  "created_at": "ISO8601",
  "completed_at": null,
  "deleted_at": null,
  "attachments": [{ "path": "", "type": "image|file" }],
  "source_message": "..."
}
```

### Cron Setup (Minimal Steps)

1. Create cron: `0 21 * * *`
2. On trigger: read `todos.json` → filter `status != "done"` AND `due_time != null` → sort by due_time ascending, then by priority → push if any → update `last_reminder_at`
3. Append action guide to push message

### Constraints

- Atomic writes (write to `.tmp` then `mv`)
- Auto-backup to `todos.json.bak` before writes
- Auto-recover from `.bak` on parse failure
- Deleted todo attachments retained 7 days then auto-cleaned
- Schema migration on version mismatch
