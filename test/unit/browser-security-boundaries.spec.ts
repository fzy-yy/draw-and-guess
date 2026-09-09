import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createApplication,
  isAllowedOrigin,
  type RunningApplication,
} from '../../apps/server/src/app.ts'
import { SILENT_LOGGER } from '../../apps/server/src/errors.ts'
import { createMemoryVocabularyRegistry } from './helpers/mini-vocabulary.ts'

let application: RunningApplication | undefined
let temporaryDirectory = ''

afterEach(async () => {
  await application?.close()
  application = undefined
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = ''
})

async function startApplication(): Promise<string> {
  temporaryDirectory = mkdtempSync(join(tmpdir(), 'draw-guess-browser-boundary-'))
  const clientDist = join(temporaryDirectory, 'dist')
  mkdirSync(clientDist)
  writeFileSync(
    join(clientDist, 'index.html'),
    '<!doctype html><main style="color:red">test</main>',
  )
  application = await createApplication({
    dbFile: join(temporaryDirectory, 'test.db'),
    clientDist,
    vocabulary: createMemoryVocabularyRegistry(),
    logger: SILENT_LOGGER,
  })
  await new Promise<void>((resolve, reject) => {
    application!.httpServer.once('error', reject)
    application!.httpServer.listen(0, '127.0.0.1', () => resolve())
  })
  const address = application.httpServer.address()
  if (!address || typeof address === 'string') throw new Error('测试服务器未取得端口')
  return `http://127.0.0.1:${address.port}`
}

describe('浏览器与 Socket 握手边界', () => {
  it('Origin 判定只放行本机和局域网 HTTP(S) 来源', () => {
    expect(isAllowedOrigin(undefined)).toBe(true)
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true)
    expect(isAllowedOrigin('http://192.168.1.20:5173')).toBe(true)
    expect(isAllowedOrigin('https://10.0.0.20')).toBe(true)
    expect(isAllowedOrigin('https://example.com')).toBe(false)
    expect(isAllowedOrigin('file:///tmp/index.html')).toBe(false)
  })

  it('allowRequest 在 Engine.IO 握手阶段拒绝公网 Origin', async () => {
    const baseUrl = await startApplication()
    const rejected = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'https://example.com' },
    })
    expect(rejected.status).toBe(403)

    const accepted = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'http://192.168.1.20:5173' },
    })
    expect(accepted.status).toBe(200)
    expect(await accepted.text()).toMatch(/^0/u)
  })

  it('纯 HTTP 响应启用最小 CSP，但不启用 HTTPS 自动升级或 HSTS', async () => {
    const baseUrl = await startApplication()
    const response = await fetch(baseUrl)
    const policy = response.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("style-src 'self'")
    expect(policy).toContain("style-src-attr 'unsafe-inline'")
    expect(policy).toContain("connect-src 'self' ws: wss:")
    expect(policy).toContain("img-src 'self' data: blob:")
    expect(policy).toContain("media-src 'self' data: blob:")
    expect(policy).not.toContain('upgrade-insecure-requests')
    expect(response.headers.get('strict-transport-security')).toBeNull()
  })
})
