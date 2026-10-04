/**
 * 线上协议的公开约束。前后端配置与 Zod Schema 都必须引用这里，避免边界两侧各维护一份。
 * 这里只放会影响协议兼容性或客户端可提交载荷的值；限频、持久化与清理策略属于服务端私有配置。
 */
export const PROTOCOL_VERSION = '18' as const

/**
 * room:closed 推送的稳定关闭码：客户端按码分支（例如被踢弹窗），展示文案只用于提示。
 * 禁止客户端用 reason 文案比对业务语义——文案可变，码不可变。
 */
export const ROOM_CLOSE_CODE = {
  kicked: 'kicked',
  roomEmpty: 'room_empty',
  noPlayableHost: 'no_playable_host',
} as const

export const ROOM_CLOSE_CODES = [
  ROOM_CLOSE_CODE.kicked,
  ROOM_CLOSE_CODE.roomEmpty,
  ROOM_CLOSE_CODE.noPlayableHost,
] as const

export const AVATAR_IDS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
] as const

export const PLAYER_PROTOCOL_LIMITS = {
  minPlayers: 2,
  maxPlayers: 6,
  nicknameMinLength: 1,
  nicknameMaxLength: 10,
  roomNameMaxLength: 24,
  chatMaxLength: 60,
} as const

/**
 * 房间玩法模式：建房时二选一、房间内不可修改（S27 / S28）。
 * 与 `visibility` 同级放在房间顶层，不属可调房间规则。
 */
export const GAME_MODES = ['classic', 'relay'] as const

/**
 * 未显式声明玩法时的线上默认值：保持经典模式现状，
 * 使「只加字段」的变更对既有客户端载荷保持向后兼容（新客户端在建房弹窗显式选择）。
 */
export const DEFAULT_GAME_MODE = 'classic' as const

/**
 * 接龙开局门禁：在线且可玩的成员不少于 4 人且全员准备才能开局（S62）。
 * 与容量（`PLAYER_PROTOCOL_LIMITS.maxPlayers = 6`）分开：容量是上限，这是开局下限。
 */
export const RELAY_MIN_PLAYERS = 4

/**
 * 接龙专属阶段时长档位（秒）：三类阶段各有自己的白名单，
 * 与经典「单回合时长」同手法——档位属协议可观察范围，故落在协议常量，
 * 默认值（20 / 90 / 45）落在公开配置包（见 packages/config/src/relay.ts）。
 */
export const RELAY_CHOOSE_SECONDS_OPTIONS = [10, 15, 20, 30] as const
export const RELAY_DRAW_SECONDS_OPTIONS = [60, 90, 120, 150] as const
export const RELAY_GUESS_SECONDS_OPTIONS = [30, 45, 60, 75] as const

/**
 * 接龙步骤数：每条链固定 4 步（画 → 猜 → 画 → 猜），每步全员各对自己负责的链动手一次（S9）。
 * 步骤号出现在线上（视图的 `currentStep`，见 `RelayStepSchema`），故与档位白名单同放在协议常量。
 */
export const RELAY_STEP_COUNT = 4

/**
 * 单回合时长的合法档位（秒）：房间规则只允许在这四档之间选择。
 * 收窄成白名单而非区间，是因为「单回合时长」现在只由房间决定——
 * 词条难度派生的时限已移除（见 docs/adr/0046-vocabulary-slimming-and-unified-round-time.md）。
 */
export const DRAW_SECONDS_OPTIONS = [60, 90, 120, 150] as const

export const ROOM_RULE_LIMITS = {
  roundsPerPlayer: { min: 1, max: 5 },
  chooseSeconds: { min: 10, max: 30 },
  optionCount: { min: 2, max: 5 },
} as const

/**
 * 画家自定义词的长度上限（grapheme 计数）。
 * 与词库词面 24 字的上限刻意分开：词库是人工维护的长尾资产，自定义词是随手输入，
 * 短词既好画也更好猜（见 docs/adr/0045-custom-word-and-untimed-choosing.md）。
 */
export const CUSTOM_WORD_MAX_LENGTH = 12

export const PRIVATE_ROOM_CODE = {
  alphabet: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  length: 6,
} as const

export const DRAWING_PROTOCOL_LIMITS = {
  colorPattern: '^#[0-9A-Fa-f]{6}$',
  width: { min: 1, max: 30, step: 1 },
  maxPointsPerBatch: 120,
} as const

export const MAX_VOCABULARY_SELECTION_IDS = 10_000

/**
 * 房间词库「最少勾选词条数」裁决线：服务端拒选（VOCABULARY_TOO_SMALL）与客户端选词
 * 提示共用；属线上可观察协议范围，故按单一来源约定写在协议常量（CONTEXT：词库包）。
 */
export const MIN_SELECTED_VOCABULARY_WORDS = 60
