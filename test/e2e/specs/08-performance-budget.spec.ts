import { test, expect } from '../fixtures/test-base'
import { ProfilePage } from '../pages/profile.page'
import { performance } from '../../../packages/config/src/settings.ts'

/**
 * 08 - 首屏性能预算与静态资源缓存
 *
 * 预算阈值唯一来源：packages/config/src/settings.ts 的 performance（勿在用例内硬编码）。
 * 两项门禁：
 * 1. 主入口 JS chunk 的 gzip 体积（资源计时的 encodedBodySize）；
 * 2. 首屏（资料页）实际下载的传输体积（同源非 Socket.IO 资源的 transferSize 求和）。
 *
 * 同时校验缓存策略：带内容哈希的 /assets/** 必须长缓存 + immutable，入口 HTML 必须 no-cache。
 * 体积构成排查用 `BUNDLE_REPORT=1 pnpm --filter @draw-guess/client build` 的模块占比报告。
 */

interface ResourceSample {
  name: string
  transferSize: number
  encodedBodySize: number
}

const kib = (bytes: number) => bytes / 1024

test.describe('08 - 首屏性能预算与静态资源缓存', () => {
  test('入口 gzip 与首屏下载在预算内，哈希产物长缓存、入口不缓存', async ({ page, request }) => {
    const profile = new ProfilePage(page)
    // goto 内部已等到「已连接」，即首屏 JS/CSS 已执行完毕
    await profile.goto()
    await page.waitForLoadState('load')
    // 首屏图片（头像 SVG）由 JS 插入，不属于 load 事件覆盖范围：等它们出现并下载完成再统计
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('img')]
      return images.length > 0 && images.every((image) => image.complete)
    })

    const resources: ResourceSample[] = await page.evaluate(() =>
      window.performance.getEntriesByType('resource').map((entry) => {
        const resource = entry as PerformanceResourceTiming
        return {
          name: resource.name,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
        }
      }),
    )

    // 首屏实际下载：同源资源，排除 Socket.IO 长连接握手/轮询（不属于首屏静态资源）
    const origin = new URL(page.url()).origin
    const firstScreen = resources.filter(
      (item) => item.name.startsWith(origin) && !item.name.includes('/socket.io/'),
    )
    const firstScreenBytes = firstScreen.reduce((sum, item) => sum + item.transferSize, 0)

    // 入口 chunk：以 index.html 中的 module script 为准（代码分割后入口文件名不可硬编码）
    const html = await (await request.get('/')).text()
    const entrySrc = html.match(/<script[^>]+src="([^"]+)"/u)?.[1]
    expect(entrySrc, 'index.html 应包含入口 module script').toBeTruthy()
    const entry = resources.find((item) => item.name.endsWith(entrySrc!))
    expect(entry, `首屏资源中应包含入口脚本 ${entrySrc}`).toBeTruthy()

    console.log(
      `[性能预算] 入口 gzip ${kib(entry!.encodedBodySize).toFixed(1)} KiB / ` +
        `首屏下载 ${kib(firstScreenBytes).toFixed(1)} KiB（${firstScreen.length} 个资源）`,
    )
    console.log(
      '[性能预算] 首屏资源明细',
      firstScreen
        .map((item) => `${item.name.split('/').pop()} ${kib(item.transferSize).toFixed(1)}KiB`)
        .join(' + '),
    )

    expect(
      kib(entry!.encodedBodySize),
      `主入口 gzip 体积应 ≤ ${performance.mainEntryGzipKib} KiB`,
    ).toBeLessThanOrEqual(performance.mainEntryGzipKib)
    expect(
      kib(firstScreenBytes),
      `首屏实际下载应 ≤ ${performance.firstScreenTransferKib} KiB`,
    ).toBeLessThanOrEqual(performance.firstScreenTransferKib)

    // 缓存策略：哈希产物长缓存 + immutable；入口 HTML 每次校验
    const assetResponse = await request.get(entrySrc!)
    expect(assetResponse.headers()['cache-control']).toBe(
      `public, max-age=${performance.immutableAssetMaxAgeSeconds}, immutable`,
    )
    const htmlResponse = await request.get('/')
    expect(htmlResponse.headers()['cache-control']).toBe('no-cache')
    // SPA 回退返回的同样是入口 HTML，缓存策略必须一致
    const fallbackResponse = await request.get('/some/client/route')
    expect(fallbackResponse.headers()['cache-control']).toBe('no-cache')
  })
})
