import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';

const root = resolve('build/pages');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon' };

statSync(resolve(root, 'index.html'));
createServer((request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const local = path.replace(/^\/draft-lab(?=\/)/, '');
    const file = resolve(root, '.' + (local.endsWith('/') ? local + 'index.html' : local));
    const name = relative(root, file);
    if (name === '..' || name.startsWith('..' + sep) || !statSync(file).isFile()) throw Error('File unavailable');
    response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end();
  }
}).listen(8791, '127.0.0.1');
