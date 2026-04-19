import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

function ensureFile(targetPath: string, content: string) {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(targetPath)) {
    fs.writeFileSync(targetPath, content);
  }
}

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

        server.middlewares.use('/api/ensure-file', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { path: relativePath, content } = JSON.parse(body);
                const targetPath = path.resolve(__dirname, relativePath);
                ensureFile(targetPath, content || '{}');
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error('[Vite] Ensure file error:', err);
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

                const items = fs.readdirSync(targetPath).map((file) => {
                  const stats = fs.statSync(path.join(targetPath, file));
                  return {
                    name: file,
                    isDir: stats.isDirectory(),
                  };
                });

                // Sort: Directories first, then files
                items.sort((a, b) => {
                  if (a.isDir === b.isDir) return a.name.localeCompare(b.name);
                  return a.isDir ? -1 : 1;
                });

                res.statusCode = 200;
                res.end(JSON.stringify({ files: items }));
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
        server.middlewares.use('/api/read-file', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { path: relativePath, content } = JSON.parse(body);
                const targetPath = path.resolve(__dirname, relativePath);
                ensureFile(targetPath, content || '{}');
                const fileContent = fs.readFileSync(targetPath, 'utf-8');
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, content: fileContent }));
              } catch (err) {
                console.error('[Vite] Read file error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          } else {
            next();
          }
        });
        // OPEN FOLDER ENDPOINT
        server.middlewares.use('/api/open-folder', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { path: relativePath } = JSON.parse(body);
                const targetPath = path.resolve(__dirname, relativePath);

                console.log(`[Vite] Opening folder: ${targetPath}`);

                // Determine command based on platform
                // Since user is on Windows (based on paths), we use 'explorer'
                // 'explorer "path"' is also good.

                exec(`explorer "${targetPath}"`);

                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error('[Vite] Open folder error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          } else {
            next();
          }
        });
        server.middlewares.use('/api/open-file', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { path: relativePath, content } = JSON.parse(body);
                const targetPath = path.resolve(__dirname, relativePath);
                ensureFile(targetPath, content || '{}');

                exec(`start "" "${targetPath}"`);

                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error('[Vite] Open file error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          } else {
            next();
          }
        });
        server.middlewares.use('/api/delete-file', (req, res, next) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });
            req.on('end', () => {
              try {
                const { path: relativePath } = JSON.parse(body);
                const targetPath = path.resolve(__dirname, relativePath);
                if (fs.existsSync(targetPath)) {
                  fs.unlinkSync(targetPath);
                }
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true }));
              } catch (err) {
                console.error('[Vite] Delete file error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: String(err) }));
              }
            });
          } else {
            next();
          }
        });

        server.middlewares.use('/api/llm', (req, res, next) => {
          if (req.method !== 'POST') {
            next();
            return;
          }

          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (!apiKey) {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }));
            return;
          }

          let body = '';
          req.on('data', (chunk) => {
            body += chunk.toString();
          });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body) as {
                model?: string;
                max_tokens?: number;
                system?: string;
                messages?: unknown[];
                stream?: boolean;
              };
              const isStream = payload.stream === true;

              const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': apiKey,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: payload.model || 'claude-haiku-4-5-20251001',
                  max_tokens: payload.max_tokens || 1024,
                  system: payload.system || '',
                  messages: payload.messages || [],
                  stream: isStream,
                }),
              });

              if (isStream && response.ok && response.body) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(decoder.decode(value, { stream: true }));
                  }
                  res.write(decoder.decode());
                } catch (streamErr) {
                  console.error('[Vite] LLM stream error:', streamErr);
                } finally {
                  res.end();
                }
                return;
              }

              const data = await response.text();
              res.statusCode = response.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(data);
            } catch (err) {
              console.error('[Vite] LLM proxy error:', err);
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
        });
      },
    },
  ],
});
