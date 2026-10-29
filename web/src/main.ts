import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import CaseList from './pages/CaseList.vue'
import CaseEdit from './pages/CaseEdit.vue'
import RunDetail from './pages/RunDetail.vue'
import Reports from './pages/Reports.vue'
import './style.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/cases' },
    { path: '/cases', component: CaseList, meta: { nav: 'cases' } },
    { path: '/cases/new', component: CaseEdit, meta: { nav: 'cases' } },
    { path: '/cases/:id/edit', component: CaseEdit, props: true, meta: { nav: 'cases' } },
    { path: '/reports', component: Reports, meta: { nav: 'reports' } },
    { path: '/runs/:id', component: RunDetail, props: true, meta: { nav: 'reports' } },
  ],
})

createApp(App).use(router).mount('#app')
