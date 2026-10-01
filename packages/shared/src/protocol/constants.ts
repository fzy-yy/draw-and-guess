/**
 * 线上协议的公开约束。前后端配置与 Zod Schema 都必须引用这里，避免边界两侧各维护一份。
 * 这里只放会影响协议兼容性或客户端可提交载荷的值；限频、持久化与清理策略属于服务端私有配置。
 */
export const PROTOCOL_VERSION = '16' as const

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
  nicknameMaxLength: 16,
  roomNameMaxLength: 24,
  chatMaxLength: 60,
} as const

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
  guessBaseScore: { min: 50, max: 2_000 },
} as const

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
