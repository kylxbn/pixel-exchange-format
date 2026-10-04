// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { describe, expect, it } from 'vitest';
import {
    SBR_END_BIN,
    SBR_START_BIN,
    analyzeRowSBR,
    analyzeStereoRowSbrCues,
    applySBRSynthesis,
    decodeSBRWord,
    encodeRowSBR,
    getSbrSubgroupIndexForBlock,
    getSbrSubgroupRange,
    lockStereoRowPatchModes,
    projectStereoCueToHighFrequencies,
    readSourceTile,
    encodeSBRWord,
    type RowSBRParams,
    type SBRParams,
    type SBRParamsTemporal,
} from './sbr';
import { selectSbrParamsForBlock } from '../decoder/audioMath';
import { DATA_BLOCKS_PER_ROW } from '../constants';
import { createRNG } from './rng';

describe('SBR Bitfields', () => {
    it('round-trips the normal layout with stereo cue bits', () => {
        const params: SBRParams = {
            temporalMode: false,
            hfGain: -6,
            bandEnvelope: [-6, -2, 8, 4],
            gainDelta: -5,
            tonality: 3,
            patchMode: 1,
            stereoCue: 5,
            transientShape: 1
        };

        const decoded = decodeSBRWord(encodeSBRWord(params)) as SBRParams;

        expect(decoded.temporalMode).toBe(false);
        expect(decoded.hfGain).toBe(-6);
        expect(decoded.bandEnvelope).toEqual([-6, -2, 8, 4]);
        expect(decoded.gainDelta).toBe(-5);
        expect(decoded.tonality).toBe(3);
        expect(decoded.patchMode).toBe(1);
        expect(decoded.stereoCue).toBe(5);
        expect(decoded.transientShape).toBe(1);
    });

    it('round-trips the temporal layout with stereo cue bits', () => {
        const params: SBRParamsTemporal = {
            temporalMode: true,
            patchMode: 3,
            tonality: 2,
            stereoCue: 6,
            bandEnvelope: [-4.5, -1.5, 4.5, 0.5],
            hfGainA: -8,
            quarterDeltaA: 4,
            transientA: 1,
            hfGainB: 6,
            quarterDeltaB: -4,
            transientB: 0
        };

        const decoded = decodeSBRWord(encodeSBRWord(params)) as SBRParamsTemporal;

        expect(decoded.temporalMode).toBe(true);
        expect(decoded.patchMode).toBe(3);
        expect(decoded.tonality).toBe(2);
        expect(decoded.stereoCue).toBe(6);
        expect(decoded.bandEnvelope).toEqual([-4.5, -1.5, 4.5, 0.5]);
        expect(decoded.hfGainA).toBe(-8);
        expect(decoded.quarterDeltaA).toBe(4);
        expect(decoded.transientA).toBe(1);
        expect(decoded.hfGainB).toBe(6);
        expect(decoded.quarterDeltaB).toBe(-4);
        expect(decoded.transientB).toBe(0);
    });

    it('shifts the top band\'s envelope range down', () => {
        const normal = decodeSBRWord(encodeSBRWord({
            temporalMode: false,
            hfGain: 0,
            bandEnvelope: [-20, -20, -20, -20],
            gainDelta: 0,
            tonality: 3,
            patchMode: 0,
            stereoCue: 0,
            transientShape: 0
        }));
        expect(normal.bandEnvelope).toEqual([-6, -6, -6, -10]);

        const temporal = decodeSBRWord(encodeSBRWord({
            temporalMode: true,
            patchMode: 0,
            tonality: 3,
            stereoCue: 0,
            bandEnvelope: [20, 20, 20, 20],
            hfGainA: 0,
            quarterDeltaA: 0,
            transientA: 0,
            hfGainB: 0,
            quarterDeltaB: 0,
            transientB: 0
        }));
        expect(temporal.bandEnvelope).toEqual([4.5, 4.5, 4.5, 0.5]);
    });
});

