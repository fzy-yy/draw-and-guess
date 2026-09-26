/** 分发产物启动后自动用默认浏览器打开本机地址（仅 Windows；失败不影响服务运行）。 */
import { exec } from 'node:child_process'

export function openBrowser(url: string): void {
  if (process.platform !== 'win32') return
  try {
    // `start` 是 cmd 内置命令：第一个空引号是窗口标题占位，避免把 URL 当成标题。
    exec(`start "" "${url}"`, { windowsHide: true })
  } catch {
    // 打开浏览器失败不影响服务运行，控制台仍会打印访问地址。
  }
}
