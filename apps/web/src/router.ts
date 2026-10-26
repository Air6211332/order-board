import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'lobby',
      component: () => import('./views/LobbyView.vue'),
    },
    {
      path: '/boards',
      name: 'boards',
      component: () => import('./views/HomeView.vue'),
    },
    {
      path: '/tiles',
      name: 'tiles',
      component: () => import('./views/TilesView.vue'),
    },
    {
      path: '/boards/:id',
      name: 'board-edit',
      component: () => import('./views/BoardEditorView.vue'),
    },
    {
      path: '/play/:boardId',
      name: 'play',
      component: () => import('./views/PlayView.vue'),
    },
    {
      path: '/room/:code',
      name: 'room',
      component: () => import('./views/RoomView.vue'),
    },
    {
      path: '/room/:code/display',
      name: 'room-display',
      component: () => import('./views/RoomDisplayView.vue'),
      meta: { display: true },
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.bootstrap();
  if (to.meta.public) {
    if (auth.user && !auth.user.isTemp && to.name === 'login') return { name: 'lobby' };
    return true;
  }
  if (!auth.user) {
    await auth.bootstrap();
    if (!auth.user) return { name: 'login', query: { redirect: to.fullPath } };
  }
  return true;
});
