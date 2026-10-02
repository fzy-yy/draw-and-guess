import { test, expect } from '../fixtures/test-base'
import { ProfilePage } from '../pages/profile.page'
import { staticAssets } from '../../../packages/config/src/settings.ts'

/**
 * 08 - 静态资源缓存策略
 *
 * 时长唯一来源：packages/config/src/settings.ts 的 staticAssets（勿在用例内硬编码）。
 * 带内容哈希的 `/assets/**` 产物必须长缓存 + immutable；入口 HTML 与 SPA 回退必须 no-cache。
 * 首屏体积预算与代码分割已移除，取舍见 docs/adr/0049-lan-first-drop-size-and-coverage-gates.md。
 */
test.describe('08 - 静态资源缓存', () => {
  test('哈希产物长缓存、入口与 SPA 回退不缓存', async ({ page, request }) => {
    const profile = new ProfilePage(page)
    // goto 内部已等到「已连接」，即首屏 JS/CSS 已执行完毕
    await profile.goto()
    await page.waitForLoadState('load')

    // 入口 chunk：以 index.html 中的 module script 为准
    const html = await (await request.get('/')).text()
    const entrySrc = html.match(/<script[^>]+src="([^"]+)"/u)?.[1]
    expect(entrySrc, 'index.html 应包含入口 module script').toBeTruthy()

    const assetResponse = await request.get(entrySrc!)
    expect(assetResponse.headers()['cache-control']).toBe(
      `public, max-age=${staticAssets.immutableMaxAgeSeconds}, immutable`,
    )
    const htmlResponse = await request.get('/')
    expect(htmlResponse.headers()['cache-control']).toBe('no-cache')
    // SPA 回退返回的同样是入口 HTML，缓存策略必须一致
    const fallbackResponse = await request.get('/some/client/route')
    expect(fallbackResponse.headers()['cache-control']).toBe('no-cache')
  })
})
