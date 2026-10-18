/**
 * 模式 → 生效的规则键名（S52 的唯一来源）。
 *
 * 为什么放在共享协议层：这份清单同时被**服务端拒绝口径**（`updateSettings` 严格拒绝
 * 补丁里出现的不生效键）和**客户端裁剪口径**（规则弹窗把完整草稿裁成当前模式生效的补丁）
 * 使用。此前它有三份副本——服务端死掉的旧实现一份、活的模块服务一份、客户端镜像一份，
 * 守护测试比对的还是死的那份（docs/adr/0064-single-backend-assembly.md）。
 *
 * 共用键（候选词数 / 换一批 / 自定义题目 / 房间内邀请）两种模式都生效；
 * 经典专属键只在经典房生效，接龙三时长只在接龙房生效。
 */
import type { GameMode, RoomSettings } from '../types/room.ts'

export const MODE_SETTINGS_KEYS = {
  classic: [
    'roundsPerPlayer',
    'drawSeconds',
    'chooseSeconds',
    'showWordLength',
    'progressiveHints',
    'allowNearMissHint',
    'allowCanvasReactions',
    'allowRoundReplay',
    'optionCount',
    'allowWordReroll',
    'allowCustomWord',
    'allowPlayerInvite',
  ],
  relay: [
    'relayChooseSeconds',
    'relayDrawSeconds',
    'relayGuessSeconds',
    'optionCount',
    'allowWordReroll',
    'allowCustomWord',
    'allowPlayerInvite',
  ],
} as const satisfies Record<GameMode, readonly (keyof RoomSettings)[]>
