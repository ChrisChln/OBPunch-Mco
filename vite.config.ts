import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const exceptionReportsDevApi = (): Plugin => ({
  name: 'obpunch-exception-reports-dev-api',
  configureServer(server) {
    server.middlewares.use('/api/exception-reports', async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const requestUrl = new URL(req.originalUrl ?? req.url ?? '/api/exception-reports', 'http://localhost');
        (req as any).query = Object.fromEntries(requestUrl.searchParams.entries());
        (req as any).body = rawBody ? JSON.parse(rawBody) : {};
        (res as any).status = (code: number) => {
          res.statusCode = code;
          return res;
        };
        (res as any).json = (body: unknown) => {
          if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };

        const mod = await server.ssrLoadModule('/api/exception-reports.ts');
        await mod.default(req, res);
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: String((error as Error)?.message ?? error ?? 'Exception API failed.') }));
      }
    });
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  const isVercelDev = process.env.PORT === '3000' || process.env.VERCEL === '1';

  return {
    plugins: [react(), exceptionReportsDevApi()],
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
          '.js': 'jsx'
        }
      }
    }
  };
});
