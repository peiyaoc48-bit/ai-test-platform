import crypto from 'node:crypto'

// 状态去重：状态 = URL 模板 + 可交互元素“结构”的指纹。
// 列表里多一条数据、名称里的数字变了，都不应该产生新状态，否则状态数会爆炸。

/** 路径里的数字段、长 id、uuid 换成占位符；查询参数只保留键名；去掉 hash */
export function urlPattern(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname
      .split('/')
      .map((seg) => (/^\d+$/.test(seg) ? ':id' : /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(seg) || /^[0-9a-zA-Z_-]{20,}$/.test(seg) ? ':id' : seg))
      .join('/')
    const keys = [...new Set([...u.searchParams.keys()])].sort()
    return `${u.host}${path}${keys.length ? `?${keys.join('&')}` : ''}`
  } catch {
    return url
  }
}

/** 名称归一化：去空白，连续数字换成 #，截断（待办内容、视频标题这类数据不会进入指纹的其他部分） */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().replace(/\d+/g, '#').slice(0, 40)
}

export interface ScannedElement {
  role: string
  name: string
  tag: string
  /** 首选 data-test / id，其次 CSS 路径 */
  selector: string
  /** 所在区域（header / nav / main / dialog …） */
  region: string
  /** 属于重复结构（列表项）时的结构签名；同一签名只保留第一个 */
  repeatSig?: string
  inputType?: string
  disabled?: boolean
  href?: string
  danger: 'keyword' | 'logout' | null
}

/** 元素的稳定键：role + 归一化名称 + 区域；重复结构里的元素忽略名称 */
export function elementKey(e: Pick<ScannedElement, 'role' | 'name' | 'region' | 'repeatSig'>): string {
  return e.repeatSig ? `${e.role}|*${e.repeatSig}|${e.region}` : `${e.role}|${normalizeName(e.name)}|${e.region}`
}

/** 去重：同一个键只保留第一个（导航栏的同名链接、列表里重复的按钮） */
export function dedupe<T extends ScannedElement>(list: T[]): (T & { key: string; count: number })[] {
  const map = new Map<string, T & { key: string; count: number }>()
  for (const e of list) {
    const key = elementKey(e)
    const hit = map.get(key)
    if (hit) hit.count++
    else map.set(key, { ...e, key, count: 1 })
  }
  return [...map.values()]
}

export function fingerprint(url: string, elements: ScannedElement[]): string {
  const keys = [...new Set(elements.map(elementKey))].sort()
  return crypto.createHash('sha1').update(`${urlPattern(url)}\n${keys.join('\n')}`).digest('hex').slice(0, 16)
}
