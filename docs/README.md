# 文档地图

本目录是仓库的文档入口。**第一入口是根级 [`AGENTS.md`](../AGENTS.md)**（项目约束、编码/测试/提交流程），
本页只做导航，不重复其内容。

## 根级文档

| 文档                          | 用途                                                  |
| ----------------------------- | ----------------------------------------------------- |
| [`AGENTS.md`](../AGENTS.md)   | 项目导读、硬性约束、启动/编码/测试/提交流程（最权威） |
| [`README.md`](../README.md)   | 项目总览、十分钟启动、命令清单、配置与安全说明        |
| [`CONTEXT.md`](../CONTEXT.md) | 领域词表（单上下文布局，供议题/测试/注释统一用词）    |

## 本目录（`docs/`）

### 专题参考

| 文档                                                         | 主题                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| [`后端架构规范.md`](./后端架构规范.md)                       | 后端架构、分层与文件结构规范（Express 5 + Socket.IO + SQLite） |
| [`canvas-resolution-model.md`](./canvas-resolution-model.md) | 画布双层分辨率模型：逻辑层重放 + DPR 封顶展示层                |
| [`flood-fill-performance.md`](./flood-fill-performance.md)   | 洪泛填充性能与一致性基线（基准命令与历史数据）                 |
| [`game-result-exit.md`](./game-result-exit.md)               | 最终结算退出状态机（展示期与自动返回上限）                     |
| [`wcag-aa-color-contrast.md`](./wcag-aa-color-contrast.md)   | WCAG AA 颜色对比基线（令牌与实测比值）                         |

### 架构决策记录

[`adr/`](./adr/) 记录**已落地、单看代码看不出理由**的决策（背景 / 决策 / 后果）。
索引按主题分组、逐条标注状态，见 [`adr/README.md`](./adr/README.md)；源码注释按编号链接到这里，
故编号与文件名是稳定标识、不随分组调整。

### 工程技能配置

[`agents/`](./agents/) 存放工程技能（issue tracker / triage / domain docs）的仓库级配置：
[`issue-tracker.md`](./agents/issue-tracker.md)（本地 Markdown 议题约定）、
[`triage-labels.md`](./agents/triage-labels.md)（分诊标签映射）、
[`domain.md`](./agents/domain.md)（领域文档消费方式）。

## 目录之外的文档

| 文档                                                                                  | 主题                   |
| ------------------------------------------------------------------------------------- | ---------------------- |
| [`apps/client/src/assets/audio/README.md`](../apps/client/src/assets/audio/README.md) | 自定义音效资源放置说明 |

## 维护约定

- 新增文档前先判断归属：跨模块决策写 `docs/adr/`（编号递增、不复用）；可复现的基线/专题说明写本目录；架构与工程决策一律编写为 ADR 写入 `docs/adr/`。
- 文档里的路径、命令、版本号以代码为准；`test/unit/documentation.consistency.spec.ts` 会校验 `AGENTS.md` / `README.md` 中反引号路径的真实性与大小写。
- 本页只做导航：新增/删除文档时同步更新上面的表格。
- `adr/README.md` 的索引**按主题分组**，分组只是导航：编号与文件名是源码注释引用的稳定标识，
  不因分组调整而改动。
