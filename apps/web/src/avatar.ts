/** DiceBear voxel-art（官方 HTTP API 10.x） */

const STYLE = 'voxel-art';
const API = `https://api.dicebear.com/10.x/${STYLE}`;

function buildUrl(format: 'svg' | 'png', seed: string, size: number): string {
  const s = seed.trim() || 'player';
  const q = new URLSearchParams({
    seed: s,
    size: String(size),
    borderRadius: '50',
  });
  return `${API}/${format}?${q}`;
}

/**
 * 大厅 / 预览用 SVG URL（borderRadius 50 = 圆形）
 */
export function avatarDataUrl(seed: string, size = 128): string {
  return buildUrl('svg', seed, size);
}

/**
 * Phaser 加载用 PNG URL（比 SVG 更稳）
 */
export function avatarPngUrl(seed: string, size = 64): string {
  return buildUrl('png', seed, size);
}

/** 客户端重随机 seed */
export function randomAvatarSeed(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]!;
  }
  return out;
}

/** Phaser 纹理 key */
export function avatarTextureKey(seed: string): string {
  return `avatar_${seed.trim() || 'player'}`;
}
