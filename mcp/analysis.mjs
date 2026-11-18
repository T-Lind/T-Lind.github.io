import { readFile } from 'node:fs/promises';
import orbit from '../space/lib/orbit.js';
import radiation from '../space/lib/radiation.js';
import debrisWorker from '../debris/worker.js';
import radiationWorker from '../van-allen/worker.js';

const dayMs = 86400e3;
const dataPath = new URL('../space/data/', import.meta.url);
const loadJson = async file => JSON.parse(await readFile(new URL(file, dataPath), 'utf8'));
async function loadBinary(file) {
    const buffer = await readFile(new URL(file, dataPath));
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function cacheData(load) {
    let pending;
    return () => pending ??= load().catch(error => {
        pending = undefined;
        throw error;
    });
}

const getCatalog = cacheData(async () => {
    const { metadata, fields, rows } = await loadJson('catalog.json');
    const nameIndex = fields.indexOf('name');
    return {
        metadata,
        names: rows.map(row => row[nameIndex]),
        records: debrisWorker.loadCatalog(rows, fields)
    };
});
const getRadiation = cacheData(async () => {
    const [ae8ap8, nist, fieldMeta] = await Promise.all([
        loadJson('ae8ap8.json'), loadJson('nist.json'), loadJson('field.json')
    ]);
    return {
        model: new radiation.TrappedModel(ae8ap8),
        dose: new radiation.DoseModel(nist),
        fieldMeta
    };
});
function loadField(year) {
    return cacheData(async () => {
        const [{ fieldMeta }, buffer] = await Promise.all([getRadiation(), loadBinary(`field-${year}.bin`)]);
        return new radiation.FieldGrid({ ...fieldMeta, year: +year }, buffer);
    });
}
const getField = { 1970: loadField('1970'), 2025: loadField('2025') };

function getOrbit(input) {
    let source = input, satrec, warnings = [];
    if (input.kind === 'elements') {
        source = { name: 'Custom orbit', ...input };
        satrec = orbit.satrecFromSource(source);
    } else {
        const { sets, errors } = input.kind === 'tle' ? orbit.parseTLE(input.text) : orbit.parseOMM(input.text);
        if (errors.length || sets.length !== 1) throw new Error(errors[0] || 'Supply exactly one orbit.');
        const [set] = sets;
        const { name, line1, line2, omm } = set;
        source = input.kind === 'tle' ? { kind: 'tle', name, line1, line2 } : { kind: 'omm', name, omm };
        ({ satrec, warnings } = set);
    }
    const epoch = orbit.epochDate(satrec);
    if (![satrec.no, satrec.ecco, satrec.inclo, satrec.nodeo, satrec.argpo, satrec.mo, epoch.getTime()].every(Number.isFinite)
        || satrec.no <= 0 || satrec.ecco < 0 || satrec.ecco >= 1) {
        throw new Error('The orbit could not be initialized from these elements.');
    }
    const position = orbit.stateAt(satrec, epoch)?.position;
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) {
        throw new Error('SGP4 could not propagate the orbit at its epoch.');
    }
    return { source, epoch, warnings, norad: Number(satrec.satnum) };
}

export async function screenDebris({ orbit: input, startUtc, hours, missDistanceKm, maxResults }) {
    const { source, epoch, warnings, norad } = getOrbit(input);
    const { metadata, names, records } = await getCatalog();
    const start = Date.parse(startUtc || metadata.referenceEpoch);
    if (Math.abs(start - epoch) > 30 * dayMs) throw new Error('Start must be within 30 days of the input orbit epoch.');
    const snapshotAgeDays = Math.abs(start - Date.parse(metadata.referenceEpoch)) / dayMs;
    if (snapshotAgeDays > 30) {
        throw new Error(`Start must be within 30 days of the catalog reference epoch (${metadata.referenceEpoch}). Use the browser visualizer to screen a newer catalog.`);
    }
    const result = debrisWorker.screen(records, {
        source, start, hours, threshold: missDistanceKm,
        exclude: input.kind !== 'elements' && Number.isFinite(norad) ? [norad] : []
    }, undefined, Date.now() + 20_000);
    return {
        catalog: {
            retrievedAt: metadata.retrievedAt,
            referenceEpoch: metadata.referenceEpoch,
            objects: records.recs.length,
            unpropagatableObjects: records.bad,
            candidateObjects: result.candidates
        },
        startUtc: new Date(start).toISOString(),
        endUtc: new Date(result.windowEnd).toISOString(),
        missDistanceKm,
        partialWindow: result.truncated,
        totalMatches: result.eventCount,
        encounters: result.events.slice(0, maxResults).map(event => ({
            norad: event.norad,
            name: names[event.index],
            closestApproachUtc: new Date(event.tca).toISOString(),
            missKm: event.miss,
            relativeSpeedKmPerSecond: event.vrel,
            missComponentsKm: { radial: event.ric.r, inTrack: event.ric.i, crossTrack: event.ric.c }
        })),
        warnings: [
            ...warnings,
            'Screening uses a saved catalog snapshot and SGP4. It is a screening estimate, not an operational conjunction assessment.'
        ]
    };
}

export async function estimateRadiation({ orbit: input, startUtc, missionDays, solar, fieldYear, shieldingMm, geometry }) {
    const { source, epoch, warnings } = getOrbit(input);
    const start = startUtc ? new Date(startUtc) : epoch;
    if (Math.abs(start - epoch) > 365.25 * dayMs) throw new Error('Start must be within one year of the input orbit epoch.');
    const [{ model, dose }, field] = await Promise.all([getRadiation(), getField[fieldYear]()]);
    const result = radiationWorker.runCase({ settings: {
        start: start.toISOString(), durationS: missionDays * 86400, solar, field: fieldYear,
        eThr: 1, pThr: 10, eLevel: 1000, pLevel: 1, samples: 12000,
        refMm: shieldingMm, geometry, ef: 'practical'
    } }, { source }, { model, field, dose }, undefined, true);
    return {
        startUtc: start.toISOString(), missionDays, samples: result.N,
        model: { electrons: 'AE8', protons: 'AP8', solar, fieldYear },
        shielding: { material: 'aluminum', thicknessMm: shieldingMm, geometry },
        doseRadSi: {
            total: result.refDose.total, electrons: result.refDose.e,
            protons: result.refDose.p, bremsstrahlung: result.refDose.b
        },
        fluencePerCm2: { electronsAbove1MeV: result.fluence.e, protonsAbove10MeV: result.fluence.p },
        warnings: [
            ...warnings, ...result.warnings,
            'Estimates represent trapped radiation behind an idealized shield. Solar particle events and galactic cosmic rays are outside the model.'
        ]
    };
}