describe('Stereo SBR Cue Analysis', () => {
    function createStereoRow(rowDataCount: number, midValue: number, sideValue: number) {
        const mid: Float32Array[] = [];
        const side: Float32Array[] = [];

        for (let block = 0; block < rowDataCount; block++) {
            const midBins = new Float32Array(128);
            const sideBins = new Float32Array(128);
            for (let bin = SBR_START_BIN; bin < SBR_END_BIN; bin++) {
                midBins[bin] = midValue;
                sideBins[bin] = sideValue;
            }
            mid.push(midBins);
            side.push(sideBins);
        }

        return { mid, side };
    }

    it('detects positive high-coherence HF for left-only style content', () => {
        const { mid, side } = createStereoRow(4, 1, 1);
        const cues = analyzeStereoRowSbrCues(mid, side, 4);

        expect(cues).toEqual([3, 3]);
    });

    it('detects negative high-coherence HF for right-only style content', () => {
        const { mid, side } = createStereoRow(4, 1, -1);
        const cues = analyzeStereoRowSbrCues(mid, side, 4);

        expect(cues).toEqual([7, 7]);
    });

    it('keeps dominant-band coherence when HF bands disagree in sign', () => {
        const mid: Float32Array[] = [];
        const side: Float32Array[] = [];

        for (let block = 0; block < 4; block++) {
            const midBins = new Float32Array(128);
            const sideBins = new Float32Array(128);

            for (let bin = SBR_START_BIN; bin < SBR_START_BIN + 8; bin++) {
                midBins[bin] = 2.0;
                sideBins[bin] = 2.0;
            }
            for (let bin = SBR_START_BIN + 8; bin < SBR_START_BIN + 16; bin++) {
                midBins[bin] = 1.9;
                sideBins[bin] = -1.9;
            }
            for (let bin = SBR_START_BIN + 16; bin < SBR_START_BIN + 24; bin++) {
                midBins[bin] = 2.0;
                sideBins[bin] = 2.0;
            }
            for (let bin = SBR_START_BIN + 24; bin < SBR_END_BIN; bin++) {
                midBins[bin] = 1.9;
                sideBins[bin] = -1.9;
            }

            mid.push(midBins);
            side.push(sideBins);
        }

        const cues = analyzeStereoRowSbrCues(mid, side, 4);

        expect(cues).toEqual([2, 2]);
    });

    it('preserves coherent mid-side imbalance during projection', () => {
        const mid = new Float32Array(128);
        const side = new Float32Array(128);

        for (let bin = SBR_START_BIN; bin < SBR_END_BIN; bin++) {
            mid[bin] = 0.6;
            side[bin] = 0.4;
        }

        projectStereoCueToHighFrequencies(mid, side, 3);

        for (let bin = SBR_START_BIN; bin < SBR_END_BIN; bin++) {
            expect(mid[bin]).toBeCloseTo(0.6, 6);
            expect(side[bin]).toBeCloseTo(0.4, 6);
            expect(mid[bin] - side[bin]).toBeGreaterThan(0.15);
        }
    });

    it('recomputes band envelopes after stereo patch locking', () => {
        const rowParams: RowSBRParams = {
            subgroups: [
                {
                    temporalMode: false as const,
                    hfGain: 0,
                    bandEnvelope: [8, 8, 8, 8],
                    gainDelta: 0,
                    tonality: 2,
                    patchMode: 0,
                    stereoCue: 0,
                    transientShape: 0
                },
                {
                    temporalMode: false as const,
                    hfGain: 0,
                    bandEnvelope: [8, 8, 8, 8],
                    gainDelta: 0,
                    tonality: 2,
                    patchMode: 0,
                    stereoCue: 0,
                    transientShape: 0
                }
            ]
        };
        const mid: Float32Array[] = [];
        const side: Float32Array[] = [];

        for (let block = 0; block < 4; block++) {
            const midBins = new Float32Array(128);
            const sideBins = new Float32Array(128);

            for (let bin = 32; bin < 64; bin++) {
                midBins[bin] = 1.0;
                sideBins[bin] = 1.0;
            }
            for (let bin = 64; bin < 96; bin++) {
                midBins[bin] = 0.05;
                sideBins[bin] = 0.05;
            }
            for (let bin = SBR_START_BIN; bin < SBR_END_BIN; bin++) {
                midBins[bin] = 1.0;
                sideBins[bin] = 1.0;
            }

            mid.push(midBins);
            side.push(sideBins);
        }

        const locked = lockStereoRowPatchModes(rowParams, rowParams, [3, 3], mid, side, 4);

        for (const subgroup of locked.mid.subgroups) {
            expect(subgroup.patchMode).toBe(2);
            expect(subgroup.bandEnvelope.every(v => Math.abs(v) < 0.1)).toBe(true);
        }
        for (const subgroup of locked.side.subgroups) {
            expect(subgroup.patchMode).toBe(2);
            expect(subgroup.bandEnvelope.every(v => Math.abs(v) < 0.1)).toBe(true);
        }
    });
});

