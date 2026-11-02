import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildGenMessages,
  excerptFound,
  genInputHash,
  listPrompts,
  matchPoints,
  parseGenDrafts,
  parsePoints,
  readPrompt,
  similarity,
} from '../../server/ai/workshop'
import { editStats, fisherExact, proportion, wilson } from '../../server/ai/stats'

describe('Prompt 版本文件', () => {
  it('内置 parse-v1 与 gen-v1，第一行是说明', () => {
    const list = listPrompts()
    expect(list.map((p) => `${p.kind}-${p.version}`)).toEqual(expect.arrayContaining(['parse-v1', 'gen-v1']))
    expect(list.every((p) => p.summary.length > 0)).toBe(true)
    expect(readPrompt('gen', 'v1').system).toContain('只输出 JSON')
  })
  it('按版本号数字排序；不存在或不合法的版本报错', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-'))
    for (const v of ['v10', 'v2', 'v1']) fs.writeFileSync(path.join(dir, `gen-${v}.md`), `# 说明 ${v}\n正文`)
    fs.writeFileSync(path.join(dir, 'notes.md'), '无关文件')
    expect(listPrompts(dir).map((p) => p.version)).toEqual(['v1', 'v2', 'v10'])
    expect(() => readPrompt('gen', 'v3', dir)).toThrow('不存在')
    expect(() => readPrompt('gen', '../secret', dir)).toThrow('不合法')
  })
})

describe('摘录与相似度', () => {
  const content = '用户名或密码错误时，停留在登录页，并在登录按钮下方显示红色提示“用户名或密码错误”。'
  it('忽略空白、标点与全半角差异', () => {
    expect(excerptFound(content, '停留在登录页 并在登录按钮下方显示红色提示"用户名或密码错误"')).toBe(true)
    expect(excerptFound(content, '密码错误三次后锁定账号')).toBe(false)
    expect(excerptFound(content, '   ')).toBe(false)
  })
  it('similarity：相同为 1，无关接近 0', () => {
    expect(similarity('密码错误时提示', '密码错误时提示')).toBe(1)
    expect(similarity('密码错误时提示错误信息', '密码错误时显示错误提示')).toBeGreaterThan(0.5)
    expect(similarity('密码错误时提示', '添加待办事项')).toBeLessThan(0.2)
  })
  it('matchPoints：一一对应，优先匹配最相似的，低于阈值不匹配', () => {
    const existing = [
      { id: 1, title: '正确账号登录后进入待办页' },
      { id: 2, title: '密码错误时提示用户名或密码错误' },
    ]
    const fresh = [{ title: '密码错误时提示“用户名或密码错误”' }, { title: '新增：退出登录' }, { title: '正确账号登录后进入我的待办页' }]
    expect([...matchPoints(fresh, existing).entries()].sort()).toEqual([
      [0, 2],
      [2, 1],
    ])
  })
})

describe('parsePoints', () => {
  it('规整优先级、去重、丢弃无标题的点', () => {
    const out = JSON.stringify({
      points: [
        { title: '登录成功进入待办页', priority: 'p0', excerpt: '账号正确时进入' },
        { title: '登录成功进入待办页', priority: 'P1' },
        { title: '', priority: 'P0' },
        { title: '统计显示', priority: 'P9', detail: '共 N 项' },
      ],
    })
    expect(parsePoints(out)).toEqual([
      { title: '登录成功进入待办页', detail: '', priority: 'P0', sourceExcerpt: '账号正确时进入' },
      { title: '统计显示', detail: '共 N 项', priority: 'P1', sourceExcerpt: '' },
    ])
  })
  it('一个有效点都没有时报错', () => {
    expect(() => parsePoints('{"points":[]}')).toThrow('没有解析出有效的需求点')
  })
})

