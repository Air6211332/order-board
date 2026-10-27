import { computed, onMounted, onUnmounted, readonly, ref, type Ref } from 'vue';

/** 视口断点：平板竖屏 / 窄窗兜底 */
export const MOBILE_VIEWPORT_MQ = '(max-width: 768px)';

/**
 * 手机 UA（不含纯 iPad 桌面模式；Android 需带 Mobile）。
 * 优先于视口：真机横屏宽于 768 仍视为移动端。
 */
export function detectMobileUa(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
  if (!ua) return false;
  if (/iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  // 部分安卓平板 UA 无 Mobile；仍交给视口兜底
  return false;
}

function readViewportMobile(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_VIEWPORT_MQ).matches;
}

function computeIsMobile(): boolean {
  if (detectMobileUa()) return true;
  return readViewportMobile();
}

const isMobileRef: Ref<boolean> = ref(computeIsMobile());

let listenersAttached = false;
let mq: MediaQueryList | null = null;

function refresh() {
  isMobileRef.value = computeIsMobile();
}

function ensureListeners() {
  if (listenersAttached || typeof window === 'undefined') return;
  listenersAttached = true;
  mq = window.matchMedia(MOBILE_VIEWPORT_MQ);
  mq.addEventListener('change', refresh);
  window.addEventListener('resize', refresh);
}

/**
 * 模块级同步初值，供路由守卫首屏使用，避免先闪 PC。
 */
export function getIsMobileSync(): boolean {
  return isMobileRef.value;
}

/**
 * 响应式设备模式：UA 优先，视口兜底。
 */
export function useDeviceMode() {
  onMounted(() => {
    ensureListeners();
    refresh();
  });
  // 不在 onUnmounted 移除全局监听：多处组件共用同一模块级状态

  const isMobile = readonly(isMobileRef);
  const deviceMode = computed<'mobile' | 'desktop'>(() =>
    isMobile.value ? 'mobile' : 'desktop',
  );

  return { isMobile, deviceMode };
}

/** 在 App 根挂载一次，保证监听已启动 */
export function useDeviceModeRoot() {
  onMounted(() => {
    ensureListeners();
    refresh();
  });
  onUnmounted(() => {
    /* 根组件卸载极少发生；保留监听无妨 */
  });
  return useDeviceMode();
}
