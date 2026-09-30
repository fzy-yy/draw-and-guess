/**
 * 领域协作者共享端口。
 *
 * 五个领域 Context（session / membership / invite / drawing / vocabulary）此前各自手写同一批
 * 跨模块出口，装配层也为同一能力重复书写投影箭头；这里按语义收敛为三个小接口，Context 用
 * extends 复用——新增/调整共享出口只改本文件一处（ADR-0024「剩余」清单的后续收敛，
 * 纯结构重构、无行为变化）。
 *
 * 纪律：只收敛签名完全一致且语义相同的成员；各 Context 的特有成员仍由各自显式声明，
 * 不为了收敛把不相关的成员塞进同一个大接口。
 */
import type { ServerPushEnvelope, ServerPushEventName } from '@draw-guess/shared'
import type { PlayerSecret } from '../models.ts'
import type { RuntimeDependencies } from '../runtime.ts'

/**
 * 运行时端口：时间、定时与随机数的统一注入面。
 *
 * 领域代码禁止直连系统实现（Date.now / Math.random / setTimeout 由 ESLint 拦截），一律经此注入；
 * clock / random / scheduler 曾在会话、成员、邀请、绘图四个 Context 中重复声明。
 */
export interface RuntimePorts {
  clock: RuntimeDependencies['clock']
  random: RuntimeDependencies['random']
  scheduler: RuntimeDependencies['scheduler']
}

/**
 * 房间推送出口：房间快照刷新、在线状态广播与房间级推送。
 *
 * 事件名与信封在编译期配对（信封由 createServerPush 生成）；emitRoom 曾在会话、成员、绘图、
 * 词库四个 Context 中重复声明，收敛后新增推送出口只改一处。
 */
export interface RoomEventPorts {
  broadcastPresence(): void
  emitRoom(roomId: string): void
  emitRoomEvent<E extends ServerPushEventName>(
    roomId: string,
    event: E,
    envelope: ServerPushEnvelope<E>,
  ): void
}

/**
 * 玩家查询出口：requirePlayer 是唯一的抛错式取用入口（身份不在册即 UNAUTHORIZED）。
 *
 * 曾在会话、成员两个 Context 中重复声明；players / rooms 等原始注册表与 logger 保持各 Context
 * 显式声明，不并入本接口。
 */
export interface PlayerLookupPorts {
  requirePlayer(playerId: string): PlayerSecret
}
