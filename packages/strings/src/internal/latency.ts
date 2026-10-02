/**
 * 跨类别共享的延迟展示纯函数（无障碍与可见文案共用，不属任一类别）。
 */

/** 延迟展示上限（毫秒）：顶栏网络徽章只需三位数，超过一律封顶。 */
export const LATENCY_DISPLAY_MAX_MS = 999

/** 展示用延迟值：统一按上限封顶，供全部延迟文案共用。 */
export const clampLatency = (latency: number): number => Math.min(latency, LATENCY_DISPLAY_MAX_MS)