describe('SBR Silence Handling', () => {
    it('mutes a silent highband', () => {
        const blocks: Float32Array[] = [];
        for (let block = 0; block < 4; block++) {
            blocks.push(new Float32Array(128));
        }

        const row = analyzeRowSBR(blocks, 4);
        const subgroup = row.subgroups[0];

        if (subgroup.temporalMode) throw new Error('silent row must not use temporal mode');
        expect(subgroup.hfGain).toBeLessThanOrEqual(-47);
        expect(subgroup.gainDelta).toBe(0);
    });

    it('synthesizes nothing from a silent source band', () => {
        const coeffs = new Float32Array(128);
        const params: SBRParams = {
            temporalMode: false,
            hfGain: 0,
            bandEnvelope: [0, 0, 0, 0],
            gainDelta: 0,
            tonality: 0,
            patchMode: 0,
            stereoCue: 0,
            transientShape: 0
        };

        applySBRSynthesis(coeffs, params, 0, 1);

        for (let bin = SBR_START_BIN; bin < SBR_END_BIN; bin++) {
            expect(coeffs[bin]).toBe(0);
        }
    });
});

describe('SBR Subgroup Partition', () => {
    function makeDistinctRow(rowDataCount: number): Float32Array[] {
        // Subgroup 0 is tonal, subgroup 1 is loud and noisy, so the two
        // analyzed parameter sets are easy to tell apart.
        const { start: split } = getSbrSubgroupRange(rowDataCount, 1);
        const rows: Float32Array[] = [];
        for (let b = 0; b < rowDataCount; b++) {
            const bins = new Float32Array(128);
            const loud = b >= split;
            for (let k = 0; k < 128; k++) {
                bins[k] = loud ? ((k * 7919 + b * 104729) % 97 / 97 - 0.5) * 2.0 : (k % 8 === 0 ? 0.5 : 0.001);
            }
            rows.push(bins);
        }
        return rows;
    }

    it('selects the same subgroup the encoder analyzed for every block of a partial row', () => {
        for (const rowDataCount of [1, 2, 3, 7, 10, 61, 62, 63, 100, DATA_BLOCKS_PER_ROW]) {
            const rowParams = analyzeRowSBR(makeDistinctRow(rowDataCount), rowDataCount);
            const sbrBytes = encodeRowSBR(rowParams);

            for (let col = 0; col < rowDataCount; col++) {
                const expectedIdx = getSbrSubgroupIndexForBlock(rowDataCount, col);
                const { start, end } = getSbrSubgroupRange(rowDataCount, expectedIdx);
                expect(col).toBeGreaterThanOrEqual(start);
                expect(col).toBeLessThan(end);

                const selection = selectSbrParamsForBlock(sbrBytes, col, rowDataCount);
                expect(selection).not.toBeNull();
                expect(selection!.params.patchMode).toBe(rowParams.subgroups[expectedIdx].patchMode);
                expect(selection!.params.temporalMode).toBe(rowParams.subgroups[expectedIdx].temporalMode);
                expect(selection!.blockIdxInSubgroup).toBe(col - start);
                expect(selection!.subgroupSize).toBe(end - start);
            }
        }
    });

    it('matches the fixed 62/62 split for a full row', () => {
        const full = DATA_BLOCKS_PER_ROW;
        expect(getSbrSubgroupRange(full, 0)).toEqual({ start: 0, end: 62 });
        expect(getSbrSubgroupRange(full, 1)).toEqual({ start: 62, end: full });
        expect(getSbrSubgroupIndexForBlock(full, 61)).toBe(0);
        expect(getSbrSubgroupIndexForBlock(full, 62)).toBe(1);
    });
});