describe('生成', () => {
  const codes = new Map([
    ['REQ-001', 11],
    ['REQ-002', 12],
  ])
  it('只保留自然语言步骤，需求点编号映射为 id，置信度截断到 0~1', () => {
    const out = JSON.stringify({
      cases: [
        {
          name: '登录成功',
          points: ['req-001', 'REQ-002', 'REQ-999', 'REQ-001'],
          confidence: 1.4,
          steps: [
            { type: 'action', content: '输入 demo / demo123 并点击登录' },
            { type: 'code', content: 'await page.click("#x")' },
            { type: 'ai_assert', content: '显示“欢迎你，demo”' },
          ],
        },
        { name: '没有需求点', points: ['REQ-999'], steps: [{ type: 'ai_assert', content: 'x' }] },
        { name: '置信度缺失', points: ['REQ-002'], steps: [{ type: 'ai_assert', content: 'y' }] },
      ],
    })
    const drafts = parseGenDrafts(out, '{{DEMO}}/index.html', codes)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toMatchObject({ pointIds: [11, 12], confidence: 1, steps: [{ type: 'ai_action' }, { type: 'ai_assert' }] })
    expect(drafts[1].confidence).toBeNull()
  })
  it('全部无效时报错', () => {
    expect(() => parseGenDrafts('{"cases":[{"name":"a","points":[],"steps":[{"type":"ai_assert","content":"b"}]}]}', 'u', codes)).toThrow('没有生成有效的用例')
  })
  it('消息里列出需求点与已有用例；输入指纹只随 Prompt 版本和需求点内容变化', () => {
    const pts = [{ code: 'REQ-001', title: '登录成功', detail: '', priority: 'P0' as const }]
    const [, user] = buildGenMessages('sys', { url: 'u', points: pts, existingCases: ['已有用例 A'] })
    expect(user.content).toContain('REQ-001【P0】登录成功')
    expect(user.content).toContain('- 已有用例 A')
    expect(genInputHash('v1', 'u', pts)).toBe(genInputHash('v1', 'u', [...pts]))
    expect(genInputHash('v1', 'u', pts)).not.toBe(genInputHash('v2', 'u', pts))
    expect(genInputHash('v1', 'u', pts)).not.toBe(genInputHash('v1', 'u', [{ ...pts[0], title: '登录失败' }]))
  })
})

describe('统计', () => {
  it('Wilson 区间与已知数值一致', () => {
    const [lo, hi] = wilson(18, 20)!
    expect(lo).toBeCloseTo(0.699, 3)
    expect(hi).toBeCloseTo(0.972, 3)
    expect(wilson(0, 10)![0]).toBe(0)
    expect(wilson(10, 10)![1]).toBe(1)
    expect(wilson(0, 0)).toBeNull()
    expect(proportion(0, 0)).toEqual({ k: 0, n: 0, rate: null, ci: null })
  })
  it('Fisher 精确检验与已知数值一致', () => {
    // 经典“女士品茶”：3/4 vs 1/4，双侧 p = 0.4857
    expect(fisherExact(3, 4, 1, 4)).toBeCloseTo(0.4857, 4)
    // 18/20 vs 10/20，双侧 p ≈ 0.0138
    expect(fisherExact(18, 20, 10, 20)).toBeCloseTo(0.0138, 3)
    expect(fisherExact(5, 10, 5, 10)).toBeCloseTo(1, 6)
    expect(fisherExact(1, 0, 1, 2)).toBeNull()
  })
  it('editStats：按步骤对齐统计增 / 删 / 改', () => {
    const s = (content: string, type: 'ai_action' | 'ai_assert' = 'ai_action') => ({ type, content })
    const before = { name: '登录', steps: [s('打开'), s('点击登录'), s('显示成功', 'ai_assert')] }
    expect(editStats(before, before)).toEqual({ kept: 3, changed: 0, added: 0, removed: 0, nameChanged: false })
    // 改了一步断言，并新增一步
    expect(editStats(before, { name: '登录成功', steps: [s('打开'), s('点击登录'), s('显示“欢迎你”', 'ai_assert'), s('点击退出')] })).toEqual({
      kept: 2,
      changed: 1,
      added: 1,
      removed: 0,
      nameChanged: true,
    })
    expect(editStats(before, { name: '登录', steps: [s('打开')] })).toMatchObject({ kept: 1, changed: 0, removed: 2 })
  })
})
