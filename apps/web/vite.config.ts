import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.API_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: api, ws: true } },
  },
  test: { include: ['src/**/*.test.ts'] },
});
