import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

export const router = createRouter({
  history: createWebHistory('/ui/'),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('../pages/Login.vue'),
      meta: { layout: 'auth' },
    },
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: () => import('../pages/Dashboard.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/accounts',
      name: 'Accounts',
      component: () => import('../pages/Accounts.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/keys',
      name: 'Keys',
      component: () => import('../pages/Keys.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/key-detail',
      name: 'KeyDetail',
      component: () => import('../pages/KeyDetail.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/users',
      name: 'Users',
      component: () => import('../pages/Users.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/logs',
      name: 'Logs',
      component: () => import('../pages/Logs.vue'),
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/dashboard',
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.checked) {
    await auth.checkAuth()
  }

  if (to.meta.requiresAuth && !auth.user) {
    return { name: 'Login' }
  }

  if (to.meta.requiresAdmin && auth.user?.role !== 'admin') {
    return { name: 'KeyDetail' }
  }

  if (to.name === 'Login' && auth.user) {
    return auth.user.role === 'admin' ? { name: 'Dashboard' } : { name: 'KeyDetail' }
  }
})

export default router
