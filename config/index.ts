/// <reference types="node" />
/**
 * 项目唯一业务配置中心（统一聚合导出）。
 *
 * 各领域配置按 app/network/player/room/game/drawing/vocabulary/audio/localSettings/ui/presets/deployment/public
 * 拆分在 config/ 目录内，本文件统一组装成 APP_CONFIG 并导出部署覆盖与公开子集，保持统一配置入口。
 *
 * UI 展示文案收敛在根级 string/ 目录下（按页面细化拆分，由 string/index.ts 统一导出）。
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
import { getDeploymentConfig, type DeploymentConfig } from './deployment.ts'

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
  getDeploymentConfig,
  type DeploymentConfig,
}
