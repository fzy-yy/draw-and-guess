# 接龙模式 Bug 排查报告（2026-10-05）

排查方式：① 脚本探针 `apps/client/tmp-relay-probe.mts`（4 个 socket.io 客户端、直连协议、打印权威时序）；
② 浏览器四开（192.168.10.1 / 192.168.81.1 / 10.107.44.156 / 172.28.176.1 四个来源＝四个独立身份）跑完 **3 局完整接龙**
（含故意不提交的超时兜底、真实笔画、断线重连、混合投票）；③ 工作区 HEAD 代码在 5199 起对照服务端复现同一现象。

---

## B1（阻断级）接龙房「规则」永远保存失败

**现象**：接龙房点「保存规则」必报 `房间规则超出服务器允许范围`（`INVALID_SETTINGS`）；经典房正常。
**复现**：脚本探针与浏览器四开均 100% 复现；**空补丁 `{}`、单键补丁、经典键补丁也全部被拒**。

**根因**：`packages/shared/src/protocol/room.ts`

```ts
export const UpdateRoomSettingsSchema = RequestSchema.extend({
  patch: RoomSettingsSchema.partial(), // ← 这里
  expectedVersion: z.number().int().nonnegative(),
})
```

Zod **4.4.3** 下 `.partial()` 对带 `.default()` 的字段**仍会补出默认值**：`allowNearMissHint` /
`allowCanvasReactions` / `allowRoundReplay` 三个 `.default(true)` 字段会被塞进**任何**补丁的解析结果，
于是服务端 `game-service.ts:592` 的模式白名单（S52：补丁里出现不生效键一律拒绝）对**接龙房必然命中**——
这三个键只在经典白名单里。经典房恰好三键都生效 ⇒ 只有接龙房坏。

**证据**（`pnpm exec tsx apps/server/tmp-zod-check.mts`）：

```
zod version: { major: 4, minor: 4, patch: 3 }
输入 keys=[] → parse 后 keys=["allowNearMissHint","allowCanvasReactions","allowRoundReplay"]
输入 keys=["relayDrawSeconds"] → parse 后 keys=[...,"relayDrawSeconds"]
```

活服务端 ack：`{"code":"INVALID_SETTINGS","message":"房间规则超出服务器允许范围"}`（空补丁亦同）。

**测试为何漏掉**：`test/unit/room-settings-mode-whitelist.spec.ts` 直接调用 `service.updateSettings(...)`，
**绕过了 binder 的 schema parse**，因此看不到被注入的键。

**修复方向**：为补丁单独定义**不带默认值**的 schema（字段形状与完整 schema 同源）；补两条回归：
schema 层「parse 不注入键」+ 一条经 binder 的接龙规则保存用例。

---

## B2（中）倒计时归零瞬间点「完成提交」→ 报「绘图包已过期或重复」

**现象**：作画倒计时归零时点提交，弹出「绘图包已过期或重复」，玩家读作「提交没生效 / 进不了下一棒」。
**根因**：服务端在阶段截止时刻由定时器代交并换手（`relay/scheduleStepTimeout` → `autoSubmitRemaining` +
`advanceAfterCurrentPhase`），**步骤 id 随之轮换**；客户端若此刻仍停在上一棒（换手快照尚在途中），
提交携带的是旧 `stepId` ⇒ `submitDrawing` 的第一条守卫 `stepId !== relay.stepId` ⇒ `STALE_DRAW_EVENT`。
**属竞态窗口内的错误提示，不是状态损坏**；换手本身按时刻正确发生（探针与浏览器均验证）。

**修复方向**：客户端本地校正时钟越过 `phaseEndsAt` 后，把提交入口切到「本棒已结束，等待其他玩家」，
并把 `STALE_DRAW_EVENT*` / `PHASE_EXPIRED` 归入「静默 + 触发一次重同步」（不弹吓人 Toast）。

---

## B3（低）接龙聊天回一次车发出两条同 requestId 的帧

**现象**：一次回车产生两条 `chat:say`（同 `requestId`）。幂等缓存兜住，用户无感。
**根因**：输入框 Enter 处理与容器提交各触发一次发送。
**修复方向**：收敛为单一发送入口。

---

## B4（低·待确认口径）第 3 棒题面会出现「？」

