/// <reference types="node" />
/**
 * 部署环境配置与校验：仅允许覆盖网络绑定、端口、日志级别、日志开关、日志保留条数、
 * 健康指标开关与分发产物浏览器自动打开开关。
 * 失败姿态：**显式写下的配置只要写法或取值不对，一律在启动期中止**，不静默取默认值——
 * 静默降级会让「配置明明写了却没生效」变成没有任何迹象的谜题
 *（取舍见 docs/adr/0035-startup-config-fail-fast.md）。
 */
import { isIP } from 'node:net'
import { serverPrivateConfig } from './private.ts'

/**
 * 日志级别合法值：类型（LogLevel）、运行时校验与错误文案都从这一份常量派生，
 * 避免此前「类型、数组、文案」三处各维护一份的漂移风险；新增档位只需改这里。
 */
const LOG_LEVELS = ['info', 'error'] as const

/**
 * 日志级别：只有 info/error 两档——RuntimeLogger 没有 debug/warn 通道（零调用者已删除），
 * 档位必须与可观察行为一致。
 */
type LogLevel = (typeof LOG_LEVELS)[number]

export type DeploymentConfig = {
  host: string
  port: number
  logLevel: LogLevel
  /** 是否启用日志记录：false 时服务端完全不创建日志记录器、不写日志文件，节省内存。 */
  logEnabled: boolean
  /** 日志文件保留的最大条数（1～100）：每次启动新建一个，超出时删除最老的。 */
  logMaxFiles: number
  /** 仅允许本机 /api/health 返回详细进程指标；默认关闭。 */
  healthMetricsEnabled: boolean
  /** 分发产物启动后是否自动打开浏览器；默认开启，设为 false 关闭（仅产物模式生效）。 */
  openBrowserEnabled: boolean
}

/**
 * 布尔型部署变量的统一解析口径：**只接受 true / false**（大小写与首尾空白不敏感），
 * 未设置（空/纯空白）取默认值；其余写法一律 fail-fast。
 * 项目处于开发阶段，不做 1/0/yes/no/on/off 的值级兼容——配置契约保持唯一明确。
 * 旧口径把一切非开族值静默按「关」处理，`LOG_ENABLED=ture` 这类拼写错误会无声关闭全部日志，
 * 因此这里宁可中止启动，也不静默降级。
 */
