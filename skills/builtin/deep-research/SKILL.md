---
name: deep-research
description: >
  多 agent 深度调研,4 路由(看是否提供文件 + 集合是否已知):
  ① 无文件 + 集合未定 → 撒网模式(找 sibling + 多 worker 探广)
  ② 无文件 + 集合已知 → 锁定模式(实体已知,直接 ≥6 维度切分)
  ③ 有文件 + 用户明示"只看文件 / 基于这些 / 不要外搜" → 纯文件深析(不外搜)
  ④ 有文件 + 无限制(参考 / 结合 / 帮我完成) → 文件做主源 + 外搜补 gap

  与轻量搜索的本质区别:≥6 维度 × ≥10 search × 4 档信度 = ≥110 searches/run
  (③ 例外:不外搜)。
---

# Deep Research

主流程 skill,接管 Agent 集群研究段——`<plan>` 和执行按下面工序走。
本 skill 产 `{run_dir}/` 研究素材集,**不自产最终成品**(主 agent 不自己手写报告);素材产完不是本轮结束——按工序 7 交回 Agent 集群 S5,由 SOP 统一判定最终载体、交付与 reviewer。
工序之间**自动推进**:撒网 / 深挖 / 互证做完直接进下一工序,**绝不停下问用户"要不要汇总 / 要不要继续 / 要不要整合成总览"**——一路跑到工序 7 交棒下游(长文需要时 `write-skill` → GLM-Office / 指定载体)。中途停手等确认 = 研究白做、零交付(干多写少的头号死法)。
进度协议、[来源] 标注、通用约束仍生效。

## 对外措辞

工序号、模式名、契约名、中间文件路径、信度档、引用 id 都是**内部标签**,不在**用户可见处**
出现——包括 chat 消息**和最终交付物**(报告/HTML/deck/PPT)。最终成品路径只在 S5 交付物清单里作为可点击链接目标出现。对外**只汇报实质动作与产出**,
用自然白话——内部仍按工序记录(`<plan>` step id、文件名等)。

- 别说:"这是典型的撒网模式——按工序来"
- 改说:"先把全景摸广,再分维度深挖"

## 开工纪律

任何工序开始前先校准:

- **取当前时间**:`bash date` 拿系统时间,别假设(预训练知识可能过期)
- **时间窗硬约束**:query 含"2026 Q1 / 近半年 / 最新 / 当前"等时间指向时,把窗口当死线——搜索 query
  必须打到该窗内;窗外发现要明示"[超窗]"并说明时段
- **搜索前不编断言**:任何事实声明都要等 search / 工序 1 结果落地;搜索前的脑补不算
- **搜索语言匹配用户语言**:用户中文 → 中文源;用户英文 → 英文源。语言不匹配会丢半边证据
- **全程 `[^id]`**:任何外部事实必带 inline 语义引用句柄(id = 域名/机构+主题),工序 1 起就用

## 工序 0 — 模式判定

判据顺序(先看文件,再看集合):

**1. 用户是否提供文件?**

- 有文件 + 明示"只看文件 / 基于这些 / 不要外搜" → **文件 only 模式**
- 有文件 + 无限制 / "参考 / 结合 / 帮我完成 / 在这基础上" → **文件增强模式**
- 无文件 → 走判据 2

**2. 集合 / 边界判断**(查 query 的结构属性,不看关键词):

- 未先验确定(开放性 quantifier "所有 / 类似 / 之类";主体 niche;sibling 集合未知) → **撒网模式**
- 已知边界实体的已知属性问询 → **锁定模式**
- 拿不准 → 默认撒网(framing 错的代价 > 多跑撒网铺面)

| 模式               | 工序 1 走法                                 | 后续差异                  |
| ------------------ | ------------------------------------------- | ------------------------- |
| **撒网模式**       | 工序 1 撒网铺面(5 facet + 反框架 worker)    | 标准链路                  |
| **锁定模式**       | 工序 1 起手勘察(skip 撒网铺面)              | 标准链路                  |
| **文件 only 模式** | 跳过工序 1,工序 F 主题清单直接进工序 2      | 工序 3 不外搜;工序 5 跳过 |
| **文件增强模式**   | 工序 F + 工序 1 targeted scan(只搜文件 gap) | 工序 3 文件 + 外搜结合    |

