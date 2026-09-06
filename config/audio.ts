/**
 * 领域配置：音效合成。
 * 归入根级 config/ 目录后由 config/index.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const audio = {
  cues: {
    room: { frequencies: [440, 560], duration: 0.1 },
    ready: { frequencies: [620], duration: 0.12 },
    starting: { frequencies: [440, 440, 660], duration: 0.1 },
    drawing: { frequencies: [520, 700], duration: 0.12 },
    correct: { frequencies: [660, 880, 1040], duration: 0.12 },
    warning: { frequencies: [330], duration: 0.08 },
    result: { frequencies: [520, 660], duration: 0.16 },
    final: { frequencies: [523, 659, 784, 1046], duration: 0.16 },
    invite: { frequencies: [740, 880], duration: 0.13 },
  },
  synthesizedGain: 0.13,
  /** 音量滑块（主音量/音效/背景音乐）共用的合法区间与步进。 */
  volumeRange: { min: 0, max: 1, step: 0.05 },
} as const