function parseBooleanEnv(name: string, raw: string | undefined, fallback: boolean): boolean {
  const value = raw?.trim().toLowerCase() ?? ''
  if (value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} 仅接受 true/false，当前值：${raw ?? ''}`)
}

/**
 * 数字型配置的写法闸：只认纯十进制正整数（含前导零写法，`05174`→5174）。
 * `Number()` 会放过 `1e3`/`0x1502`/`+5174`/`5174.0` 等写法，而配置表面应当比「转成数字后是整数」
 * 更严——端口写法必须唯一，否则「我明明写了 5174」还能有别的解释。写法不合格返回 null，
 * 由调用方给出各自的成因句（这一份正则只维护一处）。
 */
function parseDecimalIntegerOrNull(raw: string): number | null {
  return /^\d+$/u.test(raw) ? Number(raw) : null
}

/**
 * 端口解析：写法与取值范围分别成句，保证错误信息里「写法不对」与「超出范围」是两种可读的成因。
 */
function parseListenPort(raw: string): number {
  const value = parseDecimalIntegerOrNull(raw)
  if (value === null) {
    throw new Error(
      `PORT 必须是纯十进制正整数（不支持十六进制、科学计数法、前导正号与小数），当前值：${raw}`,
    )
  }
  if (value < 1 || value > 65_535) {
    throw new Error(`PORT 必须是 1～65535 的整数，当前值：${raw}`)
  }
  return value
}

/**
 * RFC1123 LDH 主机名：总长 ≤253，点分标签各 1～63 字符、仅字母数字与连字符且不以连字符
 * 开头或结尾（大小写不敏感，判定不改变存储取值）。
 * 标签长度上限必须在这里挡住：超长标签能通过总长检查，却要等绑定阶段才报 getaddrinfo
 * 错误——校验层的职责是把绑定失败提前成可读的成因句，而不是让运维在 DNS 报错里猜自己写错了什么。
 */
function isCanonicalHostname(value: string): boolean {
  if (value.length === 0 || value.length > 253) return false
  return value
    .toLowerCase()
    .split('.')
    .every((label) => label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/u.test(label))
}

/**
 * 监听地址在配置解析阶段就校验：接受 IP 字面量（IPv4/IPv6，**方括号只属于 IPv6**）与合法主机名，
 * 其余形态 fail-fast 并报实际取值与成因——放过去只会在绑定阶段抛出运维看不懂的 DNS 错误。
 * IP 判定用 node:net 的 `isIP`：比 ipaddr 一类库的解析面更严（实测拒绝 `010.1.1.1` 前导零伪形）。
 * 三个刻意比 `isIP` 更严的拒绝面（都有实测依据）：
 * - `fe80::1%eth0`：`isIP` 返回 6 即接受 scope-id，但绑定支持依赖平台，显式拒绝比留模糊地带诚实；
 * - `[1.2.3.4]`：剥括号后能过 isIP，可原样传给 listen 必 ENOTFOUND——方括号只允许 IPv6；
 * - 纯数字形态（`256.1.1.1`、`1.2.3`）：按「IP 字面量」成因拒绝——RFC1123 本就排除全数字主机名。
 */
function parseListenHost(raw: string): string {
  const bracketed = /^\[.*\]$/u.test(raw)
  const bare = bracketed ? raw.slice(1, -1) : raw
  const family = isIP(bare)
  // scope-id 要先于族判定拦掉：isIP('fe80::1%eth0') 返回 6 是「接受」，而绑定支持依赖平台。
  if (family !== 0 && bare.includes('%')) {
    throw new Error(
      `HOST 不是合法的 IP 字面量（不支持带 scope-id 的 IPv6，绑定支持依赖平台），当前值：${raw}`,
    )
  }
  // 方括号只属于 IPv6：`[1.2.3.4]` 能过 isIP 但原样传给 listen 必 ENOTFOUND。
  if (family === 6 || (family === 4 && !bracketed)) return raw
  if (bare.includes(':') || /^(?=.*\d)[\d.]+$/u.test(bare)) {
    throw new Error(
      `HOST 不是合法的 IP 字面量（支持 IPv4/IPv6，IPv6 可带外层方括号，不支持 scope-id），当前值：${raw}`,
    )
  }
  if (isCanonicalHostname(raw)) return raw
  throw new Error(
    `HOST 不是合法的主机名（点分段仅含字母数字与连字符、不以连字符开头或结尾、不能全为数字），当前值：${raw}`,
  )
}

/** 合并并基础校验部署覆盖；完整业务约束由服务端启动加载器继续验证。 */
export function getDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  // 纯空白不会走到 parseListenPort，也就不会出现 `Number('  ')` 是 0 的「显式配置了 0 端口」错觉。
  const rawPort = env.PORT?.trim() ?? ''
  const port = rawPort === '' ? serverPrivateConfig.network.port : parseListenPort(rawPort)
  // 空或全空白的 HOST 落到私有配置的默认值（0.0.0.0），因此 `host` 恒非空：不需要（也不该有）
  // 「HOST 不能为空」的兜底分支——那是不可达的死代码，留着只会让读者以为存在这条失败路径。
  // 显式 HOST 在解析阶段校验形态（IP 字面量或 RFC1123 主机名），非法值 fail-fast。
  const explicitHost = env.HOST?.trim() ?? ''
  const host =
    explicitHost === '' ? serverPrivateConfig.network.host : parseListenHost(explicitHost)
  const candidateLevel = env.LOG_LEVEL?.trim() || 'info'
  // 类型谓词集中「字符串 → 合法日志级别」的收窄：调用点无需再各自断言；
  // 用逐项比较而非对只读元组 `includes`，既保持谓词签名又不引入类型断言。
  const isLogLevel = (value: string): value is LogLevel =>
    LOG_LEVELS.some((level) => level === value)
  const logEnabled = parseBooleanEnv('LOG_ENABLED', env.LOG_ENABLED, true)
  const healthMetricsEnabled = parseBooleanEnv(
    'HEALTH_METRICS_ENABLED',
    env.HEALTH_METRICS_ENABLED,
    false,
  )
  const openBrowserEnabled = parseBooleanEnv(
    'DRAW_GUESS_OPEN_BROWSER',
    env.DRAW_GUESS_OPEN_BROWSER,
    true,
  )
  // 日志文件保留条数：默认 10，限定 1～100。
  // 与 PORT 共用同一写法闸（parseDecimalIntegerOrNull）：`1e1`/`0x0a`/`+10` 这类写法
  // 此前会被 Number() 静默接受，与 ADR-0035「写法不对即中止」的承诺不一致。
  const rawMaxFiles = env.LOG_MAX_FILES?.trim() || '10'
  const parsedMaxFiles = parseDecimalIntegerOrNull(rawMaxFiles)
  if (parsedMaxFiles === null) {
    throw new Error(
      `LOG_MAX_FILES 必须是纯十进制正整数（不支持十六进制、科学计数法、前导正号与小数），当前值：${rawMaxFiles}`,
    )
  }
  if (parsedMaxFiles < 1 || parsedMaxFiles > 100) {
    throw new Error(`LOG_MAX_FILES 必须是 1～100 的整数，当前值：${rawMaxFiles}`)
  }
  const logMaxFiles = parsedMaxFiles
  if (!isLogLevel(candidateLevel)) {
    throw new Error(`LOG_LEVEL 仅支持 ${LOG_LEVELS.join('、')}`)
  }
  return {
    host,
    port,
    logLevel: candidateLevel,
    logEnabled,
    logMaxFiles,
    healthMetricsEnabled,
    openBrowserEnabled,
  }
}
