import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import handler from './handler.mjs';
import orbitLib from '../space/lib/orbit.js';

const remote = process.env.MCP_TEST_URL;
const endpoint = new URL(remote || 'http://localhost:8787/mcp');
const request = remote ? fetch : (input, init) => handler.fetch(new Request(input, init));
const makeClient = mode => new Client({ name: 'space-tools-smoke-test', version: '1.0.0' }, {
    versionNegotiation: { mode }
});
const debris = 'screen_orbital_debris';
const radiation = 'estimate_van_allen_radiation';
const epoch = '2026-10-22T15:43:48.036Z';
const orbit = { kind: 'elements', epoch, perigee: 400, apogee: 420, inc: 51.6 };

test('public MCP lists both read-only tools with current and legacy clients', async t => {
    for (const mode of ['auto', 'legacy']) {
        const client = makeClient(mode);
        t.after(() => client.close());
        await client.connect(new StreamableHTTPClientTransport(endpoint, { fetch: request }));
        assert.equal(client.getProtocolEra(), mode === 'auto' ? 'modern' : 'legacy');
        const { tools } = await client.listTools();
        assert.deepEqual(tools.map(tool => tool.name).sort(), [radiation, debris]);
        assert(tools.every(tool => tool.annotations.readOnlyHint && tool.inputSchema.properties.orbit));
    }
});

test('screens the full snapshot and returns ordered close approaches in the requested window', async t => {
    const client = makeClient('legacy');
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(endpoint, { fetch: request }));
    const result = await client.callTool({
        name: debris, arguments: { orbit, hours: 1, missDistanceKm: 200, maxResults: 3 }
    }, { timeout: 45000 });
    assert(!result.isError, JSON.stringify(result.content));
    const data = result.structuredContent;
    assert(data.catalog.objects > 32000);
    assert(data.catalog.candidateObjects > 0);
    assert.equal(data.startUtc, data.catalog.referenceEpoch);
    assert.equal(Date.parse(data.endUtc) - Date.parse(data.startUtc), 3600e3);
    assert(data.encounters.length > 0 && data.encounters.length <= 3);
    assert(data.encounters.every((event, i) =>
        event.closestApproachUtc >= data.startUtc && event.closestApproachUtc <= data.endUtc &&
        event.missKm <= 200 && (i === 0 || event.missKm >= data.encounters[i - 1].missKm)));
    const stale = await client.callTool({
        name: debris, arguments: { orbit: { ...orbit, epoch: '2027-01-01T00:00:00Z' }, startUtc: '2027-01-01T00:00:00Z' }
    });
    assert(stale.isError);
    assert.match(stale.content[0].text, /catalog reference epoch/i);
});

test('estimates dose from a TLE and reports invalid orbits', async t => {
    const client = makeClient('auto');
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(endpoint, { fetch: request }));
    const source = { ...orbit, perigee: 1000, apogee: 1000, inc: 35 };
    const tle = orbitLib.toTLE(orbitLib.elementsOf(orbitLib.satrecFromSource(source)), 'DOSE TEST');
    const result = await client.callTool({
        name: radiation, arguments: { orbit: { kind: 'tle', text: tle }, missionDays: 30, solar: 'min', fieldYear: '2025' }
    });
    assert(!result.isError, JSON.stringify(result.content));
    const data = result.structuredContent;
    assert.equal(data.model.fieldYear, '2025');
    assert.equal(data.shielding.thicknessMm, 2.54);
    assert(data.doseRadSi.protons > 0 && data.doseRadSi.total >= data.doseRadSi.protons);
    assert(data.fluencePerCm2.protonsAbove10MeV > 0);
    const invalid = await client.callTool({
        name: radiation, arguments: { orbit: { kind: 'tle', text: 'not a TLE' }, missionDays: 30 }
    });
    assert(invalid.isError);
    assert.match(invalid.content[0].text, /no two-line element/i);
});

test('rejects a foreign browser origin and an oversized body', async () => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    const foreign = await request(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://example.org' }, body: '{}' });
    assert.equal(foreign.status, 403);
    const oversized = await request(endpoint, { method: 'POST', headers, body: JSON.stringify('X'.repeat(17000)) });
    assert.equal(oversized.status, 413);
});
