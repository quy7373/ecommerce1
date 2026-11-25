import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            icons: ['lucide-react'],
            http: ['axios'],
          },
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_PROXY || 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
