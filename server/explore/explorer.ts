import type { Browser, BrowserContext, Page } from 'playwright'
import { redactUrl, requestVerdict, dangerReason, type BlockReason, type DangerReason, type UrlPolicy } from './safety.js'
import { dedupe, fingerprint, urlPattern, type ScannedElement } from './state.js'

// 探索器（M1）：只采集，不调用模型。
// 广度优先遍历：每个状态都从起点重放动作路径回到（Crawljax 的做法），不依赖浏览器后退；
// 重放后指纹对不上的状态记为“不可复现”，不再往下探索。

export type SetupStep = { type: 'fill'; selector: string; value: string } | { type: 'click'; selector: string }

export interface ExploreConfig {
  baseUrl: string
  /** 允许访问的主机，默认只有 baseUrl 的主机 */
  allowedHosts?: string[]
  /** 允许发出的写请求，格式 "POST /api/login"；默认一律拦截 */
  allowWrite?: string[]
  /** 预置登录等准备动作，每次回到起点都会重放；其中的值不会写进探索记录 */
  setup?: SetupStep[]
  maxStates?: number
  maxClicks?: number
  maxDepth?: number
  /** 每次动作后的等待（毫秒），控制请求频率 */
  delayMs?: number
}

export interface Action {
  kind: 'click' | 'fill'
  selector: string
  key: string
}

export interface ExploredState {
  idx: number
  urlPattern: string
  fingerprint: string
  title: string
  depth: number
  reproducible: boolean
  path: Action[]
}

export interface ExploredElement {
  key: string
  role: string
  name: string
  selector: string
  tag: string
  inputType: string | null
  danger: DangerReason | null
  /** 是否真的点击 / 填写过；危险控件只记录，clicked 恒为 false */
  clicked: boolean
}

export type Effect = 'navigated' | 'dom_changed' | 'no_change' | 'blocked_write' | 'blocked_host' | 'not_found'

export interface ExploredTransition {
  from: number
  elementKey: string
  action: 'click' | 'fill'
  to: number
  effect: Effect
}

export interface BlockedRequest {
  state: number
  url: string
  method: string
  reason: BlockReason
}

export interface ExploreResult {
  stopReason: 'complete' | 'max_states' | 'max_clicks'
  states: ExploredState[]
  elements: ExploredElement[]
  /** 元素出现在哪些状态：elementKey → [{ state, count }]（count 为合并掉的同类元素个数） */
  occurrences: { elementKey: string; state: number; count: number }[]
  transitions: ExploredTransition[]
  blocked: BlockedRequest[]
  clicks: number
}

export const EXPLORE_DEFAULTS = { maxStates: 30, maxClicks: 120, maxDepth: 4, delayMs: 200 }
export const FILL_TEXT = '探索测试001'