文件场景拿不准走哪种 → 默认**文件增强**。

## 文件命名与通信约定

**每次 session 独立目录**——主 agent 选定 topic 后(工序 0 末),**立即** bash 建本次 run 的隔离目录:

```bash
mkdir -p ~/.openclaw-autoclaw/workspace/research/{topic}-$(date '+%Y%m%d-%H%M')
```

这个完整路径记作 `{run_dir}`(主 agent 自己记住,后续所有 read/write 和 spawn prompt 都用它)。
`topic` 短、英文小写 + 连字符:`lobehub`、`smic-fa`、`zhipu-valuation`。
`-p` 让 mkdir 幂等,同分钟内重跑不挂。

所有产出落在 `{run_dir}/` 下,文件名不再带 topic 前缀:

| 文件                         | 工序    | 模式                   | 内容                                                            |
| ---------------------------- | ------- | ---------------------- | --------------------------------------------------------------- |
| `{run_dir}/file_analysis.md` | F       | 文件 only / 文件增强   | 文件清单 + per-file 抽取 + 跨文件 mapping + gap 分析 + 主题清单 |
| `{run_dir}/map.md`           | 1       | 撒网 / 锁定 / 文件增强 | landscape 地图(关键玩家、来源、信号入口)                        |
| `{run_dir}/scan_NN.md`       | 1(撒网) | 撒网                   | 每 facet worker 的撒网产出                                      |
| `{run_dir}/dive_NN.md`       | 3       | 全模式                 | 每维度 worker 的深挖产出                                        |
| `{run_dir}/verify.md`        | 4       | 全模式                 | 4 档信度分类 + 矛盾点 + 引用 id 汇总                            |
| `{run_dir}/resolve_NN.md`    | 5       | 撒网 / 锁定 / 文件增强 | 每条矛盾的定点消解产出(文件 only 跳过)                          |
| `{run_dir}/insight.md`       | 6       | 全模式                 | 跨维度综合洞察                                                  |

**通信协议(主 agent 与 worker 共享 host 文件系统)**:

- worker 用 write/bash 工具**直接写到上述路径**;路径在 spawn prompt 里给死,worker 不自取名
- worker 的 push 通道(auto-announce)**只承载"完成 + 路径 + 一句话进度"信号,不承载产出内容**
- 主 agent 任何阶段要数据都 `read` 文件,**不从 push 消息内容里抠数据**——push 只是"worker 干完了"的通知,不是数据来源

## 工序 F — 文件 Intake & 深析(仅文件 only / 文件增强模式)

**触发**:工序 0 判定为文件 only 或文件增强。**先于工序 1 执行**。

**过程**:

1. **文件清单**:列所有用户提供文件(路径 / 类型 / 大小 / 一句话内容摘要)
2. **per-file 抽取** —— 逐文件抽:
   - 核心主题 / 议题
   - 关键断言 / 论点 / 结论
   - 数据点 / 数字 / 图表(带页码或段落定位)
   - 发表 / 数据时间窗(用于工序 4 互证撞时间口径冲突)
   - 方法论(如适用)
   - 文件作者明示的局限 / 注意 / 偏见
3. **跨文件 mapping**:
   - 重叠主题
   - 文件间矛盾 / 数据冲突
   - 互补信息(文件 A 提供文件 B 缺的上下文)
   - **gap** —— 该话题的重要面相,所有文件都没覆盖
4. **主题清单**:合并出统一主题清单,工序 2 维度切分基于它

**模式差异**:

- **文件 only**:gap 仅作记录,不外搜;主题清单是工序 2 的唯一输入
- **文件增强**:gap 清单驱动工序 1 targeted scan(外搜只为补 gap)

**输出**:`{run_dir}/file_analysis.md`(按上述 1-4 步对应落盘)。

