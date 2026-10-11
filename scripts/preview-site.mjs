import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.mp4': 'video/mp4', '.pdf': 'application/pdf' };
createServer(async (request, response) => {
    try {
        const url = new URL(request.url, 'http://localhost');
        const file = resolve(root, '.' + decodeURIComponent(url.pathname));
        const rel = relative(root, file);
        if (rel.startsWith('..') || isAbsolute(rel) || rel.split(/[\\/]/).some(part => part.startsWith('.'))) {
            response.writeHead(403).end(); return;
        }
        const target = (await stat(file)).isDirectory() ? resolve(file, 'index.html') : file;
        response.writeHead(200, { 'content-type': types[extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(await readFile(target));
    } catch { response.writeHead(404).end('Not found'); }
}).listen(8088, '127.0.0.1', () => console.log('Static site at http://127.0.0.1:8088'));
