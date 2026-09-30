/**
 * 本机自己的名字（浏览器来源放行面的输入之一，见 docs/adr/0037-allow-local-hostname-origin.md）。
 *
 * 局域网玩家习惯用「计算机名」访问（`http://my-pc:5174`，macOS/Linux 上更常见的是
 * `<名字>.local` 这种 mDNS 形态）。这些**域名形态**此前一律被来源判定拒绝，表现却是
 * 「页面能打开（静态资源不受来源限制）、Socket 一直连不上」，很容易被误判成防火墙问题。
 * 本模块只负责枚举「本机自己叫什么」，是否放行由 `app.ts` 的来源判定按这份名单决定
 *（放行面的安全论证见上述 ADR）。
 *
 * 与 `lan-addresses.ts` 同样的分工：本模块是 OS 事实的读取层（不可单测的部分只有
 * `hostname()` 一行），派生逻辑写成纯函数 `localHostnameCandidates` 供单测直接驱动。
 */
import { hostname } from 'node:os'

/** mDNS/Bonjour 形态的后缀：macOS、Linux（avahi）与 Windows 10+ 都以 `<名字>.local` 响应广播解析。 */
const MDNS_SUFFIX = '.local'

/**
 * 由一个「操作系统报告的主机名」推出应放行的名字候选（纯函数，大小写不在这里归一——
 * 比对时统一小写，见 `isAllowedOrigin`）。
 *
 * - 原样名字 + 其 `.local` 形态；
 * - 报告值是 FQDN（如 `mbp.example.com`，Linux/macOS 都可能如此）时，再补**首个标签**（`mbp`）
 *   及其 `.local` 形态：短名是同一台机器的另一种写法，用户实际输入的往往是它；
 * - 已经以 `.local` 结尾时不重复追加后缀。
 *
 * 刻意只做这两三种形态，不去猜域后缀或解析别名：放行面只认「名字等于本机名」，
 * 多猜一种写法就多开一扇门（拿不准时让玩家改用 IP，启动横幅本来就播报 IP）。
 */
export function localHostnameCandidates(reportedName: string): string[] {
  // FQDN 的根点（`mbp.example.com.`）等价于无点写法：先去掉尾部所有点，否则派生出的 `.local`
  // 会变成 `….local.`、`..local` 这类连解析都无从谈起的名字。
  const name = reportedName.trim().replace(/\.+$/u, '')
  if (!name) return []
  const withMdns = (value: string) =>
    value.toLowerCase().endsWith(MDNS_SUFFIX) ? [value] : [value, `${value}${MDNS_SUFFIX}`]
  const firstLabel = name.split('.')[0] ?? ''
  const forms = [name]
  // 只有「确实有多段」且首段非空时才补短名：无点写法下首段等于原名，以点开头的退化写法首段为空。
  if (firstLabel && firstLabel !== name) forms.push(firstLabel)
  return [...new Set(forms.flatMap(withMdns))]
}

/** 本机名字候选（含 `.local` 形态）：启动装配取一次，注入来源判定。 */
export function findLocalHostnames(): string[] {
  return localHostnameCandidates(hostname())
}
