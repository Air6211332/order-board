<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth';

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
  <div class="mobile-login stack">
    <div class="hero">
      <h1>令棋</h1>
      <p class="muted">私密棋盘 · 掷骰走格 · 执行指令</p>
      <p class="muted disclaimer">版本未稳定，数据随时可能重置。</p>
    </div>
    <div class="card stack">
      <div class="row mode-row">
        <button
          type="button"
          class="touch-btn"
          :class="{ primary: mode === 'login' }"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          type="button"
          class="touch-btn"
          :class="{ primary: mode === 'register' }"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>
      <form class="stack" @submit.prevent="submit">
        <label>
          用户名
          <input v-model="username" autocomplete="username" required class="touch-field" />
        </label>
        <label>
          密码
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="touch-field"
          />
        </label>
        <p v-if="error" class="error">{{ error }}</p>
        <button class="primary touch-btn" type="submit" :disabled="loading">
          {{ loading ? '请稍候…' : mode === 'login' ? '进入' : '创建账号' }}
        </button>
      </form>
      <button type="button" class="touch-btn" @click="router.push('/')">先以游客继续</button>
    </div>
  </div>
</template>

<style scoped>
.mobile-login {
  padding: 1.25rem 0 2rem;
  max-width: 420px;
  margin: 0 auto;
}

.hero h1 {
  font-size: 2rem;
  margin-bottom: 0.25rem;
}

.disclaimer {
  font-size: 0.75rem;
  margin: 0.5rem 0 0;
}

.mode-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.touch-btn {
  min-height: 44px;
  width: 100%;
}

.touch-field {
  min-height: 44px;
}
</style>
