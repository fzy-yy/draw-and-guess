/**
 * 分发产物文本模板：start.cmd 与 使用说明.txt 的纯文本生成。
 *
 * 从 `scripts/package-dist.ts` 抽出的原因：这两份文本决定两种包对终端用户的启动行为
 * （full 直用内置运行时、slim 检测系统 Node），必须以纯函数形式在单测里断言关键行，
 * 而不是每次实跑构建后人眼核对。落盘（写文件、CRLF）由构建脚本负责。
 */
import { BUNDLED_NODE_MAJOR, MIN_NODE_MAJOR } from './node-dist.ts'

/** 分发变体：slim 需系统 Node；full 自带 Node 运行时。 */
export type DistVariant = 'slim' | 'full'

/** 文本行以 CRLF 连接（Windows 批处理与记事本口径），末尾保留一个换行。 */
function joinCrlf(lines: readonly string[]): string {
  return `${lines.join('\r\n')}\r\n`
}

/**
 * 生成 start.cmd：
 * - full：直接 `runtime\node.exe server.mjs`，不做任何版本检测（内置版本可控）；
 * - slim：检测系统 Node，缺失或主版本低于 `MIN_NODE_MAJOR` 时给中文提示并暂停。
 */
export function buildStartScript(variant: DistVariant): string {
  const lines = ['@echo off', 'setlocal', 'chcp 65001 >nul', 'cd /d "%~dp0"']
  if (variant === 'full') {
    lines.push(
      'echo 正在启动「你画我猜」服务（已内置 Node 运行时），稍后会自动打开浏览器……',
      'echo 关闭本窗口或按 Ctrl+C 可停止服务。',
      'echo.',
      'runtime\\node.exe server.mjs',
    )
  } else {
    lines.push(
      'where node >nul 2>nul',
      'if errorlevel 1 (',
      `  echo [错误] 未检测到 Node.js。请先安装 Node.js ${MIN_NODE_MAJOR} 或更高版本：https://nodejs.org/`,
      '  echo        或改用自带运行时的 full 版本。',
      '  pause',
      '  exit /b 1',
      ')',
      'for /f "tokens=1 delims=." %%v in (\'node --version\') do set "NODE_RAW=%%v"',
      'set "NODE_MAJOR=%NODE_RAW:v=%"',
      'if not defined NODE_MAJOR (',
      `  echo [错误] 无法识别 Node.js 版本，请确认已正确安装 Node.js ${MIN_NODE_MAJOR} 或更高版本。`,
      '  pause',
      '  exit /b 1',
      ')',
      `if %NODE_MAJOR% LSS ${MIN_NODE_MAJOR} (`,
      `  echo [错误] Node.js 版本过低（当前主版本 %NODE_MAJOR%），请安装 Node.js ${MIN_NODE_MAJOR} 或更高版本。`,
      '  pause',
      '  exit /b 1',
      ')',
      'echo 正在启动「你画我猜」服务，稍后会自动打开浏览器……',
      'echo 关闭本窗口或按 Ctrl+C 可停止服务。',
      'echo.',
      'node server.mjs',
    )
  }
  lines.push('echo.', 'echo 服务已停止。按任意键关闭窗口。', 'pause >nul')
  return joinCrlf(lines)
}

/**
 * 生成《使用说明.txt》（面向终端用户，纯文本）：
 * 运行要求与运行时目录说明按变体区分，其余章节两包一致。
 */
export function buildUsageNotes(version: string, variant: DistVariant): string {
  const withNode = variant === 'full'
  const requirement = withNode
    ? '  1. 本包已内置 Node 运行时，无需安装 Node.js。'
    : `  1. 本机需安装 Node.js ${MIN_NODE_MAJOR} 或更高版本（https://nodejs.org/）。`
  const lines: (string | null)[] = [
    `「你画我猜」局域网版 v${version} 使用说明${withNode ? '（full：自带 Node）' : '（slim：需自备 Node）'}`,
    '================================================',
    '',
    '一、运行要求',
    requirement,
    '  2. 仅支持 Windows 64 位。',
    '',
    '二、启动服务（房主）',
    '  1. 双击 start.cmd；脚本会启动服务。',
    '  2. 启动后会自动打开浏览器进入游戏；窗口里也会列出局域网地址。',
    '  3. 关闭该窗口或按 Ctrl+C 即停止服务。',
    '',
    '三、其他玩家加入',
    '  1. 其他玩家需与房主处于同一局域网（同一路由器/热点）。',
    '  2. 在浏览器打开窗口里列出的「局域网地址」（形如 http://192.168.x.x:5174）。',
    '  3. 若无法打开：请在 Windows 防火墙弹窗中允许访问「专用网络」，',
    '     并确认设备处于同一网段。',
    '',
    '四、数据与配置',
    '  - 所有运行数据都在本目录下的 data/ 中：',
    '      data/game.db               玩家身份与历史战报',
    '      data/logs/                 运行日志',
    '      data/vocabulary/custom/    用户自定义词库（可放多个 .db，不会被升级覆盖）',
    '      data/.env                  高级配置（端口、日志开关等，可选）',
    '  - 内置词库在 vocabulary/ 目录，升级版本时会随包更新。',
    withNode
      ? `  - 内置 Node ${BUNDLED_NODE_MAJOR} LTS 运行时在 runtime/ 目录（含其 LICENSE），请勿删除。`
      : null,
    '',
    '五、常见问题',
    '  - 端口 5174 被占用：服务会自动顺延到下一个空闲端口，以窗口显示的地址为准。',
    '  - 本服务仅供局域网使用，请勿开放到公网。',
  ]
  return joinCrlf(lines.filter((line): line is string => line !== null))
}
