/**
 * 玩家头像角标的共用底座类（S73）：接龙的玩家 chip 与经典玩家面板的画家 / 已猜中角标
 * 共用同一份「蓝底圆 + 白色图标」样式，避免两处各写一份导致视觉漂移。
 * 尺寸按舞台容器单位（cqh）缩放，与头像同源。
 */
export const PLAYER_BADGE_CLASS =
  'absolute right-[-0.25cqh] bottom-[-0.15cqh] grid h-[2.1cqh] w-[2.1cqh] place-items-center rounded-full bg-blue text-white shadow-xs'
