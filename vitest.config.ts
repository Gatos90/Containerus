/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    setupFiles: [],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/environments/**',
        'node_modules/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/app'),
    },
  },
});
