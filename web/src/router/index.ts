import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import HistoryView from '../views/HistoryView.vue'
import SettingsView from '../views/SettingsView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { tab: '创作' } },
    {
      path: '/history',
      name: 'history',
      component: HistoryView,
      meta: { tab: '历史' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
      meta: { tab: '设置' },
    },
  ],
})
