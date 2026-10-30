<script setup lang="ts">
// 轻量代码编辑器：CodeMirror 6，支持 JavaScript（Playwright 代码）与 YAML（接口步骤）高亮
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { placeholder as cmPlaceholder, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { yaml } from '@codemirror/lang-yaml'

const props = defineProps<{ lang: 'javascript' | 'yaml'; placeholder?: string; testId?: string; minLines?: number }>()
const model = defineModel<string>({ required: true })
const host = ref<HTMLDivElement>()
let view: EditorView | null = null

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', border: '1px solid var(--border-strong)', borderRadius: '7px', background: '#fbfcfe' },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--brand)', boxShadow: '0 0 0 3px var(--brand-ring)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '6px 0' },
  '.cm-gutters': { background: '#f4f6fa', borderRight: '1px solid var(--border)', color: '#9aa3b2', borderRadius: '7px 0 0 7px' },
  '.cm-activeLine': { background: 'rgba(29, 91, 216, .04)' },
  '.cm-activeLineGutter': { background: 'rgba(29, 91, 216, .06)' },
})

onMounted(() => {
  view = new EditorView({
    parent: host.value!,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        props.lang === 'yaml' ? yaml() : javascript({ typescript: true }),
        theme,
        EditorView.lineWrapping,
        cmPlaceholder(props.placeholder ?? ''),
        EditorView.contentAttributes.of(props.testId ? { 'data-test': props.testId } : {}),
        EditorView.theme({ '.cm-content, .cm-gutter': { minHeight: `${(props.minLines ?? 3) * 20 + 12}px` } }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) model.value = u.state.doc.toString()
        }),
      ],
    }),
  })
})
// 外部修改（如加载用例、切换类型）时同步到编辑器
watch(model, (v) => {
  if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } })
})
onBeforeUnmount(() => view?.destroy())
</script>

<template>
  <div ref="host" class="code-editor"></div>
</template>
