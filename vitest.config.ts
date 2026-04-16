/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { resolve } from 'path';

export default defineConfig({
  plugins: [angular({ tsconfig: './tsconfig.spec.json' })],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['src/test-setup.ts'],
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
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 50,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/app'),
    },
  },
});