## 工序 1 — 起步勘察(按模式分走法)

### 前置(撒网 / 锁定 / 文件增强 共用,文件 only 跳过)

文件 only 模式 → **跳过本工序**,工序 F 主题清单直接进工序 2。
其他三模式 → 走通用 SOP「上下文收集」:`autoglm-websearch` 3–5 次搜索 → 核准主体 + 关键事实 → `{run_dir}/map.md`。
完成后再分支。

### 撒网模式 · 撒网铺面

在 map.md 基础上扩展广度——并行 worker 从不同角度看 topic。

1. 拆 **≥5 个 facet**,**facet 之间必须跨不同 dimension**(不要都从同一角度切)
2. 同一波 spawn 一 facet 一 worker。spawn prompt **必须 inline `{run_dir}/map.md`
   关键摘要**作 context;按「撒网产出契约」写 `{run_dir}/scan_NN.md`
3. **加 1 个反框架 worker**:同一波 spawn,**不给 map.md context**,任务是
   "挑战主流 framing,从不同视角找漏掉的 sibling / 信号 / 争议"。写
   `{run_dir}/scan_anti.md`
4. 每个 worker:**≥10 次独立搜索**(不同关键词、不同源,避开 landscape 已有词汇)
5. 主 agent 收齐"完成 + 路径"信号后,`read` 各 scan + scan_anti → **扩展**
   `{run_dir}/map.md`(scan_anti 报出的 alternative framing 纳入工序 2 维度)

### 锁定模式 · 起手勘察

前置已完成,直接进工序 2。

### 文件增强模式 · targeted scan

工序 F 的 gap 清单驱动搜索 query —— 只搜文件没覆盖的面相,3-5 次。外搜 finding 追加进 `{run_dir}/map.md`,显式标"来源:外搜补 gap"。

### 出口条件(两种走法共用)

① 一句话写明"我有[资源]、用户在问[意图]、我要交付[成品/结论]";
② 关键事实清单,每条 `[^id]`,落到 `{run_dir}/map.md`;
③ **subject identity 由一手来源(官网 / 官方仓库 / 官方公告)支撑** —— 搜索结果同源 / 低质 /
互相矛盾,标 "subject under-attested",停工序 1 补搜或回退。

## 工序 2 — 课题切分

把 topic 拆成 **≥6 个编号维度**——这份清单 = 工序 3 的派单清单(每维默认一个 worker)。

维度可以从下列角度切(可组合):

- **时间**:历史起源 / 当前状态 / 1 年展望 / 5 年展望
- **角色视角**:用户 / 企业 / 监管 / 投资人 / 竞争者 / 从业者
- **场景**:乐观 / 悲观 / 现状延续 / 破坏式 / 黑天鹅
- **地域**:中国 / 美国 / 欧盟 / 新兴市场
- **领域切面**:技术 / 商业 / 财务 / 法规 / 生态
- **文件主题**(文件 only / 文件增强 专属):工序 F 主题清单直接作维度,每维 map 到一个或多个文件主题

**维度间保留 ≥30% 概念重叠**。重叠不是浪费——它制造交叉验证压力,工序 4 靠"≥2 个独立 worker
撞到同一事实"才给高信度。零重叠 = 工序 4 废。

撒网模式下,每个 scan_NN 在 dive 阶段都要有归宿——开独立维度、合并进其他维度、
或在 map.md 显式标记"不进 dive 仅作背景"。

每个维度 scope 必须含三段:

1. **Current state** —— 此角度下当前发生什么
2. **Key evidence** —— 该角度的数据 / 来源 / 案例
3. **Tensions** —— 此角度的反向观点 / 争议

发 `<plan>`:每维一个 step,「互证分级」「跨维洞察」各列一个,末尾再列一个「交付」step 留 pending——研究 step 全 done 不代表本轮结束,交付 step 由工序 7 交棒后的 write-skill / SOP Phase 5 推进到 done。

出口条件:编号维度清单(≥6),每项有 scope 三段描述。

## 工序 3 — 并行深挖

