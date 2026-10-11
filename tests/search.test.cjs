const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { execFileSync } = require('node:child_process');
const search = require('../search-core.js');
const root = resolve(__dirname, '..');
const index = JSON.parse(readFileSync(resolve(root, 'search-index.json'), 'utf8'));
const documents = search.prepare(index);
const top = query => search.search(documents, query, 'All')[0]?.doc.title;

test('search index stays in sync with the current public content', () => {
    execFileSync(process.execPath, ['scripts/build-search-index.mjs', '--check'], { cwd: root });
});

test('requested projects are discoverable by name, alias, and common typing mistakes', () => {
    for (const [query, title] of [
        ['OpenDraft', 'OpenDraft'], ['open draft', 'OpenDraft'], ['opendrfat', 'OpenDraft'],
        ['ty', 'ty'], ['lightening detector', 'Lightning Detector'],
        ['ss.jl', 'SatelliteSim.jl (ss.jl)'], ['ssjl', 'SatelliteSim.jl (ss.jl)'],
        ['satellite sim', 'SatelliteSim.jl (ss.jl)'], ['accessro', 'Accessor'], ['29', 'Accessor'],
        ['syngrafi', 'Syngrafi']
    ]) assert.equal(top(query), title, query);
});

test('languages and multiple topic words retrieve relevant projects', () => {
    const python = search.search(documents, 'py', 'Projects').map(r => r.doc.title);
    assert(python.includes('ty'));
    assert(python.includes('Photolib'));
    assert(!python.includes('OpenDraft'));
    assert.equal(top('voice agent'), 'Accessor');
    assert.equal(top('writing workshop'), 'OpenDraft');
    assert(search.search(documents, 'c++', 'Projects').some(r => r.doc.title === 'Lightning Detector'));
    assert(!search.search(documents, 'java', 'Projects').some(r => r.doc.title === 'SatelliteSim.jl (ss.jl)'));
});

test('whole-site content, category filters, and empty results work', () => {
    const reading = search.search(documents, 'Dostoevsky', 'Reading');
    assert(reading.some(result => result.doc.url === 'reading/'));
    assert(search.excerpt(reading[0].doc, 'Dostoevsky').includes('Dostoevsky'));
    assert(search.search(documents, 'planning', 'Research').length > 0);
    assert(search.search(documents, 'hard things', 'Essays').length > 0);
    assert.equal(search.search(documents, 'OpenDraft', 'Research').length, 0);
    assert.equal(search.search(documents, 'xzyqwvunknown', 'All').length, 0);
    assert(search.search(documents, '', 'Projects').every(r => r.doc.category === 'Projects'));
});

test('short queries stay precise and accents and unsafe input are handled as text', () => {
    const sample = search.prepare([
        { title: 'ty', description: '', text: '', category: 'Projects' },
        { title: 'Party', description: '', text: '', category: 'Pages' },
        { title: 'Café', description: '', text: '', category: 'Pages' }
    ]);
    assert.deepEqual(search.search(sample, 'ty').map(r => r.doc.title), ['ty']);
    assert.equal(search.search(sample, 'cafe')[0].doc.title, 'Café');
    assert.doesNotThrow(() => search.search(documents, '<img onerror="alert(1)">'));
    assert.equal(search.queryTerms('x '.repeat(500)).length, 1);
});

test('the checked-in index is complete, links resolve, and project tags are programming languages', () => {
    const languages = new Set(['Python', 'Rust', 'JavaScript', 'TypeScript', 'Julia', 'Java', 'C++', 'C', 'SQL', 'C#', 'Ruby']);
    for (const doc of index) {
        assert(doc.title && doc.category && doc.url);
        if (!/^https?:/.test(doc.url)) {
            const file = doc.url === './' ? 'index.html' : doc.url.endsWith('/') ? doc.url + 'index.html' : doc.url;
            assert(existsSync(resolve(root, file)), doc.url);
        }
        for (const tag of doc.tags) assert(languages.has(tag), tag);
        assert(!doc.text.includes('gl_FragColor'), 'shader source must not enter search');
    }
    for (const path of ['opendraft', 'ty', 'lightning-detector', 'accessor', 'satellite-sim', 'syngrafi', 'projects']) {
        const file = resolve(root, path, 'index.html');
        const html = readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        for (const [, src] of html.matchAll(/<img[^>]*src="([^"]+)"/g)) assert(existsSync(resolve(root, path, src)), `${path}: ${src}`);
        for (const [, tag] of html.matchAll(/class="project-tag"[^>]*>([^<]+)</g)) assert(languages.has(tag), `${path}: ${tag}`);
    }
});
