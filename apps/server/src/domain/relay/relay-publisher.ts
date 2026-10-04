/**
 * 接龙发布策略：静默（S2 / S49）。
 *
 * 接龙的绘图命令只写入本棒链的权威历史，**绝不向房间广播**——同一棒期间其他玩家收不到任何一笔，
 * 画布由交接时的快照整幅下发（工单 05/06）。实现与经典 `createRoomBroadcastPublisher` 同一接口，
 * 注入点只在装配层（GameService 构造接龙绘图服务处），内核与协调层不含模式分支。
 * 保留同一调用路径（而不是在协调层写 `if (relay) return`）是为了让「零推送」可审计：
 * 想看谁被推送，只需看注入的策略。
 */
import type { DrawingPublisher } from '../drawing/drawing-service.ts'

/** 静默发布策略：接受与经典同形的推送载荷但不发送。 */
export function createSilentPublisher(): DrawingPublisher {
  return {
    publishStroke: () => undefined,
    publishFill: () => undefined,
  }
}
