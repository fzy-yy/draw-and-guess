/**
 * 可安全返回给浏览器的公开配置子集，不含服务端内部清理策略与限流参数。
 *
 * 本文件只做「挑选与转发」：每个键的含义与取值口径都在其定义文件
 * （app/player/room/game/relay/drawing/vocabulary/audio/settings）里说明。
 * 客户端经 `store.config`（即本对象）读取，故此处新增/删除键会直接改变客户端可见面。
 */
import { app, network } from './app.ts'
import { player } from './player.ts'
import { room } from './room.ts'
import { game } from './game.ts'
import { relay } from './relay.ts'
import { drawing } from './drawing.ts'
import { vocabulary } from './vocabulary.ts'
import { audio } from './audio.ts'
import { localSettings, presets, ui } from './settings.ts'

export const PUBLIC_CONFIG = {
  app,
  // 网络子集：只下发客户端自己要用到的超时、重试、心跳与延迟阈值；服务端限频策略不下发。
  network: {
    requestTimeoutMs: network.requestTimeoutMs,
    requestRetryAttempts: network.requestRetryAttempts,
    requestRetryDelayMs: network.requestRetryDelayMs,
    stateResyncCooldownMs: network.stateResyncCooldownMs,
    pingIntervalMs: network.pingIntervalMs,
    sessionRestoreRetryMs: network.sessionRestoreRetryMs,
    latencyGoodMs: network.latencyGoodMs,
  },
  player,
  // 房间子集：只下发房间标识信息；可调规则默认值随 RoomSettings 走快照，不从这里读。
  room: {
    defaultName: room.defaultName,
    seatColors: room.seatColors,
    privateCodeLength: room.privateCodeLength,
  },
  game,
  // 接龙公开子集：三时长默认值供规则弹窗初值，复盘时长与胶囊过渡参数供客户端动画。
  relay,
  // 画板公开子集：客户端只消费绘制/展示需要的字段；服务端限频与内存预算（*PerRound/Stroke）不下发。
  drawing: {
    colors: drawing.colors,
    colorPattern: drawing.colorPattern,
    defaultColor: drawing.defaultColor,
    width: drawing.width,
    devicePixelRatioCap: drawing.devicePixelRatioCap,
    referenceResolution: drawing.referenceResolution,
    minLineScale: drawing.minLineScale,
    dedupDistance: drawing.dedupDistance,
    fillTolerance: drawing.fillTolerance,
    batchIntervalMs: drawing.batchIntervalMs,
    maxPointsPerBatch: drawing.maxPointsPerBatch,
    maxHistoryCommands: drawing.maxHistoryCommands,
  },
  audio,
  // 词库子集：只下发客户端需要展示/提示的门槛值；数据库路径与 Provider 预算留在服务端。
  vocabulary: {
    minWords: vocabulary.minWords,
    maxWordLength: vocabulary.maxWordLength,
  },
  localSettings,
  ui,
  presets,
} as const

export type PublicConfig = typeof PUBLIC_CONFIG
