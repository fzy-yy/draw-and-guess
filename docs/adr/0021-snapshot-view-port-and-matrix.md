# 0021 快照裁剪窄端口与角色×阶段穷举矩阵

**状态**：已采纳

- 来源：架构评审候选 C5（隐私是 AGENTS 硬约束，但回归防线只有 5 个子串抽查）

## 背景

`SnapshotBuilder` 是「服务端秘密绝不进快照」这条硬约束的唯一执行点，但它的
constructor 收整张 `GameService`（`snapshot.ts` ↔ `game-service.ts` 类型环），
后果有二：

1. **测不到**：实例化必须拉起全图 harness，隐私回归退化为 `server-defects` 的
   双玩家抽查 + `['token','requestCache','candidates','privateJoinCode','timer']`
   5 个子串扫描——新增 Secret 字段（如 `offeredWordIds`）命名不含这 5 词即漏网；
   be8c01f 对该文件 36 行「四分支真值一致」的守卫重排只能靠人工评审，因为
   差分测试不存在。
2. **挡不住改坏**：裁剪 switch（画家/普通/观战/候场/已离局 × 8 阶段）的授权真值表
   没有任何一格被穷举断言过；「观战 ID 恰等于 drawerId」等防御分支只在注释里存在。

另外同一快照对 `getRoomVocabularyStore(room)` 连调 4 次（同参数重复）。

## 决策

1. **`SnapshotViewPort` 窄端口**（定义在 `snapshot.ts`，消费者声明，同 ADR-0019 哲学）：
   `players`/`rooms`（ReadonlyMap）+ `clock` + `isPlaying` + `getRoomVocabularyStore` +
   `requirePlayer` 六个成员——正是裁剪实际触碰的全部读取面。GS 六个成员均 public，
   `new SnapshotBuilder(this)` **结构上直接满足，零断言**；GS↔Snapshot 类型环断开
   （snapshot.ts 不再 import game-service）。GS 的写路径/计时器/仓储对本模块不可见，
   「裁剪器不可能改动权威状态」由类型而非纪律保证。
2. **穷举矩阵**（`test/unit/snapshot.matrix.spec.ts`）：观看者角色 7 档 × 阶段 7 档 = 49 格，
   另有私密房码、canReturnWaiting 时间轴、strokesOmitted 差分、观战=画家防御、非成员拒绝等专项行。
   每格**三重守卫**：① `RoomSnapshotSchema`（strict）safeParse 必过——任何 Secret 字段混入即现形；
   ② 序列化不含矩阵登记的全部秘密键名（`PlayerSecret`/`MemberState`/`RoomSecret`/`GameSecret`
   的内部字段清单，见该文件的 `FORBIDDEN_KEYS`）+ `SENTINEL-` 哨兵值（秘密字段换键位泄漏也会被抓）；
   ③ 授权可见性真值表：answer/wordHint 仅画家本人、wordOptions 仅画家 × choosing_word、
   privateJoinCode 仅房主、canReturnWaiting 三条件——欠曝与越权同罪。
3. **fixture 直构 Secret**（带哨兵值）+ fake 端口（词库复用 mini-vocabulary registry，
   clock 用字面量 `{ now }`）——矩阵毫秒级、不触仓储/socket/计时器，deletion test：
   删掉窄端口则矩阵必须回到全图 harness，复杂度是集中的。
4. **旧抽查用例删除**（不双养，同 C1 先例）：`server-defects` 的隐私 `it` 移除，
   留注释指向矩阵；绘图边界用例保留。
5. **顺手**：词库 store 每次 snapshot 只取一份（4 调 → 1）。

## 后果

- 正面：隐私守卫从「抽查 + 注释」升为「穷举可执行」；新增 Secret 字段会同时被
  FORBIDDEN_KEYS（人工登记）与 strict schema（自动拦截未声明键）两道逼出；
  角色×阶段任一维度的裁剪回归在毫秒级现形；SnapshotBuilder 获得独立构造入口，
  be8c01f 类「真值一致重排」从此有差分对照。
- 代价与维护约定：`FORBIDDEN_KEYS` 清单在新增 Secret 字段时需同步登记（注释注明
  判据：JSON 键名与 ChatMessage 等公开字段不冲突；`createdAt`/`roomId`/`answer` 等
  「同名合法出现」的键不列入，由真值表与 strict 闸门负责）；真值表把当前语义钉死——
  有意变更授权规则（如结算阶段也隐藏答案）必须同步改矩阵格，让语义变更显形为测试变更。
- 边界：不裁 GS 的其它依赖面（C4 装配收敛是独立候选）；`game-transport` 等消费点
  仍经 `service.snapshotter` 使用，构造处零改动。

## 关联

- 模块：`apps/server/src/snapshot.ts`（SnapshotViewPort/SnapshotBuilder）、
  `test/unit/snapshot.matrix.spec.ts`
- 测试：`test/unit/server-defects.spec.ts`（隐私抽查退役）
- 前序：ADR-0019（窄端口哲学）、ADR-0016（类型护栏）；AGENTS「角色裁剪快照」「约束 2」