describe('SBR Analysis and Synthesis', () => {
    function noiseBlocks(count: number, seed: number, amplitude: (bin: number, block: number) => number): Float32Array[] {
        const rng = createRNG(seed);
        const blocks: Float32Array[] = [];
        for (let b = 0; b < count; b++) {
            const bins = new Float32Array(128);
            for (let k = 0; k < 128; k++) {
                bins[k] = ((rng.nextByte() + rng.nextByte() + rng.nextByte()) / 382.5 - 1) * amplitude(k, b);
            }
            blocks.push(bins);
        }
        return blocks;
    }

    function hfEnergy(blocks: Float32Array[], from = SBR_START_BIN, to = SBR_END_BIN): number {
        let energy = 0;
        for (const bins of blocks) {
            for (let k = from; k < to; k++) energy += bins[k] * bins[k];
        }
        return energy;
    }

    function synthesizeRow(target: Float32Array[], source: Float32Array[], count: number): Float32Array[] {
        const sbrBytes = encodeRowSBR(analyzeRowSBR(target, count, source));
        return source.map((bins, col) => {
            const out = new Float32Array(bins);
            out.fill(0, SBR_START_BIN);
            const selection = selectSbrParamsForBlock(sbrBytes, col, count)!;
            applySBRSynthesis(out, selection.params, selection.blockIdxInSubgroup, selection.subgroupSize);
            return out;
        });
    }

    const toDb = (ratio: number) => 10 * Math.log10(ratio);

    it('recreates the target HF energy whatever tile it patches from', () => {
        // The adjacent tile is much quieter than the lower ones; whichever
        // tile wins, the gain must be relative to that tile.
        const count = 62;
        const blocks = noiseBlocks(count, 11, k => k < 64 ? 1.0 : k < 96 ? 0.02 : 0.2);
        const out = synthesizeRow(blocks, blocks, count);

        expect(Math.abs(toDb(hfEnergy(out) / hfEnergy(blocks)))).toBeLessThan(1.5);
    });

    it('fits the gain to the lowband the decoder will see', () => {
        const count = 62;
        const clean = noiseBlocks(count, 21, k => k < 96 ? 0.05 : 0.1);
        // Transport noise makes the decoded source tile louder than the clean one
        const noise = noiseBlocks(count, 22, () => 0.1);
        const decoded = clean.map((bins, b) => {
            const out = new Float32Array(bins);
            for (let k = 0; k < 96; k++) out[k] += noise[b][k];
            return out;
        });

        const openLoop = analyzeRowSBR(clean, count).subgroups[0] as SBRParams;
        const closedLoop = analyzeRowSBR(clean, count, decoded).subgroups[0] as SBRParams;
        expect(closedLoop.hfGain).toBeLessThan(openLoop.hfGain - 3);

        const out = synthesizeRow(clean, decoded, count);
        expect(Math.abs(toDb(hfEnergy(out) / hfEnergy(clean)))).toBeLessThan(1.5);
    });

    it('whitens a tonal source for a noisy target, and leaves a tonal target alone', () => {
        const count = 62;
        const tonalLow = (k: number) => k < 96 ? (k % 8 === 3 ? 1.0 : 0.01) : 0.3;
        const noisyTarget = analyzeRowSBR(noiseBlocks(count, 31, tonalLow), count).subgroups[0] as SBRParams;
        expect(noisyTarget.tonality).toBeLessThan(3);

        const tonalBoth = (k: number) => k % 8 === 3 ? 1.0 : 0.01;
        const tonalTarget = analyzeRowSBR(noiseBlocks(count, 32, tonalBoth), count).subgroups[0] as SBRParams;
        expect(tonalTarget.tonality).toBe(3);
    });

    it('whitening flattens peaks and keeps each band\'s energy', () => {
        const bins = new Float32Array(128);
        for (let k = 0; k < 128; k++) bins[k] = k % 8 === 3 ? 1.0 : 0.05 * (k % 2 === 0 ? 1 : -1);

        const plain = new Float32Array(32);
        const whitened = new Float32Array(32);
        readSourceTile(bins, 0, 0, plain);
        readSourceTile(bins, 0, 3, whitened);

        for (let band = 0; band < 4; band++) {
            let before = 0;
            let after = 0;
            let peakBefore = 0;
            let peakAfter = 0;
            for (let i = 0; i < 8; i++) {
                before += plain[band * 8 + i] ** 2;
                after += whitened[band * 8 + i] ** 2;
                peakBefore = Math.max(peakBefore, Math.abs(plain[band * 8 + i]));
                peakAfter = Math.max(peakAfter, Math.abs(whitened[band * 8 + i]));
            }
            expect(after).toBeCloseTo(before, 4);
            expect(peakAfter).toBeLessThan(peakBefore * 0.8);
        }
    });

    function synthesizedDb(params: SBRParams | SBRParamsTemporal, block: number, size: number): number {
        const bins = new Float32Array(128);
        for (let k = 56; k < 96; k++) bins[k] = k % 2 === 0 ? 0.5 : -0.5;
        applySBRSynthesis(bins, params, block, size);
        // Bins below the first band centre are interpolated toward the baseband junction
        return toDb(hfEnergy([bins], 104) / hfEnergy([bins], 72, 96));
    }

    it('gives the second half of a normal-mode subgroup its own gain', () => {
        const params: SBRParams = {
            temporalMode: false,
            hfGain: -2,
            bandEnvelope: [0, 0, 0, 0],
            gainDelta: -6,
            tonality: 3,
            patchMode: 0,
            stereoCue: 0,
            transientShape: 0
        };
        for (const size of [8, 9]) {
            const half = Math.floor(size / 2);
            for (let b = 0; b < size; b++) {
                expect(synthesizedDb(params, b, size)).toBeCloseTo(b < half ? -2 : -8, 3);
            }
        }
        // A single block is the second half
        expect(synthesizedDb(params, 0, 1)).toBeCloseTo(-8, 3);
    });

    it('steps the gain between the quarters of each temporal-mode half', () => {
        const params: SBRParamsTemporal = {
            temporalMode: true,
            patchMode: 0,
            tonality: 3,
            stereoCue: 0,
            bandEnvelope: [0, 0, 0, 0],
            hfGainA: 0,
            quarterDeltaA: 8,
            transientA: 0,
            hfGainB: -10,
            quarterDeltaB: -4,
            transientB: 0
        };
        const expected = [-4, -4, 4, 4, -8, -8, -12, -12];
        for (let b = 0; b < 8; b++) {
            expect(synthesizedDb(params, b, 8)).toBeCloseTo(expected[b], 3);
        }
        // Odd sizes: halves of 3 and 4 blocks, the first split 1 + 2
        const expectedOdd = [-4, 4, 4, -8, -8, -12, -12];
        for (let b = 0; b < 7; b++) {
            expect(synthesizedDb(params, b, 7)).toBeCloseTo(expectedOdd[b], 3);
        }
    });

    function quarterErrorsDb(target: Float32Array[], out: Float32Array[], size: number): number[] {
        const half = Math.floor(size / 2);
        const edges = [0, Math.floor(half / 2), half, half + Math.floor((size - half) / 2), size];
        return [0, 1, 2, 3].map(q => toDb(
            hfEnergy(out.slice(edges[q], edges[q + 1])) / hfEnergy(target.slice(edges[q], edges[q + 1]))
        ));
    }

    it('follows a level step between the halves in normal mode', () => {
        const count = 64;
        const blocks = noiseBlocks(count, 51, (k, b) => k < 96 ? 0.3 : (b % 32 < 16 ? 0.1 : 0.2));
        const subgroup = analyzeRowSBR(blocks, count).subgroups[0];

        if (subgroup.temporalMode) throw new Error('a single step fits normal mode');
        expect(subgroup.gainDelta).toBeGreaterThanOrEqual(5);
        expect(subgroup.gainDelta).toBeLessThanOrEqual(7);

        const out = synthesizeRow(blocks, blocks, count);
        for (const error of quarterErrorsDb(blocks, out, 32)) expect(Math.abs(error)).toBeLessThan(1.5);
    });

    it('follows level changes between quarters in temporal mode', () => {
        const count = 64;
        const blocks = noiseBlocks(count, 52, (k, b) => k < 96 ? 0.3 : (b % 16 < 8 ? 0.1 : 0.25));
        const subgroup = analyzeRowSBR(blocks, count).subgroups[0];

        if (!subgroup.temporalMode) throw new Error('quarter-rate changes need temporal mode');
        expect(subgroup.quarterDeltaA).toBe(8);
        expect(subgroup.quarterDeltaB).toBe(8);

        const out = synthesizeRow(blocks, blocks, count);
        // Temporal-mode gains are on a 2 dB grid
        for (const error of quarterErrorsDb(blocks, out, 32)) expect(Math.abs(error)).toBeLessThan(2.5);
    });

    it('fits the audible quarter when the other one is silent', () => {
        const count = 64;
        // Bins next to the highband are silent too, so nothing leaks into its pseudo-spectrum
        const blocks = noiseBlocks(count, 53, (k, b) => k < 88 ? 0.3 : (b % 16 < 8 ? 0 : 0.2));
        const out = synthesizeRow(blocks, blocks, count);
        const errors = quarterErrorsDb(blocks, out, 32);

        expect(Math.abs(errors[1])).toBeLessThan(2.5);
        expect(Math.abs(errors[3])).toBeLessThan(2.5);
    });

    it('transient shapes move energy in time without changing the total', () => {
        const size = 62;
        for (const transientShape of [1, 2, 3]) {
            const params: SBRParams = {
                temporalMode: false,
                hfGain: 0,
                bandEnvelope: [0, 0, 0, 0],
                gainDelta: 0,
                tonality: 3,
                patchMode: 0,
                stereoCue: 0,
                transientShape
            };
            let shaped = 0;
            let flat = 0;
            for (let b = 0; b < size; b++) {
                const bins = new Float32Array(128);
                for (let k = 56; k < 96; k++) bins[k] = k % 2 === 0 ? 0.5 : -0.5;
                const reference = new Float32Array(bins);
                applySBRSynthesis(bins, params, b, size);
                applySBRSynthesis(reference, { ...params, transientShape: 0 }, b, size);
                shaped += hfEnergy([bins]);
                flat += hfEnergy([reference]);
            }
            expect(Math.abs(toDb(shaped / flat))).toBeLessThan(0.2);
        }
    });

    it('picks the impulse shape when the highband swells in the middle of the subgroup', () => {
        const count = 62;
        const blocks = noiseBlocks(count, 41, (k, b) => k < 96 ? 0.3 : 0.3 * (1 - 1.5 * Math.abs((b % 31) / 30 - 0.5)));
        const row = analyzeRowSBR(blocks, count);
        expect(row.subgroups[0].temporalMode).toBe(false);
        expect((row.subgroups[0] as SBRParams).transientShape).toBe(3);
    });
});
