// Rebuild after adding or editing static content: npm run search:index
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', larr: '←', rarr: '→' };
function plain(html) {
    return html.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (_, entity) => {
        if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
        return entities[entity] || ' ';
    }).replace(/\s+/g, ' ').trim();
}
const projectSections = new Set(['opendraft', 'ty', 'lightning-detector', 'accessor', 'satellite-sim', 'syngrafi', 'photolib', 'chess-3d', 'lofall', 'intellistream', 'wormhole', 'lindauerai', 'kalman']);
const aliases = {
    opendraft: ['open draft', 'writing workshop'], ty: ['tiny terminal agent', 'ollama', 'local AI agent', 'LLM'],
    'lightning-detector': ['lightning detector', 'AS3935', 'ESP32'], accessor: ['29', 'twenty nine', 'voice agent'],
    'satellite-sim': ['ss.jl', 'ssjl', 'satellite sim', 'satellitesim', 'moonshot'], syngrafi: ['scripture', 'Bible', 'Quran', 'Koran'],
    photolib: ['photo library', 'photos'], 'chess-3d': ['3d chess'], lofall: ['4d platformer', 'tesseract']
};
const files = ['index.html'];
// Only public static pages, never node_modules, app sources, or environment files.
for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || ['app', 'components', 'lib', 'public', 'scripts', 'tests', 'node_modules', 'search'].includes(entry.name)) continue;
    for (const file of await readdir(resolve(root, entry.name))) {
        if (file.endsWith('.html') && file !== 'template.html') files.push(`${entry.name}/${file}`);
    }
}
const documents = [];
for (const file of files.sort()) {
    let html = await readFile(resolve(root, file), 'utf8');
    html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|nav|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const section = file.split('/')[0];
    const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
    const title = plain(main.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title>(.*?)<\/title>/i)?.[1] || section);
    const description = plain(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] || main.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const tags = projectSections.has(section) ? [...main.matchAll(/<span\b[^>]*class="project-tag"[^>]*>(.*?)<\/span>/g)].map(match => plain(match[1])) : [];
    const category = projectSections.has(section) ? 'Projects' : section === 'research' ? 'Research' : section === 'essays' || section === 'motivation' ? (html.includes('reader-story') ? 'Stories' : 'Essays') : section === 'reading' ? 'Reading' : section === 'games' || section === 'orbits' ? 'Games' : 'Pages';
    const url = file === 'index.html' ? './' : file.endsWith('/index.html') ? file.replace(/index\.html$/, '') : file;
    documents.push({ title, url, category, description, tags: [...new Set(tags)], aliases: aliases[section] || [], text: plain(main.replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, '')) });
    // Older projects without a detail page are still searchable individually.
    if (section === 'projects') {
        for (const match of main.matchAll(/<a\s+href="([^"]+)"[^>]*class="project-card(?:-noimg)?"[^>]*>([\s\S]*?)<\/a>/g)) {
            if (!/^https?:/.test(match[1])) continue;
            const card = match[2];
            documents.push({ title: plain(card.match(/class="project-title">([\s\S]*?)<\/div>/)?.[1] || ''), url: match[1], category: 'Projects', description: plain(card.match(/class="project-description">([\s\S]*?)<\/div>/)?.[1] || ''), tags: [...card.matchAll(/class="project-tag"[^>]*>(.*?)<\/span>/g)].map(m => plain(m[1])), aliases: [], text: plain(card) });
        }
    }
}
const output = JSON.stringify(documents, null, 2) + '\n';
const destination = resolve(root, 'search-index.json');
if (process.argv.includes('--check')) {
    const current = (await readFile(destination, 'utf8')).replace(/\r\n/g, '\n');
    if (current !== output) {
        console.error('Search index is stale. Run npm run search:index and commit search-index.json.');
        process.exitCode = 1;
    } else console.log(`Search index is current (${documents.length} entries).`);
} else {
    await writeFile(destination, output);
    console.log(`Indexed ${documents.length} public pages and projects in ${relative(root, destination).split(sep).join('/')}.`);
}
