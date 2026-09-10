import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // `server-only` throws unless it runs inside a React Server Component.
      // Server modules (lib/*) are plain async functions under test — stub it.
      'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
});
