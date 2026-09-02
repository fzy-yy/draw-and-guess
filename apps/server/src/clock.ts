/**
 * 系统时钟注入。
 * 领域层普遍使用 Date.now()，但硬编码会造成计时/超时/宽限逻辑难以测试。
 * 这里提供一个可注入的 now()：默认取真实时间，测试时可替换为可控时钟。
 */
export type Clock = () => number

/** 默认时钟：直接返回当前毫秒时间。 */
export const systemClock: Clock = () => Date.now()

/**
 * 构造可控时钟（用于测试）：从 base 起，每次调用向前推进 stepMs。
 * @param base 起始时间（epoch ms），默认当前。
 * @param stepMs 每次调用推进的毫秒数，默认 0（固定时间）。
 */
export function createManualClock(base = Date.now(), stepMs = 0): Clock {
  let current = base
  return () => {
    const value = current
    current += stepMs
    return value
  }
}
