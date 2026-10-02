# 0050 · 分发产物收敛为单一自带 Node 包

**状态**：已采纳

## 背景

[ADR-0034](0034-node-single-file-distribution.md) 定下「单 JS + 资源目录」的交付形态，并同时产出
slim（约 2MB，需系统 Node 22+）与 full（约 37MB，自带 Node）两个 zip。实际使用中 slim 的收益有限：
它只对「已自行安装 Node 且在意体积」的少数用户有意义，却让每次构建、测试、文档与发布都要维护
「按包区分」的分支（`start.cmd` 两套模板、使用说明两套运行要求、两份单测断言），也容易让用户拿错包。
2026-10-02 用户明确要求：产物只保留一个、去掉 slim，且唯一产物中不再出现 full 字眼。

## 决策

**一、只产出一个自带 Node 的分发包。** `pnpm package:dist` 产出
`release/draw-and-guess/` → `release/draw-and-guess-<version>-win-x64.zip`，始终包含
`runtime/node.exe`（内置 Node 24 LTS）与 Node 的 `LICENSE`；不再产出 slim 包，产物路径与命名中
也不再有 full/slim 字样。

**二、`start.cmd` 与《使用说明.txt》不再按变体分支。** `apps/server/src/build/dist-templates.ts`
删除 `DistVariant`，`buildStartScript()` 与 `buildUsageNotes(version, port)` 只保留「直用内置运行时」
一条路径；`apps/server/scripts/package-dist.ts` 去掉变体循环，改为单次构建。

**三、删除仅供 slim 的系统 Node 版本校验。** `node-dist.ts` 移除 `MIN_NODE_MAJOR` 常量，
esbuild `target` 改与内置运行时主版本 `BUNDLED_NODE_MAJOR` 联动。内置 Node 的版本解析、镜像下载与
同源 SHASUMS256 校验（ADR-0034 决策六）保持不变。

## 后果

- 正面：构建、测试、文档与发布都少一套「按包区分」的分支；用户只需下载一个包，零依赖开箱即用；
  不再有「slim 需先装 Node」的失败路径。
- 代价：产物体积回到约 37MB，体积敏感用户失去约 2MB 的轻量选项；这是明确接受的取舍。
- 残余风险：若未来重新引入轻量包，应新开 ADR 说明取舍，不直接恢复本 ADR 删除的变体分支。

## 关联

- 取代：[ADR-0034](0034-node-single-file-distribution.md) 中「双包交付与按包区分 `start.cmd`」的部分
  （其运行时布局、词库双目录、esbuild 打包与内置 Node 下载校验等决策继续有效）
- 代码：`apps/server/scripts/package-dist.ts`、`apps/server/src/build/dist-templates.ts`、
  `apps/server/src/build/node-dist.ts`
- 测试：`test/unit/dist-templates.spec.ts`、`test/unit/node-dist.spec.ts`
- 文档：`README.md`、`AGENTS.md`、`docs/adr/README.md`
