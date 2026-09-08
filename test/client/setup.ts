import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/vue'

/**
 * happy-dom 测试的公共浏览器基座。
 * 音频和焦点陷阱均已有独立领域测试；组件层只验证交互意图，避免真正播放媒体或依赖布局引擎。
 */
vi.mock('@/audio', () => ({
  isSoundAvailable: vi.fn(() => true),
  playBgm: vi.fn(),
  playInteractionSound: vi.fn(),
  playSound: vi.fn(),
  soundManager: {
    stopAll: vi.fn(),
    updateSettings: vi.fn(),
  },
  stopBgm: vi.fn(),
}))

vi.mock('@vueuse/integrations/useFocusTrap', () => ({
  useFocusTrap: () => ({
    activate: vi.fn(),
    deactivate: vi.fn(),
  }),
}))

// happy-dom 不保证实现这些布局相关 API；统一提供最小无副作用替身，避免组件测试依赖运行环境版本。
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.className = ''
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