const SCAN = `(() => {
  const SEL = 'a[href], button, input, select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=menuitem], [onclick], [tabindex]:not([tabindex="-1"])'
  const visible = (el) => {
    if (!el.getClientRects().length) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none'
  }
  const roleOf = (el) => {
    const r = el.getAttribute('role')
    if (r) return r
    const t = el.tagName.toLowerCase()
    if (t === 'a') return 'link'
    if (t === 'button' || t === 'summary') return 'button'
    if (t === 'select') return 'combobox'
    if (t === 'textarea') return 'textbox'
    if (t === 'input') {
      const ty = (el.getAttribute('type') || 'text').toLowerCase()
      if (ty === 'checkbox' || ty === 'radio') return ty
      if (ty === 'submit' || ty === 'button' || ty === 'reset' || ty === 'image') return 'button'
      return 'textbox'
    }
    return 'generic'
  }
  const text = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
  const nameOf = (el) => {
    const aria = el.getAttribute('aria-label')
    if (aria) return aria.trim()
    const by = el.getAttribute('aria-labelledby')
    if (by) { const n = by.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(text).join(' ').trim(); if (n) return n }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && text(l)) return text(l) }
    const wrap = el.closest('label'); if (wrap && text(wrap)) return text(wrap)
    const tag = el.tagName.toLowerCase()
    if (tag === 'input' && ['submit', 'button', 'reset'].includes((el.getAttribute('type') || '').toLowerCase())) return el.value || ''
    if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') { const t = text(el); if (t) return t.slice(0, 80) }
    const img = el.querySelector('img[alt]'); if (img && img.alt) return img.alt
    return (el.getAttribute('title') || el.getAttribute('placeholder') || '').trim()
  }
  const selectorOf = (el) => {
    for (const a of ['data-test', 'data-testid', 'data-cy']) { const v = el.getAttribute(a); if (v) return '[' + a + '="' + v.replace(/"/g, '\\\\"') + '"]' }
    if (el.id && !/\\d{3,}/.test(el.id)) return '#' + CSS.escape(el.id)
    const parts = []
    let cur = el
    for (let i = 0; cur && cur.nodeType === 1 && cur !== document.body && i < 7; i++) {
      if (cur.id && !/\\d{3,}/.test(cur.id)) { parts.unshift('#' + CSS.escape(cur.id)); break }
      const sibs = cur.parentElement ? [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName) : []
      parts.unshift(cur.tagName.toLowerCase() + (sibs.length > 1 ? ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')' : ''))
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }
  const regionOf = (el) => {
    const r = el.closest('header, nav, aside, footer, dialog, [role=dialog], [role=navigation], main')
    return r ? (r.getAttribute('role') || r.tagName.toLowerCase()) : 'page'
  }
  const repeatSig = (el) => {
    const anc = el.closest('li, tr, article, [role=listitem], [role=row]')
    if (!anc || !anc.parentElement) return undefined
    // 只看标签：勾选、完成等状态会改 class，不能把它当作结构的一部分
    const same = [...anc.parentElement.children].filter((c) => c.tagName === anc.tagName)
    if (same.length < 2) return undefined
    return anc.tagName.toLowerCase() + (anc.getAttribute('data-test') || '') + '>' + el.tagName.toLowerCase() + (el.getAttribute('type') || '') + (el.getAttribute('data-test') || '')
  }
  const out = []
  const seen = new Set()
  for (const el of document.querySelectorAll(SEL)) {
    if (seen.has(el)) continue
    seen.add(el)
    if (!visible(el) || (el.tagName === 'INPUT' && el.type === 'hidden')) continue
    const name = nameOf(el)
    const href = el.tagName === 'A' ? el.getAttribute('href') || '' : ''
    out.push({
      role: roleOf(el), name, tag: el.tagName.toLowerCase(), selector: selectorOf(el), region: regionOf(el), repeatSig: repeatSig(el),
      inputType: el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : undefined,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', href,
      hint: [name, el.getAttribute('aria-label'), el.getAttribute('title'), el.id, el.className && String(el.className), el.getAttribute('data-test'), href].filter(Boolean).join(' '),
    })
  }
  return out
})()`

type RawElement = Omit<ScannedElement, 'danger'> & { hint: string }

async function scan(page: Page): Promise<ScannedElement[]> {
  const raw = (await page.evaluate(SCAN)) as RawElement[]
  return raw.map(({ hint, ...e }) => ({ ...e, danger: dangerReason(hint) }))
}