每维一个 worker,**同一波 spawn,并行,不串行**。

### Worker prompt 契约(5 段必含,标准模式)

1. **Mission**:维度名 + scope 三段 + "**≥10 次独立搜索**,**主用 `autoglm-websearch` 搜、`autoglm-open-link` 取正文**(见 Core Principle 11,`web_fetch` 仅兜底),不同关键词、不同源、覆盖一手来源(政府 /
   学术 / 官方 / 主流媒体),避开内容农场 / SEO 聚合 / 匿名博客"
2. **Context**:主线已有事实(工序 1 关键发现,inline 摘要)
3. **产出契约**:严格按「深挖产出契约」(见末尾)结构填——含 Key Evidence 表的「原文摘录」「自评信度」两列。不要整页 dump / 搜索过程日志 / 重复结果。
4. **输出路径(强制)**:用 write 工具写到 `{run_dir}/dive_NN.md`
   (NN = 该 worker 对应的维度编号,主 agent 在 spawn prompt 里把 `{run_dir}` 替换成绝对路径)
5. **Push 行为**:任务完成后,push 通道只回"完成,文件:`{run_dir}/dive_NN.md`,一句话摘要 X"(具体约束见上方「通信协议」)

### 文件增强模式 · 额外要求

spawn prompt 在 Context 段额外 inline **本维度相关的文件 excerpt**(从工序 F 抽取,不让 worker 自己读文件)。worker 把文件作为主源,外搜作补/验证;**inline 源句柄区分来源**——文件来源 id 用 `file-` 前缀(定义写 `[^file-xxx]: <文件名>, <章节/页>`),外搜来源照常 `[^域名-主题]: 标题. 日期. URL`。

### 文件 only 子分支

worker prompt 同标准模式 5 段,但 Mission 改为"**不外搜**,只用 spawn prompt 里 inline 的文件 excerpt"。worker 任务:

- 跨文件交叉引用,识别 pattern,评估证据强弱
- 标记 implicit assumptions / 文件作者偏见
- 源句柄用 `file-` 前缀,定义格式 `[^file-xxx]: <文件名>, Section <X>`,无 URL

### 主 agent 行为

- 全部 worker spawn 完,主 agent **结束本回合**——等 auto-announce 推回"完成 + 路径"信号
- 收到完成信号后,**不需要解析 push 内容**——文件在指定路径活着,工序 4 再 read
- 失败 worker 显式标记、工序 6 `insight.md` 里说明缺口

出口条件:每个 worker 都已写出 `{run_dir}/dive_NN.md`(或显式失败);worker 未回齐不进工序 4。

## 工序 4 — 互证分级

`read` 所有 `{run_dir}/dive_NN.md`(撒网模式还要 read `{run_dir}/scan_NN.md`)取正文与论证。源定义已 inline 在各小节末尾,随正文一起读到,无需单独抓取。

跨维度比对、分信度、列矛盾。读 worker 的「自评信度」作输入参考,但**最终 4 档以 orchestrator 交叉验证为准**(worker 自评高、却只有它一家说 → 仍判中/低)。按四档分类每条 finding:

| 档         | 标准                                                                 |
| ---------- | -------------------------------------------------------------------- |
| **高信度** | ≥2 worker 从独立源撞到、证据一致                                     |
| **中信度** | 1 worker 但权威源(政府 / 学术 / 官方公告 / 主流媒体头条)             |
| **低信度** | 弱源(博客 / 二手汇编)或单一未核实断言                                |
| **矛盾点** | 不同 worker 在同一指标 / 同一时间 / 同一定义上分歧;数字矛盾;解读冲突 |

要求:

- 矛盾点全部明示,**不允许压平**——温度高的发现最值钱
- 时间口径冲突算矛盾(口径不同就标"worker A 取 2024Q3,worker B 取 2024 全年")
- **引用沿用 worker 的 `[^id]` 句柄**:id 是语义句柄(域名/机构+主题),worker 之间天然唯一、不会撞,**不需要重编号、不需要映射表**。verify.md 里每条 finding 直接带原 `[^id]`;同一来源被多 worker 引到就是同一个 id,天然归并。
- 后续工序 5/6 一律沿用这些 `[^id]`。**id 即终号**:下游 write-skill 沿用、不二次编号(citation_manager 按 id/URL dedup 建 _ref + url 校验)。

