<!--
  顶栏网络状态按钮（可复用）：Wifi 图标 + 当前延迟数值，按钮配色随连接质量变化。
  收敛大厅 / 房间 / 对局等各顶栏重复的「网络状态」写法，保证网络 UI 全站一致：
  - 绿色：已连接且延迟 ≤ APP_CONFIG.network.latencyGoodMs（连接良好）；
  - 橙色（yellow 语义令牌）：已连接但延迟高于阈值（网络较慢）；
  - 红色：断线（Socket 未连接）；
  - 中性色：已连接但延迟尚未测得（进入页面后的首个探测周期内）。
  颜色只取 index.css @theme 的语义令牌（green/yellow/red/sky），悬浮/无障碍文案
  统一来自 strings.common.networkStatusAria / connectionDetail，禁止硬编码色值与文案。
-->
<script setup lang="ts">
import { computed } from 'vue'
import { Wifi } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'

const props = withDefaults(
  defineProps<{
    /** 尺寸变体：default 用于对局 HUD，lg 用于房间/大厅顶栏（与 IconButton 档位一致）。 */
    size?: 'default' | 'lg'
  }>(),
  { size: 'default' },
)
const store = useGameStore()

/**
 * 连接质量档位：驱动按钮配色。
 * - offline：Socket 未连接（断线），红色；
 * - good / slow：已连接且已测得延迟，按 latencyGoodMs 阈值分绿色 / 橙色；
 * - unknown：已连接但延迟尚未测得（store.latency 为 0），中性色避免误报「良好」。
 */
const quality = computed<'good' | 'slow' | 'offline' | 'unknown'>(() => {
  if (!store.connected) return 'offline'
  if (!store.latency) return 'unknown'
  return store.latency <= store.config.network.latencyGoodMs ? 'good' : 'slow'
})

/** 各档位配色：底色用语义色低透明度衬底，文字/图标用同色实色，保持在 navy 顶栏上的对比度。 */
const qualityClass = {
  good: 'bg-green/15 text-green',
  slow: 'bg-yellow/15 text-yellow',
  offline: 'bg-red/15 text-red',
  unknown: 'bg-white/10 text-sky',
} as const

// 悬浮与无障碍详情共用同一文案（状态 + 延迟），禁止在组件内拼装单位。
const detail = () => strings.common.connectionDetail(store.connectionLabel, store.latency)
</script>

<template>
  <button
    type="button"
    class="ui-feedback flex shrink-0 items-center gap-[0.4em] rounded-[0.6em] px-[0.65em]"
    :class="[qualityClass[quality], props.size === 'lg' ? 'h-[4.6cqh]' : 'h-[4.4cqh]']"
    :aria-label="strings.common.networkStatusAria(store.connectionLabel, store.latency)"
    :title="detail()"
  >
    <Wifi
      :class="props.size === 'lg' ? 'h-[2.8cqh] w-[2.8cqh]' : 'h-[2.6cqh] w-[2.6cqh]'"
      class="shrink-0"
    />
    <!-- 延迟数值：tabular-nums 防止位数变化抖动；未测得时显示占位符「—」 -->
    <span class="min-w-[3ch] text-center text-[0.72em] font-extrabold leading-none tabular-nums">{{
      store.latency ? strings.common.latencyShort(store.latency) : strings.common.emptyDash
    }}</span>
  </button>
</template>