const skippableLink = (e: ScannedElement) => !!e.href && /^(mailto:|tel:|javascript:|#?$)/i.test(e.href.trim())
const fillable = (e: ScannedElement) =>
  e.role === 'textbox' && !['password', 'file', 'hidden'].includes(e.inputType ?? '') && ['input', 'textarea'].includes(e.tag)

export async function explore(browser: Browser, cfg: ExploreConfig): Promise<ExploreResult> {
  const c = { ...EXPLORE_DEFAULTS, ...cfg }
  const base = new URL(cfg.baseUrl)
  const policy: UrlPolicy = { allowedHosts: cfg.allowedHosts?.length ? cfg.allowedHosts : [base.host], allowWrite: cfg.allowWrite ?? [] }

  const states: ExploredState[] = []
  const elements = new Map<string, ExploredElement>()
  const occurrences: ExploreResult['occurrences'] = []
  const transitions: ExploredTransition[] = []
  const blocked: BlockedRequest[] = []
  let clicks = 0
  let stopReason: ExploreResult['stopReason'] = 'complete'
  let current = 0 // 正在探索的状态，用于给被拦截的请求归属

  let context = null as BrowserContext | null
  let page!: Page
  let inSetup = false

  const open = async () => {
    await context?.close()
    context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } })
    await context.route('**/*', (route) => {
      const req = route.request()
      const why = requestVerdict(req.url(), req.method(), policy, { setup: inSetup })
      if (!why) return route.continue()
      blocked.push({ state: current, url: redactUrl(req.url()), method: req.method(), reason: why })
      return route.abort('blockedbyclient')
    })
    page = await context.newPage()
    // 新开的标签页和对话框一律关掉 / 取消，避免跳到白名单外或确认危险操作
    context.on('page', (p) => {
      if (p !== page) void p.close().catch(() => {})
    })
    page.on('dialog', (d) => void d.dismiss().catch(() => {}))
  }

  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {})
    await page.waitForTimeout(c.delayMs)
  }

  const perform = async (a: Action) => {
    const loc = page.locator(a.selector).first()
    if (a.kind === 'fill') await loc.fill(FILL_TEXT, { timeout: 3000 })
    else await loc.click({ timeout: 3000 })
    await settle()
  }

  const snapshot = async () => {
    const list = await scan(page)
    return { list, fp: fingerprint(page.url(), list) }
  }

  /** 回到起点（含预置登录）并重放路径，返回当前指纹 */
  const restore = async (path: Action[]) => {
    await open()
    inSetup = true
    await page.goto(cfg.baseUrl, { waitUntil: 'load', timeout: 15_000 })
    for (const s of cfg.setup ?? []) {
      const loc = page.locator(s.selector).first()
      if (s.type === 'fill') await loc.fill(s.value, { timeout: 3000 })
      else await loc.click({ timeout: 3000 })
      await settle()
    }
    inSetup = false
    for (const a of path) await perform(a)
    return (await snapshot()).fp
  }

  const record = async (idx: number, list: ScannedElement[]) => {
    for (const e of dedupe(list)) {
      if (!elements.has(e.key))
        elements.set(e.key, { key: e.key, role: e.role, name: e.name, selector: e.selector, tag: e.tag, inputType: e.inputType ?? null, danger: e.danger, clicked: false })
      occurrences.push({ elementKey: e.key, state: idx, count: e.count })
    }
  }

  const addState = async (fp: string, depth: number, path: Action[], list: ScannedElement[]) => {
    const st: ExploredState = { idx: states.length, urlPattern: urlPattern(page.url()), fingerprint: fp, title: (await page.title().catch(() => '')).slice(0, 100), depth, reproducible: true, path }
    states.push(st)
    await record(st.idx, list)
    return st
  }

  try {
    const fp0 = await restore([])
    const first = await snapshot()
    await addState(fp0, 0, [], first.list)

    const queue = [0]
    outer: while (queue.length) {
      const st = states[queue.shift()!]
      current = st.idx
      if (st.depth >= c.maxDepth) continue
      let fp: string
      try {
        fp = await restore(st.path)
      } catch {
        st.reproducible = false
        continue
      }
      if (fp !== st.fingerprint) {
        st.reproducible = false
        continue
      }

      const { list } = await snapshot()
      const candidates = dedupe(list).filter((e) => !e.disabled && !skippableLink(e))
      let dirty = false
      for (const e of candidates) {
        // 危险控件只记录，不点击
        if (e.danger) continue
        const kind: Action['kind'] | null = fillable(e) ? 'fill' : ['textbox', 'combobox'].includes(e.role) ? null : 'click'
        if (!kind) continue
        if (clicks >= c.maxClicks) {
          stopReason = 'max_clicks'
          break outer
        }
        if (dirty) {
          try {
            if ((await restore(st.path)) !== st.fingerprint) {
              st.reproducible = false
              break
            }
          } catch {
            st.reproducible = false
            break
          }
          dirty = false
        }
        const action: Action = { kind, selector: e.selector, key: e.key }
        const blockedBefore = blocked.length
        clicks++
        elements.get(e.key)!.clicked = true
        let effect: Effect
        let toIdx = st.idx
        try {
          await perform(action)
        } catch {
          transitions.push({ from: st.idx, elementKey: e.key, action: kind, to: st.idx, effect: 'not_found' })
          dirty = true
          continue
        }
        const now = await snapshot()
        const newBlocked = blocked.slice(blockedBefore)
        const leftSite = page.url().startsWith('chrome-error:') || !policy.allowedHosts.includes(new URL(page.url().startsWith('http') ? page.url() : cfg.baseUrl).host)
        if (leftSite) {
          effect = 'blocked_host'
          dirty = true
        } else {
          if (now.fp === st.fingerprint) effect = 'no_change'
          else {
            effect = urlPattern(page.url()) !== st.urlPattern ? 'navigated' : 'dom_changed'
            dirty = true
            const known = states.find((s) => s.fingerprint === now.fp)
            if (known) toIdx = known.idx
            else if (states.length >= c.maxStates) stopReason = 'max_states'
            else {
              const ns = await addState(now.fp, st.depth + 1, [...st.path, action], now.list)
              toIdx = ns.idx
              queue.push(ns.idx)
            }
          }
          if (newBlocked.some((b) => b.reason === 'write') && effect === 'no_change') effect = 'blocked_write'
          else if (newBlocked.some((b) => b.reason === 'host')) effect = 'blocked_host'
        }
        transitions.push({ from: st.idx, elementKey: e.key, action: kind, to: toIdx, effect })
      }
    }
  } finally {
    await context?.close().catch(() => {})
  }

  return { stopReason, states, elements: [...elements.values()], occurrences, transitions, blocked, clicks }
}
