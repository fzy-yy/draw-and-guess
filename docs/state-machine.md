# 房间与对局状态机

本文描述服务端权威状态。客户端只能请求操作，不能直接指定阶段。

```text
waiting → starting → choosing_word → drawing → round_result
                         ↑                       │
                         └───────────────────────┘
round_result → game_result → waiting
choosing_word / drawing / round_result → paused → 原阶段
任意有效阶段 → closed
```

## 关键守卫

- `waiting → starting`：人数不少于 2、全员在线且准备、规则合法、词数充足、请求者为房主且 `stateVersion` 匹配。
- `starting → waiting`：倒计时期间成员取消准备、离开或断线。
- `choosing_word → drawing`：仅当前画家提交本回合候选词 ID；超时由服务端选择。
- `drawing → round_result`：时间耗尽、全部有效猜词者猜中或画家重连宽限结束。
- `round_result → choosing_word`：还有可用回合；否则进入 `game_result`。
- `paused → 原阶段`：仅房主继续，服务端以冻结的剩余毫秒重新计算结束时间。
- `game_result → waiting`：返回房间后所有玩家重新准备，上一局秘密状态被释放。

非法转换返回 `INVALID_TRANSITION`，不会自动猜测调用方意图。每次关键变化递增 `stateVersion`；绘图另使用 `roundId` 与 `sequence` 丢弃旧包。