判断工序 5 是否触发:有矛盾点或有 critical 低信度 → 跑;否则跳到工序 6。
**critical** 指"报告主论点的核心支撑"(非边角细节):它弱 = 整份报告的结论站不住。

**文件 only 模式例外**:不允许外搜,工序 5 直接跳过。矛盾点照样记录,但不消解——保留作"文件内真分歧"标记,工序 6 insight 里说明。

输出:`{run_dir}/verify.md`,含四档完整分类 + 矛盾点详析 + 引用 id 汇总。

## 工序 5 — 定点消解(条件触发)

**触发**:工序 4 标了矛盾点或 critical 低信度才跑;否则跳过。

对每个未解决项 spawn 一个聚焦 worker,prompt 给两端断言 + 来源,要求"找独立证据消化分歧"。
每冲突 **≥3 次额外搜索**。worker **写到 `{run_dir}/resolve_NN.md`**(NN = 矛盾编号),
push 只回"完成 + 路径"。

每项二选一:

- **Resolved** —— 找到新证据,重分到高 / 中信度
- **Unresolved (genuine disagreement)** —— 注明这是领域真实分歧,保留在档

主 agent `read` 各 `resolve_NN.md`,更新 `{run_dir}/verify.md`,保持引用 id 一致。

## 工序 6 — 跨维洞察

`read` `{run_dir}/verify.md` 取互证后的事实,抽**跨维度才看得到**的洞察——单 worker 视角看不到的 pattern。

每条洞察必含 6 字段:

- **主张**(一句话)
- **跨维度**(列维度编号 — 文件 only / 文件增强 还可列文件编号)
- **支撑证据**(`[^id]`)
- **反例 / 边界条件**
- **Confidence**:高 / 中 / 探索性 —— 给下游写作判断洞察可信度,写作里 confidence 越高的越前
- **Implications**:对下游决策 / 行动的意义(一句话) —— 给写作输出 "so-what"

**Genre-aware 调整**(看下游写作用途):

- 偏研究报告 / 行业分析 / 咨询 deliverable → insight 偏战略可执行、市场机会、竞争动态、前瞻 implications
- 偏学术论文 / 综述 / 文献回顾 → insight 偏研究 gap、方法论矛盾、理论张力、相对前作的新贡献
- 不明确 → 中性,两类都覆盖,让下游 writing skill 自取

**文件模式强调**:文件 only / 文件增强 优先抽"跨文件 synthesis"型 insight —— 单文件看不到的 pattern;文件增强 额外标"外搜证据如何强化 / 反驳 / 扩展文件结论"。

写 `{run_dir}/insight.md`,作为研究素材集的最后一块——随即进工序 7 交棒,不在此停。

**insights 不可省**:最少 5 条。即便用户要求"简短"、"压缩",也保留(可缩篇幅,不可整段砍)——这是整轮 deep research 最值钱的产出。

## 工序 7 — 交棒(不可省)

研究素材集齐:`map.md` + `scan_NN.md`(撒网模式) + `dive_NN.md` + `verify.md` + `resolve_NN.md`(若有矛盾消解) + `insight.md` 全部就位。

主 agent 必须按下面这套**硬协议**一气走完交棒(第 1-5 步不可断,中途不交回用户):

