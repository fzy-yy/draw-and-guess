import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import process from 'node:process'

const bundleRoot = resolve('apps/client/dist')
const forbidden = [
  'reconnectGraceMs',
  'drawerReconnectGraceMs',
  'inviteExpiryMs',
  'inviteCooldownMs',
  'guessEventsPerSecond',
  'requestEventsPerSecond',
  'requestRateWindowMs',
  'idempotencyCacheMax',
  'privateJoinWindowMs',
  'privateJoinMaxAttempts',
  'maxDrawEventsPerSecond',
  'vocabulary/base_words.db',
  'maxAliasesPerWord',
  'maxAliasLength',
  'resetWhenExhausted',
  'useWordTimeLimit',
]

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  })
}

const violations = []
for (const path of collectFiles(bundleRoot)) {
  if (!['.html', '.js', '.css', '.map'].includes(extname(path))) continue
  const content = readFileSync(path, 'utf8')
  for (const token of forbidden) {
    if (content.includes(token)) violations.push(`${path}: ${token}`)
  }
}

if (violations.length > 0) {
  throw new Error(`浏览器产物包含服务端私有配置：\n${violations.join('\n')}`)
}

process.stdout.write(`浏览器包边界检查通过：${forbidden.length} 个私有标记均未出现。\n`)
