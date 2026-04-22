import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(() => {
  const isVercelDev = process.env.PORT === '3000' || process.env.VERCEL === '1';

  return {
    plugins: [react()],
    server: isVercelDev
      ? undefined
      : {
          proxy: {
            '/api': {
              target: 'http://localhost:3000',
              changeOrigin: true
            }
          }
        },
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          admin: resolve(__dirname, 'admin.html'),
          device: resolve(__dirname, 'device.html'),
          agency: resolve(__dirname, 'agency/index.html')
        }
      }
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: {
          '.js': 'jsx',
          '.ts': 'tsx'
        }
      }
    }
  };
});