**现象**：第 2 棒全员未猜（或代交）时，代交兜底文本是 `？`（S16/ADR-0058 明示），第 3 棒的题面即显示 `？`。
**判断**：属已登记偏差，但玩家视角像缺陷。建议确认是否改为「上家未作答」之类可读占位。

---

## 未复现（需要补充信息）

**N1「不同玩家阶段不同步」——未复现。** 证据：

- 脚本 4 客户端 190 秒全流程（含第 1 棒 90 秒超时兜底）**四人相位轨迹逐条一致**；
- 浏览器 4 标签连续 3 局，每次采样四端的 `phase` / 复盘链序号 / `stateVersion` / 截止时间**完全一致**；
- 接龙界面**完全由服务端快照驱动**（复盘「揭晓与否」也由快照决定，客户端不推算时间窗）；
- 唯一可疑来源：① B2 的「归零瞬间」竞态；② 后台标签被浏览器节流（计时/过渡更新变慢）；
  ③ 跨设备时钟偏差——HUD 倒计时已用 `clockOffset` 校正，此项已排除。

**N2「第一棒倒计时结束不自动提交、不换手」——未复现**（与 B2 的解释相反：服务端按时代交并换手，
四次超时场景全部正确换手）。

---

## 回归确认正常（已验证，勿误改）

- **断线重连**：中途关闭标签再重开 → 身份恢复、席位保留、回到当前棒继续（`e36df96` 修复有效）。
- **计分**：链 1/2 各 4 赞同 → 通过 → 每人「共获 8 张赞同票 = 80 分」；链 3/4 全反对 → 不计分 ✓。
- **复盘轮播 / 投票窗口 / 终局 / 再来一局 / 全员返回房间**：四端一致 ✓。
- **接龙聊天**：广播正常（发送者与其他人同时可见），与作答彻底分离 ✓。
- **超时兜底**：选词 / 作画 / 猜词三类超时都按时刻代交并换手 ✓。

---

## 修复与验证（第二轮）

| 缺陷 | 修复内容 | 验证 |
| --- | --- | --- |
| **B1** | `packages/shared/src/protocol/room.ts`：抽出**不带默认值**的 `RoomSettingsShape`，新增 `RoomSettingsPatchSchema = z.object(RoomSettingsShape).partial().strict()`，`UpdateRoomSettingsSchema.patch` 改用它；`RoomSettingsSchema` 仍保留三个 `.default(true)`（建房行为不变）。 | ① 脚本探针（真实 socket 帧）：整份接龙补丁 / 空补丁 / 单键补丁全部 `ok`，经典专属键仍被严格拒绝；② 浏览器四开：接龙房「保存规则」弹窗正常关闭，时长改为 60 / 30 秒并触发「所有人需重新准备」；③ 新增 `test/unit/room-settings-patch.spec.ts`（5 例）走 `CLIENT_REQUEST_SCHEMAS` 注册表，锁住「补丁 parse 不注入键」这条不变式。 |
| **B2** | `RelayAnswerPanel.vue`：引入 `useTimestamp` + `store.clockOffset` 的校正时钟，越过本棒 `phaseEndsAt` 后 `canSubmit` 为假、提示切到新增文案 `ui.game.relayStepEnded`（「本棒已结束，等待其他玩家」），不再让玩家撞「绘图包已过期或重复」。 | 组件用例「本棒截止时间已过：提交入口锁住并提示『本棒已结束』」；夹具新增 `createLiveRelayRoomFixture`（逻辑时间戳换算成真实未来窗），作答浮层相关 7 个用例改用它（原先夹具的 `phaseEndsAt = 61_000`＝1970 年，会把新门禁误判为已过期）。 |
| **B3** | 不修：复查确认为**幂等重试路径**（同一 `requestId` 两帧），服务端缓存去重，用户无感。 | 线协议复查（`__sent` 两帧同 requestId）。 |
| **B4** | 待口径确认（S16 的 `？` 兜底文本），本轮不动。 | — |

**验证汇总**：`pnpm format` / `pnpm lint`（`--max-warnings=0`）/ `pnpm typecheck` / `pnpm build`（含客户端包边界检查）全绿；
`pnpm test:ci` **977 passed / 129 文件**。

**清理**：临时探针脚本（`apps/client/tmp-relay-probe.mts`、`apps/client/tmp-zod-check.mts`、`apps/server/tmp-zod-check.mts`）已删除；
为对照排查启动的 5199 服务端已关闭；浏览器四个标签留在用户环境（未改动用户数据与 `.env`）。
