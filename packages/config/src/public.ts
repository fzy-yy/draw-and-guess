/**
 * 可安全返回给浏览器的公开配置子集，不含服务端内部清理策略与限流参数。
 */
import { app, network } from './app.ts'
import { player } from './player.ts'
import { room } from './room.ts'
import { game } from './game.ts'
import { drawing } from './drawing.ts'
import { vocabulary } from './vocabulary.ts'
import { audio } from './audio.ts'
import { localSettings, presets, ui } from './settings.ts'

export const PUBLIC_CONFIG = {
  app,
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
  room: {
    defaultName: room.defaultName,
    seatColors: room.seatColors,
    allowPlayerInvite: room.allowPlayerInvite,
    allowPause: room.allowPause,
    privateCodeLength: room.privateCodeLength,
  },
  game,
  // 画板公开子集：客户端只消费绘制/展示需要的字段；服务端限频与内存预算不下发。
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
  vocabulary: {
    minWords: vocabulary.minWords,
    maxWordLength: vocabulary.maxWordLength,
  },
  localSettings,
  ui,
  presets,
} as const

export type PublicConfig = typeof PUBLIC_CONFIG
