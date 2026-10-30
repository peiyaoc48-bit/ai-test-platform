// 变更注入：在页面脚本执行前注入，模拟“前端改版”，检验用例对界面变化的鲁棒性。
// 不修改被测系统的源码，只在测试浏览器里生效。思路来自毕设 6.7.3 的对比实验。

export type Mutation = 'none' | 'attr' | 'style'

export const MUTATIONS: Record<Exclude<Mutation, 'none'>, { label: string; script: string }> = {
  // 去掉常见的测试标记属性：依赖 data-test 的选择器会失效，模拟“前端重构时没保留测试标记”
  attr: {
    label: '去掉测试标记',
    script: `(() => {
      const ATTRS = ['data-test', 'data-testid', 'data-test-id', 'data-cy', 'data-qa']
      const strip = (root) => {
        for (const a of ATTRS) {
          if (root.removeAttribute && root.hasAttribute && root.hasAttribute(a)) root.removeAttribute(a)
          if (root.querySelectorAll) root.querySelectorAll('[' + a + ']').forEach((e) => e.removeAttribute(a))
        }
      }
      new MutationObserver((list) => list.forEach((m) => {
        if (m.type === 'attributes') strip(m.target)
        m.addedNodes && m.addedNodes.forEach(strip)
      })).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRS })
      document.addEventListener('DOMContentLoaded', () => strip(document))
    })()`,
  },
  // 换一套视觉样式：颜色、字号、圆角、间距都变，结构和文字不变，模拟“改版换皮”
  style: {
    label: '更换视觉样式',
    script: `(() => {
      const css = \`
        body { background: #fffdf5 !important; font-size: 15px !important; letter-spacing: .3px !important }
        button, .btn { border-radius: 14px !important; background: #f3efe2 !important; color: #3b3424 !important; border: 1px solid #c9b98a !important }
        input, select, textarea { border-radius: 10px !important; border-color: #c9b98a !important }
        header, nav { background: #5b4a2e !important }
        main, section, .card { border-radius: 0 !important; box-shadow: none !important; padding: 20px !important }
        h1, h2 { font-weight: 400 !important; color: #5b4a2e !important }\`
      const add = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s) }
      if (document.head) add(); else document.addEventListener('DOMContentLoaded', add)
    })()`,
  },
}

export const isMutation = (m: unknown): m is Mutation => m === 'none' || m === 'attr' || m === 'style'
