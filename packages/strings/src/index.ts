/**
 * 全局文案统一聚合入口。
 *
 * 文案按「用途」分为两个命名空间，另服务端文案独立顶层：
 * - `strings.ui`      —— 界面直接可见的文案（渲染文本、placeholder、Toast/请求提示、元信息）；
 * - `strings.a11y`    —— 无障碍文案（aria-* 绑定与悬浮 title）；
 * - `serverStrings`   —— 服务端产生、经事件/ack 到达界面的文案（错误、通知等）。
 *
 * 分类口径见 .scratch/strings-layering-and-maintenance/spec.md；
 * 两者由源码扫描测试守护，禁止把可见文案塞进无障碍绑定。
 * 客户端与服务端都通过 `@draw-guess/strings` 导入。
 */
import { meta, common as commonUi, connection, status } from './ui/common.ts'
import { common as commonA11y } from './a11y/common.ts'
import { app as appUi } from './ui/app.ts'
import { app as appA11y } from './a11y/app.ts'
import { profile as profileUi } from './ui/profile.ts'
import { profile as profileA11y } from './a11y/profile.ts'
import { lobby as lobbyUi } from './ui/lobby.ts'
import { lobby as lobbyA11y } from './a11y/lobby.ts'
import { room as roomUi } from './ui/room.ts'
import { room as roomA11y } from './a11y/room.ts'
import { game as gameUi } from './ui/game.ts'
import { game as gameA11y, canvas } from './a11y/game.ts'
import { settings as settingsUi } from './ui/settings.ts'
import { settings as settingsA11y } from './a11y/settings.ts'
import { store, request } from './ui/client.ts'
import { serverErrorMessages, serverStrings } from './server.ts'

export const strings = {
  /** 界面直接可见的文案。 */
  ui: {
    meta,
    common: commonUi,
    connection,
    status,
    app: appUi,
    profile: profileUi,
    lobby: lobbyUi,
    room: roomUi,
    game: gameUi,
    settings: settingsUi,
    store,
    request,
  },
  /** 无障碍文案：aria-* 绑定与悬浮 title。 */
  a11y: {
    common: commonA11y,
    app: appA11y,
    profile: profileA11y,
    lobby: lobbyA11y,
    room: roomA11y,
    game: gameA11y,
    canvas,
    settings: settingsA11y,
  },
} as const

export { serverErrorMessages, serverStrings }