1. `ls {run_dir}/` 拿到完整文件清单
2. 回 chat 一段白话:研究完成、关键发现摘要(高信度发现数 / 矛盾点数 / 已消解数)。`{run_dir}` 是内部素材目录,除非用户明确要素材路径,不要把中间路径当最终交付展示
3. 重发 `<plan>`:研究段 step 标 done,**交付 step 留 pending**(交付未完成,本轮不算结束)
4. **加载下游 skill 并按它自己的工序跑**(按用户交付意图 + SOP S5)——关键:是**加载该 skill、走它内部的多 worker 工序**,**不是 spawn 一个 worker 替它把全文写完**:
   - 长 markdown 报告 / 论文 → 加载 `write-skill`,按它的工序 0-4 跑(它会自己派 3 个大纲 worker + 每章一个 writer + 审稿闸门)。传 `{run_dir}` + 文件清单。
   - 最终形态按 SOP S5 判:用户指定就照办;没指定且一两段讲得完 → 纯文本结论;否则默认 `docx`(报告 / 方案 / 白皮书 / 调研),演示 / PPT → `ppt`,表格 → `xlsx`,固定版式 → `pdf`。长文先 `write-skill` 出 markdown,再由对应 GLM-Office skill 生成最终文件;GLM-Office 不可用时回退交付 markdown 并说明降级。
   - 只有用户明确要 HTML / 网页 / 交互原型 / Stage / landing page,才 `write-skill` → `delivery-artifact` 渲染;不要因为是研究报告或内容很长就默认走 `delivery-artifact`。
5. invoke 下游 skill 时 prompt 必含:
   - `{run_dir}` 绝对路径
   - 文件清单(逐文件列):`dive_NN.md` 全部、`verify.md`、`insight.md`、`resolve_NN.md`(若有)、`scan_NN.md` / `map.md`(若有)
   - 一句明示:"研究已完成,**不需要再 spawn 调研 sub-agent**"

**禁止(头号反模式)**:自己 spawn **一个** worker 把全文写完 / 整合,绕开 write-skill 的多 worker 分章管线。调研派了十几个 worker、写作只派 1 个 = "干了一大堆、海量素材被一个 agent 压扁成一篇垃圾"。**写作 worker 数必须匹配章节数**(N 维深挖 → final.md 至少 N 章、每章一个独立 writer,由 write-skill 工序 2 派)。ad-hoc 单 writer 还丢了章节级隔离 + 截断恢复 + URL 核验三道护栏 → 引用幻觉。绕开 write-skill / GLM-Office / delivery-artifact 直接出报告 / HTML 一律禁止。

**本 skill 不自产报告 / HTML / docx / PDF,也不自行决定最终载体**——只产研究素材集,交付形态由 SOP S5 和下游 skill 接管。

(独立 reviewer 由 SOP 路由兜底自动触发,不在本 skill 范围内)

---

## Core Principles

适用全工序:

1. **深度优先**(锁定模式)/ **先广后深**(撒网模式)。浅聚合是 deep research 的反义词;
   每维度必须深挖完再走
2. **Raw evidence required**:支撑断言的关键 quote 必须 verbatim(数字、定义、争议措辞、政策原文)。
   只回 paraphrase 不行——互证比的就是口径精度
3. **矛盾即信号**:冲突高亮、分析、不要压平或取平均。温度高的发现最值钱
4. **长内容走文件,push 只发信号**:worker 产出写到 `{run_dir}/*.md`,push 只回
   "完成 + 路径"。下游 skill 消费素材时必须 read 文件,不读 push
5. **源质量分级**:优先一手来源(政府 / 学术 / 官方公告 / 主流媒体);避开内容农场 / SEO 聚合 /
   匿名博客 / AI 生成 listicle。**文件 only / 文件增强:用户提供文件视为一手权威源**
6. **搜索预算**(给用户预期):
   - 撒网模式:5 scan × ≥10 + 6 dive × ≥10 = **≥110 searches/run**
   - 锁定模式:6 dive × ≥10 = **≥60 searches/run**
   - 文件 only:**0 外搜**(违反 = 违反用户意图)
   - 文件增强:1-5 targeted scan + 6 dive × ≥10 = **≥65 searches/run**(减半,因文件已提供基础证据)
