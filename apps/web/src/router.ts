import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { getIsMobileSync } from './composables/useDeviceMode';
import { useAuthStore } from './stores/auth';
import AdaptiveView from './views/AdaptiveView.vue';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: AdaptiveView,
    meta: {
      public: true,
      desktop: () => import('./views/LoginView.vue'),
      mobile: () => import('./views/mobile/MobileLoginView.vue'),
    },
  },
  {
    path: '/',
    name: 'lobby',
    component: AdaptiveView,
    meta: {
      desktop: () => import('./views/LobbyView.vue'),
      mobile: () => import('./views/mobile/MobileLobbyView.vue'),
    },
  },
  {
    path: '/boards',
    name: 'boards',
    component: AdaptiveView,
    meta: {
      desktop: () => import('./views/HomeView.vue'),
      mobile: () => import('./views/mobile/MobileBoardsView.vue'),
    },
  },
  {
    path: '/tiles',
    name: 'tiles',
    component: AdaptiveView,
    meta: {
      desktop: () => import('./views/TilesView.vue'),
      mobile: () => import('./views/mobile/MobileTilesView.vue'),
    },
  },
  {
    path: '/boards/:id',
    name: 'board-edit',
    component: AdaptiveView,
    meta: {
      desktop: () => import('./views/BoardEditorView.vue'),
      mobile: () => import('./views/mobile/MobileEditorBlockedView.vue'),
    },
  },
  {
    path: '/play/:boardId',
    name: 'play',
    component: AdaptiveView,
    meta: {
      desktop: () => import('./views/PlayView.vue'),
      mobile: () => import('./views/mobile/MobilePlayView.vue'),
    },
  },
  {
    path: '/room/:code',
    name: 'room',
    component: AdaptiveView,
    meta: {
      hideMobileTab: true,
      desktop: () => import('./views/RoomView.vue'),
      mobile: () => import('./views/mobile/MobileRoomView.vue'),
    },
  },
  {
    path: '/room/:code/display',
    name: 'room-display',
    component: () => import('./views/RoomDisplayView.vue'),
    meta: { display: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  // 移动端不含大屏：重定向到房间页
  if (to.name === 'room-display' && getIsMobileSync()) {
    return { name: 'room', params: { code: to.params.code } };
  }

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
