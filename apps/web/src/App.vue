<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDeviceModeRoot } from './composables/useDeviceMode';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const { isMobile } = useDeviceModeRoot();

/** 登录页与大屏页不显示顶栏 */
const showNav = computed(() => route.name !== 'login' && !route.meta.display);

/** 房间等页隐藏底栏 */
const showMobileTab = computed(
  () =>
    isMobile.value &&
    showNav.value &&
    Boolean(auth.user) &&
    !route.meta.hideMobileTab &&
    !route.meta.display,
);

const layoutFill = computed(
  () =>
    route.name === 'board-edit' ||
    Boolean(route.meta.display) ||
    (isMobile.value && route.name === 'room'),
);

async function onLogout() {
  await auth.logout();
  await router.push({ name: 'lobby' });
}
</script>

<template>
  <div
    class="layout"
    :class="{
      'layout-fill': layoutFill,
      'layout-mobile': isMobile && showNav && auth.user,
      'layout-mobile-tab': showMobileTab,
    }"
  >
    <header v-if="showNav && auth.user && !isMobile" class="nav">
      <div>
        <strong>令棋</strong>
        <span class="muted"> · Order Board</span>
        <div class="nav-disclaimer muted">版本未稳定，数据随时可能重置。</div>
      </div>
      <nav class="nav-links">
        <RouterLink to="/" :class="{ active: route.name === 'lobby' }">大厅</RouterLink>
        <RouterLink
          to="/boards"
          :class="{ active: route.name === 'boards' || route.name === 'board-edit' }"
        >
          棋盘
        </RouterLink>
        <RouterLink to="/tiles" :class="{ active: route.name === 'tiles' }">指令库</RouterLink>
        <span class="muted">
          {{ auth.user.username }}
          <template v-if="auth.user.isTemp">（游客）</template>
        </span>
        <RouterLink v-if="auth.user.isTemp" to="/login">登录/注册</RouterLink>
        <button type="button" @click="onLogout">退出</button>
      </nav>
    </header>

    <header v-if="showNav && auth.user && isMobile" class="mobile-topbar">
      <div class="mobile-topbar-title">
        <strong>令棋</strong>
        <span class="muted mobile-topbar-user">
          {{ auth.user.username }}
          <template v-if="auth.user.isTemp">（游客）</template>
        </span>
      </div>
      <div class="mobile-topbar-actions">
        <RouterLink v-if="auth.user.isTemp" to="/login" class="mobile-link">登录</RouterLink>
        <button type="button" class="mobile-topbar-btn" @click="onLogout">退出</button>
      </div>
    </header>

    <main class="mobile-main">
      <RouterView />
    </main>

    <nav v-if="showMobileTab" class="mobile-tabbar" aria-label="主导航">
      <RouterLink to="/" :class="{ active: route.name === 'lobby' }">大厅</RouterLink>
      <RouterLink
        to="/boards"
        :class="{ active: route.name === 'boards' || route.name === 'board-edit' }"
      >
        棋盘
      </RouterLink>
      <RouterLink to="/tiles" :class="{ active: route.name === 'tiles' }">指令</RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.nav-disclaimer {
  margin-top: 0.15rem;
  font-size: 0.72rem;
  line-height: 1.25;
  font-weight: 400;
}

.mobile-main {
  flex: 1;
  min-height: 0;
}

.layout-mobile {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: none;
  padding-left: max(0.75rem, env(safe-area-inset-left));
  padding-right: max(0.75rem, env(safe-area-inset-right));
  padding-top: env(safe-area-inset-top);
}

.layout-mobile-tab {
  padding-bottom: calc(3.75rem + env(safe-area-inset-bottom));
}

.mobile-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.25rem 0.5rem;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
}

.mobile-topbar-title {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.mobile-topbar-user {
  font-size: 0.75rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-topbar-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.mobile-topbar-btn,
.mobile-link {
  min-height: 44px;
  min-width: 44px;
  padding: 0 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.mobile-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.25rem;
  padding: 0.35rem 0.5rem calc(0.35rem + env(safe-area-inset-bottom));
  background: color-mix(in srgb, var(--panel) 94%, #000);
  border-top: 1px solid var(--border);
}

.mobile-tabbar a {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--muted);
  font-weight: 600;
  font-size: 0.9rem;
}

.mobile-tabbar a.active {
  color: var(--text);
  background: var(--panel-2);
}
</style>