7. **文件 only 尊重用户意图**:用户明示"只看文件",绝不偷偷外搜
8. **文件增强平衡来源**:文件做主源,外搜只补 gap / 验证 / 加深。不让外搜淹没用户文件
9. **单 worker 工具调用上限**:每个 scan / dive worker **工具调用总数 ≤ 20 次**
   (含 search + fetch + exec 等所有工具)。达到上限立刻停止追加新查询、
   基于已有素材写产出并 announce 收尾——**宁可少 1-2 条边角证据,不要拉满**。
   `≥10` 是防偷懒下限,`≤20` 是防贪心上限;命中区间 (~12-18) 即合格。

10. **大文件 read 纪律**(普适):任何对 dive_NN.md / verify.md / insight.md 等素材的 read,**查末尾**是否有 `[... N more characters truncated]`,有就 `read(offset=N)` 续读;别一次并发 ≥10 个无 offset/limit 的 read 塞满上下文(单文件常 16K-30K chars,中文更易越窗)。源已 inline 分散在各小节,截断只影响尾节、不再全文丢源。

11. **搜素材工具栈**: 搜索用 `autoglm-websearch` (`python ~/.openclaw-autoclaw/skills/autoglm-websearch/websearch.py "<query>"`), 取页面正文用 `autoglm-open-link` (`python ~/.openclaw-autoclaw/skills/autoglm-open-link/open-link.py "<url>"`)——zhipuai 服务端爬虫栈, 抗反爬 + 返回抽取后正文, 比 OpenClaw 内置 `web_fetch` 拿 raw HTML 更适合 deep-research 引用。`web_fetch` 留作兜底: autoglm-open-link 抽出明显不是正文时再试。

---

## 撒网产出契约 (工序 1 撒网 worker 写入 `{run_dir}/scan_NN.md` 的格式)

引用规则同深挖契约:语义 `[^id]` 句柄,源定义紧跟每小节末尾,不集中文件尾。

```
## Facet: <facet 名>

### Key Findings
- <一句话 finding>[^id1]

[^id1]: <标题/机构>. <日期>. <URL>

### Major Players & Sources
- <实体>: <角色/相关度>

### Trends & Signals
- <趋势>: <信号>[^id2]

[^id2]: <标题/机构>. <日期>. <URL>

### Controversies & Conflicting Claims
- <冲突描述>: 两端各[^id3][^id4]

[^id3]: <标题/机构>. <日期>. <URL>
[^id4]: <标题/机构>. <日期>. <URL>

### Recommended Deep-Dive Areas
- <方向>: <为何值得深挖>
```

## 深挖产出契约 (工序 3 worker 写入 `{run_dir}/dive_NN.md` 的格式)

引用用语义 `[^id]` 句柄(id = 来源域名/机构 + 主题,如 `bnef-battery`、`mofcom-2024`;同一来源全程复用同一 id,worker 之间天然不撞)。**源定义紧跟在每个小节末尾**,不集中堆到文件尾——这样 read 截断只丢尾节、不会全文源全失。

```
## Dimension <NN>: <维度名>

### Current State
- <事实>[^id1]
- <事实>[^id2]

[^id1]: <标题/机构>. <日期>. <URL>
[^id2]: <标题/机构>. <日期>. <URL>

### Key Evidence
| 数据点 | 数值/描述 | 时间 | 原文摘录(verbatim) | 自评信度 | 来源 |
|---|---|---|---|---|---|
| ... | ... | ... | "关键数字/定义/争议措辞/政策原文" 原文不可改述 | 高/中/低 | [^id3] |

[^id3]: <标题/机构>. <日期>. <URL>

### Tensions & Counter-arguments
- <反向观点>: <论据>[^id4]

[^id4]: <标题/机构>. <日期>. <URL>
```

**字段说明**:

- **原文摘录**:支撑该数据点的关键短 quote(数字 / 定义 / 争议措辞 / 政策原文)逐字照搬,不改述——互证比口径靠的就是原文。只摘关键句,不整页 dump。无关键 quote 可省该格。
- **自评信度**:worker 对本条证据强度的初判(高=一手权威源/中=可靠二手/低=单一弱源)。这是**给工序 4 的输入信号,不是终判**——最终 4 档由 orchestrator 交叉验证后定。
