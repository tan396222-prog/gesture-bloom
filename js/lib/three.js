/**
 * three.js 加载器：优先使用本地 vendor 目录，其次国际 CDN，最后国内镜像（npmmirror）。
 * 任意一个源可用即可运行。
 */
const VERSION = '0.170.0';
const SOURCES = [
  new URL('../../vendor/three/three.module.min.js', import.meta.url).href,
  `https://cdn.jsdelivr.net/npm/three@${VERSION}/build/three.module.min.js`,
  `https://unpkg.com/three@${VERSION}/build/three.module.min.js`,
  `https://registry.npmmirror.com/three/${VERSION}/files/build/three.module.min.js`,
];

async function loadThree() {
  let lastError;
  for (const src of SOURCES) {
    try {
      const mod = await import(/* @vite-ignore */ src);
      if (mod && mod.WebGLRenderer) return mod;
    } catch (err) {
      lastError = err;
      console.warn('[three] source failed:', src);
    }
  }
  throw lastError || new Error('three.js could not be loaded');
}

export const THREE = await loadThree();
export default THREE;
