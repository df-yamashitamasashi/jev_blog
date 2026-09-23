import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 3000,
    open: false
  },
  test: {
    environment: 'node',
    globals: true
  }
});
