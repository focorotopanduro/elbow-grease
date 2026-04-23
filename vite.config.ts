import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@hooks': path.resolve(__dirname, 'src/hooks'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@engine': path.resolve(__dirname, 'src/engine'),
    },
  },
  /**
   * Phase 3: enable `crossOriginIsolated` in the dev server so
   * SharedArrayBuffer is available when the `sabIpc` feature flag is
   * flipped on. These headers are harmless when the flag is off — they
   * just restrict third-party iframe embeds, none of which we use.
   *
   * Production Tauri bundle is unaffected: the custom scheme Tauri
   * serves from (`tauri://localhost`) is crossOriginIsolated by default.
   */
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Vitest config. Colocated with Vite so Phase-N tests pick up the
  // same path aliases as production code with zero duplication.
  // @ts-expect-error - `test` is added to the Vite config type by Vitest
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
