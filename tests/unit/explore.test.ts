// 探索器的安全边界与状态去重：真实浏览器 + 本地夹具站点（计数器记录服务端收到了什么）
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { explore } from '../../server/explore/explorer'
import { dangerReason, redactUrl, requestVerdict } from '../../server/explore/safety'
import { dedupe, elementKey, fingerprint, urlPattern, type ScannedElement } from '../../server/explore/state'

describe('危险关键词', () => {
  it('中英文危险动作与退出登录被识别，普通名称不会', () => {
    for (const t of ['删除账号', '立即支付', '提交订单', '修改密码', 'Delete item', 'btn-checkout', '重置']) expect(dangerReason(t), t).toBe('keyword')
    for (const t of ['退出登录', 'Log out', 'sign-out']) expect(dangerReason(t), t).toBe('logout')
    for (const t of ['继续', '添加', '查看详情', '搜索', 'Next', 'Save']) expect(dangerReason(t), t).toBeNull()
  })
})

describe('请求拦截判定', () => {
  const policy = { allowedHosts: ['127.0.0.1:3100'], allowWrite: ['POST /api/login'] }
  it('白名单外的主机、非 http 协议被拦截；GET 放行；写请求默认拦截，白名单内的接口放行', () => {
    expect(requestVerdict('http://127.0.0.1:3100/a', 'GET', policy)).toBeNull()
    expect(requestVerdict('http://evil.test/a', 'GET', policy)).toBe('host')
    expect(requestVerdict('http://127.0.0.1:3101/a', 'GET', policy)).toBe('host')
    expect(requestVerdict('ftp://127.0.0.1:3100/a', 'GET', policy)).toBe('host')
    expect(requestVerdict('http://127.0.0.1:3100/api/x', 'POST', policy)).toBe('write')
    expect(requestVerdict('http://127.0.0.1:3100/api/x', 'delete', policy)).toBe('write')
    expect(requestVerdict('http://127.0.0.1:3100/api/login', 'POST', policy)).toBeNull()
    expect(requestVerdict('http://127.0.0.1:3100/api/x', 'POST', policy, { setup: true })).toBeNull()
    expect(requestVerdict('http://evil.test/a', 'GET', policy, { setup: true })).toBe('host')
    expect(requestVerdict('data:text/plain,hi', 'GET', policy)).toBeNull()
  })
  it('记录被拦截的地址时不保留查询参数的值', () => {
    expect(redactUrl('http://a.test/x?token=secret&id=1')).toBe('http://a.test/x?token&id')
  })
})

describe('状态指纹', () => {
  const el = (name: string, extra: Partial<ScannedElement> = {}): ScannedElement => ({ role: 'button', name, tag: 'button', selector: 'b', region: 'main', danger: null, ...extra })
  it('URL 模板化：数字段、长 id 换成占位符，查询参数只留键名', () => {
    expect(urlPattern('http://a.test/videos/123?page=2&q=x#top')).toBe('a.test/videos/:id?page&q')
    expect(urlPattern('http://a.test/u/550e8400-e29b-41d4-a716-446655440000')).toBe('a.test/u/:id')
  })
  it('名称里的数字、列表项数量变化不改变指纹；出现新控件才改变', () => {
    const row = (n: number) => el(`第 ${n} 条`, { repeatSig: 'li.item>button' })
    const a = fingerprint('http://a.test/list', [el('添加'), row(1), row(2)])
    const b = fingerprint('http://a.test/list', [el('添加'), row(1), row(2), row(3), row(4)])
    expect(b).toBe(a)
    expect(fingerprint('http://a.test/list', [el('添加'), el('清除已完成'), row(1)])).not.toBe(a)
    expect(elementKey(el('共 12 项'))).toBe(elementKey(el('共 99 项')))
  })
  it('同键元素合并并计数', () => {
    const d = dedupe([el('首页', { role: 'link', region: 'nav' }), el('首页', { role: 'link', region: 'nav' }), el('首页', { role: 'link', region: 'main' })])
    expect(d.map((x) => x.count)).toEqual([2, 1])
  })
})

// —— 夹具站点 ——
const hits = { danger: [] as string[], writes: [] as string[], external: 0, reads: [] as string[] }
let site: http.Server
let external: http.Server
let browser: Browser
let base = ''

const listPage = (n: number) => `<!doctype html><title>列表</title><nav><a href="/">首页</a></nav>
<ul>${Array.from({ length: n }, (_, i) => `<li class="item"><span>条目 ${i + 1}</span> <button class="view">查看</button></li>`).join('')}</ul>
<button id="more">加载更多</button>
<script>document.getElementById('more').onclick = () => { const li = document.createElement('li'); li.className = 'item'; li.innerHTML = '<span>新条目</span> <button class="view">查看</button>'; document.querySelector('ul').appendChild(li) }</script>`

