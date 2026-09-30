import { execSync } from 'node:child_process'
import { isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'

/**
 * 是否为可向局域网会话公开的私网 IPv4（RFC1918：10/8、172.16/12、192.168/16）。
 * 只做前缀匹配；「放行来源」场景必须再套字面量闸，见 isPrivateIpv4Literal。
 */
export function isPrivateIpv4(address: string): boolean {
  return (
    /^10\./u.test(address) ||
    /^192\.168\./u.test(address) ||
    /^172\.(1[6-9]|2\d|3[01])\./u.test(address)
  )
}

/**
 * 私网 IPv4 **字面量**判定：先过 isIPv4 字面量闸，再看 RFC1918 前缀。
 * isPrivateIpv4 只按前缀匹配，单看前缀会把 `10.attacker.com`、`192.168.evil.com`
 * 这类**域名**当成私网放行——恶意页面可用 DNS rebinding 把自己的域名解析到受害者内网 IP。
 * 凡「放行来源」场景（CORS/握手）必须用本谓词；取舍见 docs/adr/0036-origin-private-ip-literal.md。
 */
export function isPrivateIpv4Literal(address: string): boolean {
  return isIPv4(address) && isPrivateIpv4(address)
}

/** 排除回环、链路本地、常见虚拟网卡（含 Windows Hyper-V 的 vEthernet）与公网/CGNAT，只返回同网段可访问的私网 IPv4。 */
export function findLanAddresses(): string[] {
  const results = new Set<string>()
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    // Windows 的 Hyper-V 虚拟交换机名为 "vEthernet (Default Switch)" / "vEthernet (WSL ...)"，
    // 不含 "virtual"/"hyper-v"/"wsl" 等子串，须显式补充 vethernet/default switch。
    if (
      /loopback|virtual|vmware|vbox|hyper-v|vethernet|default[ _]?switch|docker|wsl|tun|tap|hostonly/i.test(
        name,
      )
    )
      continue
    for (const entry of entries ?? []) {
      // isPrivateIpv4Literal 内含 IPv4 字面量判定，无需再比对 family 字段。
      if (
        entry.internal ||
        entry.address.startsWith('169.254.') ||
        !isPrivateIpv4Literal(entry.address)
      )
        continue
      results.add(entry.address)
    }
  }
  return [...results]
}

/** Windows 控制台不是 UTF-8 时输出 ASCII 操作提示，不阻塞启动。 */
export function warnIfWindowsConsoleNotUtf8(): void {
  if (process.platform !== 'win32' || !process.stdout.isTTY) return
  try {
    const codePage = execSync('chcp', { encoding: 'utf8' }).match(/\d+/)?.[0]
    if (codePage && Number(codePage) !== 65001)
      console.log(
        `\n[info] Windows console code page is ${codePage} (not UTF-8): Chinese logs may be garbled.\n` +
          `  Please run "chcp 65001" (cmd) or set [Console]::OutputEncoding=UTF8 (PowerShell)\n` +
          `  before starting, or use Windows Terminal for UTF-8 by default.\n`,
      )
  } catch {
    // 非标准 shell 不提供 chcp 时静默跳过。
  }
}
