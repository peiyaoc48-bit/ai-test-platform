import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import CaseList from './pages/CaseList.vue'
import CaseEdit from './pages/CaseEdit.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/cases' },
    { path: '/cases', component: CaseList, meta: { nav: 'cases' } },
    { path: '/cases/new', component: CaseEdit, meta: { nav: 'cases' } },
    { path: '/cases/:id/edit', component: CaseEdit, props: true, meta: { nav: 'cases' } },
  ],
})

createApp(App).use(router).mount('#app')
