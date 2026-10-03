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
    encodeSBRWord,
    type SBRParams,
    type SBRParamsTemporal,
} from './sbr';
import { selectSbrParamsForBlock } from '../decoder/audioMath';
import { DATA_BLOCKS_PER_ROW, FORMAT_VERSION } from '../constants';

describe('SBR Bitfields', () => {
    it('preserves the legacy v300 normal layout', () => {
        const params: SBRParams = {
            temporalMode: false,
            hfGain: -12,
            bandEnvelope: [-6, -4, 0, 8],
            noiseFloorRatio: 9,
            tonality: 6,
            patchMode: 2,
            procMode: 3,
            stereoCue: 0,
            transientShape: 2
        };

        const decoded = decodeSBRWord(encodeSBRWord(params, 300), 300) as SBRParams;

        expect(decoded.temporalMode).toBe(false);
        expect(decoded.hfGain).toBe(-12);
        expect(decoded.bandEnvelope).toEqual([-6, -4, 0, 8]);
        expect(decoded.noiseFloorRatio).toBe(9);
        expect(decoded.tonality).toBe(6);
        expect(decoded.patchMode).toBe(2);
        expect(decoded.procMode).toBe(3);
        expect(decoded.stereoCue).toBe(0);
        expect(decoded.transientShape).toBe(2);
    });

    it('round-trips the v301 normal layout with stereo cue bits', () => {
        const params: SBRParams = {
            temporalMode: false,
            hfGain: -6,
            bandEnvelope: [-6, -2, 2, 8],
            noiseFloorRatio: 11,
            tonality: 3,
            patchMode: 1,
            procMode: 2,
            stereoCue: 5,
            transientShape: 1
        };

        const decoded = decodeSBRWord(encodeSBRWord(params, 301), 301) as SBRParams;

        expect(decoded.temporalMode).toBe(false);
        expect(decoded.hfGain).toBe(-6);
        expect(decoded.bandEnvelope).toEqual([-6, -2, 2, 8]);
        expect(decoded.noiseFloorRatio).toBe(11);
        expect(decoded.tonality).toBe(3);
        expect(decoded.patchMode).toBe(1);
        expect(decoded.procMode).toBe(0);
        expect(decoded.stereoCue).toBe(5);
        expect(decoded.transientShape).toBe(1);
    });

    it('round-trips the v301 temporal layout with stereo cue bits', () => {
        const params: SBRParamsTemporal = {
            temporalMode: true,
            patchMode: 3,
            procMode: 1,
            tonality: 2,
            stereoCue: 6,
            bandEnvelope: [-4.5, -1.5, 1.5, 4.5],
            hfGainA: -8,
            noiseFloorRatioA: 2,
            transientA: 1,
            hfGainB: 6,
            noiseFloorRatioB: 1,
            transientB: 0
        };

        const decoded = decodeSBRWord(encodeSBRWord(params, 301), 301) as SBRParamsTemporal;

        expect(decoded.temporalMode).toBe(true);
        expect(decoded.patchMode).toBe(3);
        expect(decoded.procMode).toBe(0);
        expect(decoded.tonality).toBe(2);
        expect(decoded.stereoCue).toBe(6);
        expect(decoded.bandEnvelope).toEqual([-4.5, -1.5, 1.5, 4.5]);
        expect(decoded.hfGainA).toBe(-8);
        expect(decoded.noiseFloorRatioA).toBe(2);
        expect(decoded.transientA).toBe(1);
        expect(decoded.hfGainB).toBe(6);
        expect(decoded.noiseFloorRatioB).toBe(1);
        expect(decoded.transientB).toBe(0);
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
        const rowParams = {
            subgroups: [
                {
                    temporalMode: false as const,
                    hfGain: 0,
                    bandEnvelope: [8, 8, 8, 8],
                    noiseFloorRatio: 4,
                    tonality: 2,
                    patchMode: 0,
                    procMode: 0,
                    stereoCue: 0,
                    transientShape: 0
                },
                {
                    temporalMode: false as const,
                    hfGain: 0,
                    bandEnvelope: [8, 8, 8, 8],
                    noiseFloorRatio: 4,
                    tonality: 2,
                    patchMode: 0,
                    procMode: 0,
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
    it('does not classify silent HF as noisy content', () => {
        const blocks: Float32Array[] = [];
        for (let block = 0; block < 4; block++) {
            blocks.push(new Float32Array(128));
        }

        const row = analyzeRowSBR(blocks, 4);
        const subgroup = row.subgroups[0];

        expect(subgroup.temporalMode).toBe(false);
        expect(subgroup.hfGain).toBeLessThanOrEqual(-47);
        expect(subgroup.noiseFloorRatio).toBe(0);
        expect(subgroup.tonality).toBe(0);
    });

    it('does not synthesize HF noise from a silent source band', () => {
        const coeffs = new Float32Array(128);
        const params: SBRParams = {
            temporalMode: false,
            hfGain: 0,
            bandEnvelope: [0, 0, 0, 0],
            noiseFloorRatio: 15,
            tonality: 0,
            patchMode: 0,
            procMode: 0,
            stereoCue: 0,
            transientShape: 0
        };

        applySBRSynthesis(coeffs, params, 0, 1, 12345, 301);

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

                const selection = selectSbrParamsForBlock(sbrBytes, col, FORMAT_VERSION, rowDataCount);
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
