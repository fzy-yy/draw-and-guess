/**
 * 浏览器安全的应用配置 workspace 包（统一聚合导出）。
 *
 * 各领域配置按 app/network/player/room/game/drawing/vocabulary/audio/localSettings/ui/presets/public
 * 拆分在包内，本文件统一组装成 APP_CONFIG；协议约束引用 @draw-guess/shared，服务端私有策略不在本包声明。
 *
 * UI 展示文案由独立的 @draw-guess/strings workspace 包提供。
 */
import { app, network } from './app.ts'
import { player } from './player.ts'
import { room } from './room.ts'
import { game } from './game.ts'
import { drawing } from './drawing.ts'
import { vocabulary } from './vocabulary.ts'
import { audio, soundCatalog } from './audio.ts'
import { localSettings, presets, ui } from './settings.ts'
import { PUBLIC_CONFIG, type PublicConfig } from './public.ts'
import {
  ROOM_PRESETS,
  ROOM_PRESET_IDS,
  applyRoomPreset,
  closestRoomPreset,
  createRoomSettings,
  matchingRoomPreset,
  roomPresetDifferences,
  type RoomPresetField,
  type RoomPresetId,
  type RoomPresetSettings,
} from './room-presets.ts'

/** 领域配置合并为唯一业务配置对象。 */
export const APP_CONFIG = {
  app,
  network,
  player,
  room,
  game,
  drawing,
  vocabulary,
  audio,
  localSettings,
  ui,
  presets,
} as const

export {
  app,
  network,
  player,
  room,
  game,
  drawing,
  vocabulary,
  audio,
  soundCatalog,
  localSettings,
  presets,
  ui,
  PUBLIC_CONFIG,
  type PublicConfig,
  ROOM_PRESETS,
  ROOM_PRESET_IDS,
  applyRoomPreset,
  closestRoomPreset,
  createRoomSettings,
  matchingRoomPreset,
  roomPresetDifferences,
  type RoomPresetField,
  type RoomPresetId,
  type RoomPresetSettings,
}
