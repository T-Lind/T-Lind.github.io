import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { estimateRadiation, screenDebris } from './analysis.mjs';

const date = z.iso.datetime({ offset: true }).describe('ISO 8601 timestamp with a timezone, preferably UTC.');
const angle = z.number().min(0).max(360).default(0);
const orbit = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('tle'),
        text: z.string().min(1).max(2500).describe('One TLE, with an optional name line.')
    }),
    z.strictObject({
        kind: z.literal('omm'),
        text: z.string().min(1).max(2500).describe('One OMM record as JSON text.')
    }),
    z.strictObject({
        kind: z.literal('elements'),
        epoch: date,
        perigee: z.number().min(100).max(60000).describe('Perigee altitude in km.'),
        apogee: z.number().min(100).max(60000).describe('Apogee altitude in km.'),
        inc: z.number().min(0).max(180).describe('Inclination in degrees.'),
        raan: angle.describe('Right ascension of the ascending node in degrees.'),
        argp: angle.describe('Argument of perigee in degrees.'),
        ma: angle.describe('Mean anomaly in degrees.'),
        bstar: z.number().min(-1).max(1).default(0).describe('Optional TLE B* drag term.')
    })
]);

function result(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

function createServer() {
    const server = new McpServer({
        name: 't-lind-space-tools', title: 'T-Lind Space Tools', version: '1.0.0',
        websiteUrl: 'https://t-lind.github.io/space/'
    });
    server.registerTool('screen_orbital_debris', {
        description: 'Estimate closest approaches against a saved public orbital catalog using SGP4. Start defaults to the catalog reference epoch and must be within 30 days of both the reference epoch and the input orbit epoch. This is suitable for study and preliminary screening.',
        inputSchema: z.strictObject({
            orbit,
            startUtc: date.optional(),
            hours: z.number().int().min(1).max(6).default(6).describe('Length of the screening window in hours.'),
            missDistanceKm: z.number().min(0.5).max(200).default(10),
            maxResults: z.number().int().min(1).max(25).default(10)
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async input => result(await screenDebris(input)));

    server.registerTool('estimate_van_allen_radiation', {
        description: 'Estimate trapped electron and proton fluence and silicon dose behind aluminum shielding with NASA AE8/AP8 and IGRF. If startUtc is omitted, use the orbit epoch.',
        inputSchema: z.strictObject({
            orbit,
            startUtc: date.optional(),
            missionDays: z.number().min(0.01).max(365.25),
            solar: z.enum(['min', 'max']).default('max'),
            fieldYear: z.enum(['1970', '2025']).default('1970'),
            shieldingMm: z.number().min(0.01).max(50).default(2.54),
            geometry: z.enum(['sphere', 'slab']).default('sphere')
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async input => result(await estimateRadiation(input)));
    return server;
}

const handler = createMcpHandler(createServer, { responseMode: 'json', maxRequestBodySize: 16384 });
export default {
    fetch(request) {
        const url = new URL(request.url);
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return new Response('Origin not allowed.', { status: 403 });
        return handler.fetch(request);
    }
};
