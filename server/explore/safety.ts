// 探索模式的安全边界。分两层，第二层不依赖“认出危险按钮”是否准确：
// 1. 识别层：名称命中危险关键词的控件只记录、不点击（dangerReason）
// 2. 拦截层：浏览器里的所有请求先过 requestVerdict——白名单外的域名一律取消，非 GET 请求默认取消
// 即使某个名字普通的按钮其实会写数据，点下去也发不出请求。

export type DangerReason = 'keyword' | 'logout'

/** 危险动作关键词（中英文）。命中控件的名称、aria-label、title、id、class、data-test 或链接地址即视为危险 */
const DANGER = [
  /删除|移除|清空|销毁|注销|作废|撤销|取消订单|退款|解绑/,
  /支付|付款|购买|下单|结算|提交订单|充值|转账|提现|立即开通|确认订单/,
  /修改密码|重置|找回密码|更换手机|绑定/,
  /\b(delete|remove|destroy|drop|purge|clear[-_ ]?all|pay|payment|purchase|checkout|buy|order|submit[-_ ]?order|transfer|withdraw|reset|unbind|deactivate)\b/i,
]
const LOGOUT = /退出|登出|注销登录|\b(log[-_ ]?out|sign[-_ ]?out)\b/i

export function dangerReason(text: string): DangerReason | null {
  if (LOGOUT.test(text)) return 'logout'
  if (DANGER.some((re) => re.test(text))) return 'keyword'
  return null
}

export interface UrlPolicy {
  /** 允许访问的主机（含端口），例如 127.0.0.1:3100 */
  allowedHosts: string[]
  /** 允许发出的写请求：“METHOD 路径前缀”，例如 "POST /api/login"；默认空，即一律不允许 */
  allowWrite: string[]
}

export type BlockReason = 'host' | 'write'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** 判断一个请求能否放行；不能放行时返回原因。setup 阶段（预置登录）允许对白名单主机发写请求 */
export function requestVerdict(url: string, method: string, policy: UrlPolicy, opts: { setup?: boolean } = {}): BlockReason | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'host'
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return null
  if (!['http:', 'https:'].includes(u.protocol) || !policy.allowedHosts.includes(u.host)) return 'host'
  const m = method.toUpperCase()
  if (SAFE_METHODS.has(m) || opts.setup) return null
  const allowed = policy.allowWrite.some((rule) => {
    const [rm, ...rest] = rule.split(/\s+/)
    return rm.toUpperCase() === m && u.pathname.startsWith(rest.join(' '))
  })
  return allowed ? null : 'write'
}

/** 记录被拦截的请求时只保留路径和查询参数名，不记录参数值（可能含 token） */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url)
    const keys = [...new Set([...u.searchParams.keys()])]
    return `${u.origin}${u.pathname}${keys.length ? `?${keys.join('&')}` : ''}`
  } catch {
    return '(无法解析的地址)'
  }
}
