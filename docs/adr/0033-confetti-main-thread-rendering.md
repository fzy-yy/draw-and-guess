# 0033 · 礼花改主线程渲染（CSP 拦截 blob Worker）

**状态**：已采纳

## 背景

`canvas-confetti` 的默认导出内部使用 `confettiCannon(null, { useWorker: true, resize: true })`：
它创建一个 **Blob Worker**，并把画布 `transferControlToOffscreen()` 后交给 Worker 渲染。

服务端 CSP 为 `script-src 'self'` 且**未声明 `worker-src`**；按规范 `worker-src` 回退到
`script-src`，于是 blob Worker 被拦截。浏览器控制台明确报：

```
Creating a worker from 'blob:...' violates the following Content Security Policy directive:
"script-src 'self'" ... The action has been blocked.
```

致命之处在于**控制权已经转移**：画布建好了、`transferControlToOffscreen()` 也执行了，
但 Worker 从未运行；库主线程没有可回退的画布，所以页面上**什么都没有**——表现为
「任何玩家猜中都不显示礼花」（而不是「只有最后一人不显示」）。

## 决策

**改用主线程渲染**：`confetti.create(undefined, { resize: true, useWorker: false })`，
并缓存该发射器实例（首次触发时按需动态加载 canvas-confetti）。**不放宽 CSP。**

选择理由：礼花是低频、装饰性的短时动画，主线程 rAF 开销可忽略；而放宽 CSP
（`worker-src 'self' blob:`）会为装饰效果扩大安全边界。主线程渲染与 CSP 无关，且画布不再被
转移、保留可读像素，端到端可直接断言「真的画出了像素」。

## 后果

- 礼花在任何 CSP 配置下都能真实绘制；端到端（`04-game-guessing.spec.ts`）通过读取画布
  `getImageData` 的 alpha 通道断言存在已绘制像素，可捕获「画布被转移但无人绘制」这类回归。
- 代价：渲染落在主线程而非 Worker（对本项目规模可忽略）。
- 若将来确有 Worker 渲染需求，应显式加 `worker-src 'self' blob:` 并重新评估，而不是依赖回退。

## 关联

- 代码：`apps/client/src/utils/confetti.ts`、`apps/client/src/composables/useGuessConfetti.ts`
- 测试：`test/e2e/specs/04-game-guessing.spec.ts`
- 相关：ADR-0014（低频模块懒加载）、ADR-0031（礼花触发口径）
