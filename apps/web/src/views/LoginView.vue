<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const mode = ref<'login' | 'register'>('login');
const username = ref('demo');
const password = ref('demo1234');
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    if (mode.value === 'login') {
      await auth.login(username.value, password.value);
    } else {
      await auth.register(username.value, password.value);
    }
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <div class="card stack" style="width: min(420px, 100%)">
      <div>
        <h1>令棋</h1>
        <p class="muted">私密棋盘 · 掷骰走格 · 执行指令</p>
      </div>
      <div class="row">
        <button type="button" :class="{ primary: mode === 'login' }" @click="mode = 'login'">
          登录
        </button>
        <button
          type="button"
          :class="{ primary: mode === 'register' }"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>
      <form class="stack" @submit.prevent="submit">
        <label>
          用户名
          <input v-model="username" autocomplete="username" required />
        </label>
        <label>
          密码
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary" type="submit" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '进入' : '创建账号' }}
        </button>
      </form>
      <p class="muted" style="font-size: 0.85rem">
        游客可先玩再注册升级（保留棋盘数据）。示例账号 demo / demo1234（seed 后可用）。
      </p>
      <button type="button" @click="router.push('/')">先以游客继续</button>
    </div>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 70vh;
  display: grid;
  place-items: center;
}
</style>
