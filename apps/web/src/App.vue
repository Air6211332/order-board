<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

/** 登录页与大屏页不显示顶栏 */
const showNav = computed(() => route.name !== 'login' && !route.meta.display);

async function onLogout() {
  await auth.logout();
  await router.push({ name: 'lobby' });
}
</script>

<template>
  <div
    class="layout"
    :class="{ 'layout-fill': route.name === 'board-edit' || route.meta.display }"
  >
    <header v-if="showNav && auth.user" class="nav">
      <div>
        <strong>令棋</strong>
        <span class="muted"> · Order Board</span>
      </div>
      <nav class="nav-links">
        <RouterLink to="/" :class="{ active: route.name === 'lobby' }">大厅</RouterLink>
        <RouterLink to="/boards" :class="{ active: route.name === 'boards' || route.name === 'board-edit' }">
          棋盘
        </RouterLink>
        <RouterLink to="/tiles" :class="{ active: route.name === 'tiles' }">指令库</RouterLink>
        <span class="muted">
          {{ auth.user.username }}
          <template v-if="auth.user.isTemp">（游客）</template>
        </span>
        <RouterLink v-if="auth.user.isTemp" to="/login">注册升级</RouterLink>
        <RouterLink v-else to="/login">换账号</RouterLink>
        <button type="button" @click="onLogout">退出</button>
      </nav>
    </header>
    <RouterView />
  </div>
</template>
