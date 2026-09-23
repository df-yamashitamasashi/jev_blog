import { defineConfig } from "vite";

// api.typesafe.ai はOriginホワイトリスト方式のCORSを敷いており、ブラウザから
// http://localhost:... を直接叩くと「Failed to fetch」になる。
// Vite開発/プレビューサーバーのプロキシ経由（サーバー間通信）にすることで
// ブラウザのCORS制約を回避する。ローカル実行専用の構成。
const jevApiProxy = {
  "/jev-api": {
    target: "https://api.typesafe.ai",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/jev-api/, ""),
  },
};

export default defineConfig({
  server: {
    port: 5174,
    proxy: jevApiProxy,
  },
  preview: {
    proxy: jevApiProxy,
  },
});
