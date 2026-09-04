<!--
  游戏画框（.game-stage 舞台）以外的页面背景外壳（从 App.vue 抽出的独立组件）。
  职责：把舞台整体居中在视口中央，并承载舞台以外的背景视觉 —— 夜空繁星。
  纯代码实现（不使用任何图片）：
  - 深色天空：复用主题 navy 色令牌的 radial 渐变再熔黑色，形成有层次的夜穹；
  - 星点：按固定种子的确定性伪随机生成一小片点阵（避免热刷新/重建时随机跳动），
    每颗仅用 CSS opacity 做交错闪烁 —— 只触发合成器重绘，不做布局/绘制重排，性能友好；
  - 跟随全局 motion-disabled 与系统 prefers-reduced-motion 关闭闪烁动画（静态星点）。
  舞台内容通过默认插槽传入，本组件与页面逻辑完全解耦；特效层垫在插槽（游戏画框）之下。
-->
<script setup lang="ts">
import { computed } from 'vue'

/** 单颗星的可变外观：位置/大小/最亮不透明度/闪烁相位（抖动幅度由固定种子决定）。 */
interface StarSpec {
  id: number
  left: number // 视口横向百分比 0~100
  top: number // 视口纵向百分比 0~100
  size: number // 星点直径（px）
  maxOpacity: number // 闪烁峰值不透明度 0~1
  duration: number // 一次闪烁周期（秒）
  delay: number // 相位错开（秒），避免所有星同频跳动
}

/**
 * mulberry32：小巧的确定性伪随机数发生器。
 * 用固定种子让每次挂载得到完全相同的点阵，热刷新/组件重建时星空不抖动。
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const STAR_COUNT = 130 // 星点总数；仅 opacity 动画，130 颗对现代浏览器无压力
const rnd = mulberry32(0x5eed)

/**
 * 生成星点阵列。因不依赖任何响应式输入、且无副作用，用 computed 使结果在组件内只算一次；
 * 位置均匀覆盖整块视口，无论哪一侧露出的边缘都能看到星点。
 */
const stars = computed<StarSpec[]>(() =>
  Array.from({ length: STAR_COUNT }, (_, id) => ({
    id,
    left: rnd() * 100,
    top: rnd() * 100,
    size: 0.7 + rnd() * 2.3,
    maxOpacity: 0.35 + rnd() * 0.6,
    duration: 2.4 + rnd() * 4.6,
    delay: rnd() * 6,
  })),
)
</script>

<template>
  <div class="night-sky relative grid h-full w-full place-items-center overflow-hidden">
    <!-- 繁星层：垫在游戏舞台（插槽）之下，绝对定位铺满视口。
         pointer-events-none 保证不拦截任何游戏操作；aria-hidden 告知辅助技术这层是纯装饰。 -->
    <div class="starfield" aria-hidden="true">
      <span
        v-for="star in stars"
        :key="star.id"
        class="star"
        :style="{
          left: `${star.left}%`,
          top: `${star.top}%`,
          width: `${star.size}px`,
          height: `${star.size}px`,
          '--tw-min': '0.06',
          '--tw-max': star.maxOpacity.toFixed(2),
          '--tw-duration': `${star.duration}s`,
          '--tw-delay': `${star.delay}s`,
        }"
      />
    </div>
    <!-- 默认插槽：游戏画框（.game-stage），由父组件 App.vue 填充 -->
    <slot />
  </div>
</template>
