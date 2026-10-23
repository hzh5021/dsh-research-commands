# dsh-research-commands

把已装的 research skills 变成斜杠命令：敲一下，对应的 `SKILL.md` 就作为一条 user 消息进会话。

## 它做什么

DSH 的斜杠命令只能用代码注册（`ctx.commands.register()`），丢文件注册不出来；而不少技能生态文档里写的 `/xxx` 语法是别的客户端专用的——技能装好了，命令还是敲不出来。这个插件把这段桥补上：它维护一张「命令 → 技能目录」的表，敲命令时去用户技能根目录里读对应的 `SKILL.md`，剥掉 YAML frontmatter，把技能正文和你在命令后面补的那句话拼成一条 user 消息注入当前会话，模型照着跑那个技能。

一共十五条：

| 命令 | 技能 | 说明 |
|---|---|---|
| `/idea` | `idea-discovery` | 找idea全流程 |
| `/novelty` | `novelty-check` | 查新 |
| `/figure` | `nature-figure` | 论文配图 |
| `/polish` | `nature-polishing` | 论文润色 |
| `/review` | `nature-reviewer` | 模拟审稿 |
| `/cite` | `citation-audit` | 审查引用 |
| `/read` | `nature-paper-xray` | 精读论文 |
| `/poster` | `paper-poster-html` | 做海报 |
| `/slides` | `paper-slides` | 做PPT |
| `/paper` | `paper-writing` | 写论文全流程 |
| `/exp` | `experiment-plan` | 实验计划 |
| `/analyze` | `analyze-results` | 分析结果 |
| `/lit` | `research-lit` | 文献综述 |
| `/respond` | `nature-response` | 审稿意见回复 |
| `/html` | `render-html` | 渲染HTML |

它只负责把技能说明书送到模型眼前；技能在不在、跑不跑得动，取决于你装了什么。

## 装

```
dsh plugin add hzh5021/dsh-research-commands
```

手工四步：

1. 把包放进 `~/.dsh/plugins/dsh-research-commands/`。
2. profile 的 `package.json` 里 `dependencies` 加一条（本机口径：`"dsh-research-commands": "file:../../plugins/dsh-research-commands"`），并在 profile 的 `node_modules/` 下留一个同名联接。
3. 同一份 `package.json` 的 `dsh.profile.bundles` 里加上 `"dsh-research-commands"`。
4. 重启 DSH。

插件行由本包自己的 `cordis.patch.yml` 插进 profile 花名册；profile 的 `cordis.yml` 是生成物，不要手改。

## 配置

无配置项。命令表、技能根目录、大小上限都写在代码里。

技能按顺序在两个根目录里找：

1. `~/.dsh/skills/<技能目录>/SKILL.md`
2. `~/.agents/skills/<技能目录>/SKILL.md`

先找到哪个用哪个。

## 怎么工作

- 只声明 `inject = ["commands"]`：命令注册表是这个插件唯一需要的宿主服务。
- 十五条命令各自用 `ctx.effect(function* () { yield ctx.commands.register({...}) })` 注册，effect 名字形如 `research-command-<cmd> lifecycle`。
- 每条命令的 `input.hint` 是给命令面板显示的参数提示（例如 `[论文目录或 PDF]`、`[idea 或方法描述]`）。
- 找不到技能时返回 `{ kind: "error", text: "Skill \"<技能>\" was not found under ~/.dsh/skills or ~/.agents/skills." }`。
- 宿主没有 `agent.steer` 时返回错误，明说这条命令起不来，而不是静默失败。
- 注入的消息形状和宿主 `createUserMessage` 的输出同形（`{ role, content, source }`），在本地构造以避免 import 宿主包：`@deepseek-ai/*` 是宿主提供的 peerDependencies，npm 上发布的那个版本跟真正在跑的对不上，引进来会拉进第二份内核。只用 Node 内置模块。
- 注入正文分两段：`## My request`（你在命令后面写的那句；没写就提示模型先问你）和 `## Skill instructions (\`<技能>\`)`（`SKILL.md` 的正文，frontmatter 已剥）。
- 单条技能正文超过 120,000 字符会截断，并在末尾标 `[truncated: SKILL.md exceeded 120000 characters]`，防一个病态文件把一轮撑爆。
- 命令名刻意短，且都避开了宿主内置的 `/model`、`/plan`、`/compact`、`/permission`、`/export`、`/file`。

## 边界

- 依赖你已经把对应技能装在 `~/.dsh/skills` 或 `~/.agents/skills` 下；没装就只会回一句「找不到」。
- 技能根目录写死，没有配置项。
- 需要宿主暴露 `agent.steer`；没有就报错。
- 送到模型眼前的是技能说明书的正文（已剥 frontmatter），不是执行结果；技能要什么输入、产出什么，由技能自己决定。
- 这十五条命令是固定的一张表：删一条、加一条都要改代码。
- 只用 Node 内置模块（`node:fs/promises`、`node:os`、`node:path`）。

## 冒烟测试

这个包没有自带 `test/`。手工验法：装好重启，敲 `/lit` 之类，看它有没有去读对应的 `SKILL.md`、有没有把「技能找不到」说清楚（故意敲一个没装的技能名就能看到那条错误）。

## English

**What it does** — Registers fifteen slash commands (`/idea`, `/novelty`, `/figure`, `/polish`, `/review`, `/cite`, `/read`, `/poster`, `/slides`, `/paper`, `/exp`, `/analyze`, `/lit`, `/respond`, `/html`) that read the matching skill's `SKILL.md` from `~/.dsh/skills` or `~/.agents/skills`, strip its YAML frontmatter, and inject the body as a user message so the model runs that skill.

**Install** — `dsh plugin add hzh5021/dsh-research-commands`, or drop the package into `~/.dsh/plugins/dsh-research-commands/`, register it in the profile `package.json` (`dependencies` + `dsh.profile.bundles`) and restart DSH.

**Config** — none; the command table and skill roots are hard-coded.

**Requirements** — DSH exposing `commands` and `agent.steer`, plus the skills themselves installed under one of the two skill roots; Node 18+; no external dependencies.

**License** — MIT.

MIT 许可。