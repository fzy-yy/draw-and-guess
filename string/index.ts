/**
 * 全局 UI 文案统一聚合入口。
 *
 * 各页面与领域文案按 common/app/profile/lobby/room/game/settings/client/server
 * 拆分在 string/ 目录下，这里统一聚合导出 strings 与 serverStrings，保持调用方接口与类型不变。
 *
 * 约定：
 * - `strings`            —— 客户端（浏览器）侧展示文案；
 * - `serverStrings`      —— 服务端产生的、会随事件/ack 展示到界面上的文案（错误、通知等）；
 * - 客户端通过 `@draw-guess/strings` 别名导入；
 * - 服务端通过相对路径 `../../../string/index.ts` 导入。
 */
import { meta, common, connection, status } from './common.ts'
import { app } from './app.ts'
import { profile } from './profile.ts'
import { lobby } from './lobby.ts'
import { room } from './room.ts'
import { game, canvas } from './game.ts'
import { settings } from './settings.ts'
import { store, request } from './client.ts'
import { serverStrings } from './server.ts'

export const strings = {
  meta,
  common,
  connection,
  status,
  app,
  profile,
  lobby,
  room,
  game,
  canvas,
  settings,
  store,
  request,
} as const

export { serverStrings }
export type Strings = typeof strings
export type ServerStrings = typeof serverStrings
