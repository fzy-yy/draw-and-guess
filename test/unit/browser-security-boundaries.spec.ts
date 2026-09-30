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

async function startApplication(
  options: { localHostnames?: readonly string[] } = {},
): Promise<string> {
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
    ...options,
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

  it('私网前缀的域名不被当作局域网来源：私网判定必须先过 IP 字面量闸', () => {
    // 只按前缀判定（/^10\./ 等）时，`10.attacker.com` 这类**域名**会被当成私网放行——
    // 恶意页面可用 DNS rebinding 把自己的域名解析到受害者内网 IP，此时浏览器发出的 Origin
    // 与解析目标都是该域名，等于把局域网内的服务交给任意网页（见 ADR-0036）。
    expect(isAllowedOrigin('http://10.attacker.com')).toBe(false)
    expect(isAllowedOrigin('http://10.0.0.20.attacker.com')).toBe(false)
    expect(isAllowedOrigin('https://192.168.1.1.evil.com')).toBe(false)
    expect(isAllowedOrigin('http://172.16.88.1.attacker.com')).toBe(false)
  })

  it('服务器自己的名字（含 .local 形态）放行，伪装与陌生名字不放行', () => {
    const localNames = ['my-pc', 'my-pc.local', 'mbp', 'mbp.local']
    expect(isAllowedOrigin('http://my-pc:5174', localNames)).toBe(true)
    // URL 会小写化主机名，名单里的写法因此大小写不敏感
    expect(isAllowedOrigin('http://MY-PC:5174', localNames)).toBe(true)
    expect(isAllowedOrigin('http://my-pc.local:5174', localNames)).toBe(true)
    // 放行面只认完整相等：前缀/后缀拼出来的名字一律落空（放行域名形态的唯一理由是它属于本机）
    expect(isAllowedOrigin('http://my-pc.evil.com', localNames)).toBe(false)
    expect(isAllowedOrigin('http://evil-my-pc', localNames)).toBe(false)
    // 名单外的名字（别的机器的计算机名）同样拒绝
    expect(isAllowedOrigin('http://other-pc:5174', localNames)).toBe(false)
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

  it('allowRequest 放行服务器自己的名字：用计算机名访问不再「页面能打开、Socket 连不上」', async () => {
    const baseUrl = await startApplication({ localHostnames: ['my-pc', 'my-pc.local'] })
    const accepted = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'http://my-pc:5174' },
    })
    expect(accepted.status).toBe(200)
    // 伪装成同前缀的域名仍被拒（名单是完整相等比对，不做前缀匹配）
    const rejected = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'http://my-pc.evil.com' },
    })
    expect(rejected.status).toBe(403)
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
