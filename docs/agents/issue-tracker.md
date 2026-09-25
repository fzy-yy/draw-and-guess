# 议题跟踪器：本地 Markdown

本仓库的议题（issues）与规格（specs）以 Markdown 文件形式存放在 `.scratch/` 下，
随仓库入库（不要加入 .gitignore），供 to-tickets / triage / to-spec / wayfinder 等技能读写。

## 约定

- 每个特性一个目录：`.scratch/<feature-slug>/`
- 规格文件：`.scratch/<feature-slug>/spec.md`
- 实现议题：每单一个文件 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，
  编号从 `01` 起，**禁止**把多张工单塞进同一个合并文件
- 分诊状态记在议题文件顶部的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 评论与讨论历史追加在文件底部的 `## Comments` 标题下

## 当技能说「发布到议题跟踪器」时

在 `.scratch/<feature-slug>/` 下新建文件（目录不存在则先创建）。

## 当技能说「拉取相关议题」时

读取被引用路径处的文件。用户通常会直接给路径或议题编号。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图（map）** 是一个文件，正文里指向每张工单的**子文件（child）**。

- **地图**：`.scratch/<effort>/map.md`（Notes / Decisions-so-far / Fog 三个小节）
- **子工单**：`.scratch/<effort>/issues/NN-<slug>.md`，编号从 `01`，正文写问题本身；
  `Type:` 行记类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记
  `claimed`/`resolved`
- **阻塞关系**：顶部 `Blocked by: NN, NN` 行；所列文件全部 `resolved` 即视为解除阻塞
- **前沿（Frontier）**：扫描 `.scratch/<effort>/issues/`，取开放、未阻塞、未认领的文件；
  编号最小者优先
- **认领（Claim）**：动工前先把 `Status: claimed` 写好并保存
- **落定（Resolve）**：在 `## Answer` 标题下追加答案，置 `Status: resolved`，
  再把上下文指针（要点 + 链接）追加到 `map.md` 的 Decisions-so-far
