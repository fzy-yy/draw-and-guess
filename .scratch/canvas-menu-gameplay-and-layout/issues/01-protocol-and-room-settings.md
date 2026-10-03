# 01: 协议与房间设置底座（差一字与微表情开关）

**What to build:** 房主在建房或修改房间规则时，可以自由开启或关闭「差一字提示」与「画布气泡互动」两项游戏规则开关（两项默认均开启）。协议与校验层在全端保证类型安全与版本对齐，并在房间快照中向所有成员同步这两项规则事实。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance criteria

- [ ] 房间配置 Schema 扩展 `allowNearMissHint` 与 `allowCanvasReactions` 两个布尔字段，默认值均为 `true`
- [ ] 协议常量 `protocolVersion` 进行版本对齐递增
- [ ] 建房弹窗（`CreateRoomDialog`）与房间规则弹窗（`RulesDialog`）渲染「差一字提示」与「画布微表情互动」的表单开关字段，文案来自 strings 包
- [ ] 房主修改房间规则后，服务端正确校验并广播更新后的房间快照
- [ ] 单元测试覆盖规则校验与默认值解析，断言非法值被拒绝且布尔值正确反序列化
