import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'fs-save-plugin',
      configureServer(server) {
        server.middlewares.use('/api/save', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { path: relativePath, content } = JSON.parse(body);
                // Resolve path relative to project root
                const targetPath = path.resolve(__dirname, relativePath);

                // Ensure directory exists
                const dir = path.dirname(targetPath);
                if (!fs.existsSync(dir)) {
                  fs.mkdirSync(dir, { recursive: true });
                }

                fs.writeFileSync(targetPath, content);
                console.log(`[Vite] Saved file: ${targetPath}`);

                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error('[Vite] Save error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          } else {
            next();
          }
        });

        // LIST FILES ENDPOINT
        server.middlewares.use('/api/list', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { path: relativePath } = JSON.parse(body);
                const targetPath = path.resolve(__dirname, relativePath);

                if (!fs.existsSync(targetPath)) {
                  // Return empty list if dir doesn't exist yet
                  res.statusCode = 200;
                  res.end(JSON.stringify({ files: [] }));
                  return;
                }

                const files = fs.readdirSync(targetPath).filter(file => {
                  return fs.statSync(path.join(targetPath, file)).isFile();
                });

                res.statusCode = 200;
                res.end(JSON.stringify({ files }));
              } catch (err) {
                console.error('[Vite] List error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          } else {
            next();
          }
        });
      },
    }
  ],
})
