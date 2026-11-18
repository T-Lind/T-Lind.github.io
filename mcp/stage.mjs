import { copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Stage only the MCP package and the public models it needs for deployment.
const stage = await mkdtemp(join(tmpdir(), 't-lind-space-mcp-'));
const paths = [
    ['mcp/package.json', 'package.json'],
    ['mcp/package-lock.json', 'package-lock.json'],
    ['mcp/vercel.json', 'vercel.json'],
    ...[
        'mcp/analysis.mjs', 'mcp/handler.mjs',
        'debris/worker.js', 'van-allen/worker.js',
        'space/lib/orbit.js', 'space/lib/radiation.js', 'space/lib/satellite.min.js',
        'space/lib/satellite.LICENSE.md', 'space/data/catalog.json',
        'space/data/ae8ap8.json', 'space/data/field.json', 'space/data/nist.json',
        'space/data/field-1970.bin', 'space/data/field-2025.bin'
    ].map(path => [path, path])
];
await Promise.all(paths.map(async ([source, destination]) => {
    const target = join(stage, destination);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(new URL(`../${source}`, import.meta.url), target);
}));
await mkdir(join(stage, 'api'));
await mkdir(join(stage, 'public'));
await writeFile(join(stage, 'public', 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(join(stage, 'api', 'mcp.mjs'), "export { default } from '../mcp/handler.mjs';\n");
console.log(stage);