beforeAll(async () => {
  external = http.createServer((_req, res) => {
    hits.external++
    res.end('external')
  })
  await new Promise<void>((r) => external.listen(0, '127.0.0.1', r))
  const extPort = (external.address() as AddressInfo).port
  const post = (url: string, tag: string) => `fetch('${url}', { method: 'POST' }).then(() => { document.getElementById('msg').textContent = '${tag}' })`
  site = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    if (req.method !== 'GET') {
      ;(url.pathname.startsWith('/api/danger') ? hits.danger : hits.writes).push(`${req.method} ${url.pathname}`)
      return res.end('ok')
    }
    hits.reads.push(url.pathname)
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (url.pathname === '/list') return res.end(listPage(Number(url.searchParams.get('n') ?? 3)))
    res.end(`<!doctype html><title>首页</title>
<header><nav><a href="/">首页</a> <a href="/list?n=${hitsN}">列表</a></nav></header>
<main>
  <button onclick="${post('/api/danger?x=delete', 'deleted')}">删除账号</button>
  <button onclick="${post('/api/danger?x=pay', 'paid')}">立即支付</button>
  <button onclick="${post('/api/danger?x=logout', 'out')}">退出登录</button>
  <button id="innocent" onclick="${post('/api/save', 'saved')}">继续</button>
  <a href="http://127.0.0.1:${extPort}/">外部链接</a>
  <p id="msg"></p>
</main>`)
  })
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL === undefined ? 'chrome' : process.env.BROWSER_CHANNEL || undefined })
})

let hitsN = 3

afterAll(async () => {
  await browser?.close()
  site?.close()
  external?.close()
})

describe('探索器（夹具站点）', () => {
  it('危险按钮没被点击、名字普通的写请求发不出去、白名单外的地址一次都没访问', async () => {
    Object.assign(hits, { danger: [], writes: [], external: 0, reads: [] })
    const r = await explore(browser, { baseUrl: `${base}/`, delayMs: 50 })

    // 识别层：三个危险控件被记录但没有点
    const byName = (n: string) => r.elements.find((e) => e.name === n)!
    expect([byName('删除账号').danger, byName('立即支付').danger, byName('退出登录').danger]).toEqual(['keyword', 'keyword', 'logout'])
    expect(['删除账号', '立即支付', '退出登录'].map((n) => byName(n).clicked)).toEqual([false, false, false])
    expect(hits.danger).toEqual([])

    // 拦截层：“继续”名字普通，确实被点了，但它的 POST 没到达服务端，并被记录为被拦截的写请求
    expect(byName('继续').clicked).toBe(true)
    expect(hits.writes).toEqual([])
    expect(r.blocked.filter((b) => b.reason === 'write').map((b) => `${b.method} ${new URL(b.url).pathname}`)).toContain('POST /api/save')
    expect(r.transitions.some((t) => t.effect === 'blocked_write')).toBe(true)

    // 白名单外：外链被点击过，但外部服务器一次都没收到请求
    expect(byName('外部链接').clicked).toBe(true)
    expect(hits.external).toBe(0)
    expect(r.blocked.some((b) => b.reason === 'host')).toBe(true)

    // 能走到列表页
    expect(r.states.map((s) => s.urlPattern.replace(/^[^/]+/, ''))).toContain('/list?n')
    expect(r.stopReason).toBe('complete')
  }, 120_000)

  it('对照：显式放行该接口后，POST 才会到达服务端（说明上面的断言不是空转）', async () => {
    Object.assign(hits, { danger: [], writes: [], external: 0, reads: [] })
    await explore(browser, { baseUrl: `${base}/`, delayMs: 50, allowWrite: ['POST /api/save'], maxClicks: 12 })
    expect(hits.writes).toContain('POST /api/save')
    expect(hits.danger).toEqual([]) // 危险按钮即使放开写白名单也不会被点
  }, 120_000)

  it('列表数据多几条，状态数不变', async () => {
    const count = async (n: number) => {
      hitsN = n
      return (await explore(browser, { baseUrl: `${base}/`, delayMs: 50 })).states.length
    }
    const small = await count(3)
    const large = await count(9)
    hitsN = 3
    expect(large).toBe(small)
  }, 180_000)

  it('受点击次数上限约束，到上限就停', async () => {
    const r = await explore(browser, { baseUrl: `${base}/`, delayMs: 20, maxClicks: 2 })
    expect(r.clicks).toBe(2)
    expect(r.stopReason).toBe('max_clicks')
  }, 120_000)
})
