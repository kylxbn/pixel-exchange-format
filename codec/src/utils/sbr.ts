// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { FORMAT_VERSION } from '../constants';

// Constants

export const SBR_START_BIN = 96;
export const SBR_END_BIN = 128;
export const SBR_NUM_BINS = 32;

/**
 * Number of subgroups per row for SBR purposes.
 * Each row has 2 subgroups, each gets 4 bytes (32 bits) of SBR parameters.
 */
export const SBR_SUBGROUPS_PER_ROW = 2;
export const SBR_BYTES_PER_ROW = 8;

/**
 * Patch Mode Names (source frequency selection)
 */
export const PATCH_MODE_NAMES = [
    'Adjacent',   // Copy from bins 64-95
    'Lower',      // Copy from bins 48-79 (2x expansion)
    'Bass',       // Copy from bins 32-63 (3x expansion)
    'Mirror'      // Copy from bins 64-95 in reverse
];

/**
 * Transient Shape Names (normal mode `transientShape`)
 */
export const TRANSIENT_SHAPE_NAMES = [
    'Flat',
    'Attack',
    'Decay',
    'Impulse'
];

/**
 * Processing Mode Names
 */
export const PROCESSING_MODE_NAMES = [
    'Normal',     // Standard tonal/noise mixing
    'Transient',  // Preserve transients, noise only in silence
    'Harmonic',   // Cubic shaping for harmonic enhancement
    'Inverse'     // Invert odd samples for decorrelation
];

const STEREO_COHERENCE_AMOUNTS = [0.0, 0.33, 0.67, 1.0] as const;
const STEREO_COHERENCE_THRESHOLDS = [0.20, 0.50, 0.80] as const;
const STEREO_RESIDUAL_SCALES = [1.0, 0.7, 0.35, 0.0] as const;
const SBR_SILENCE_RMS_THRESHOLD = 1e-4;
const SBR_SILENCE_ENERGY_PER_BIN = SBR_SILENCE_RMS_THRESHOLD * SBR_SILENCE_RMS_THRESHOLD;

// Normal Mode: 6 bits = 64 steps, 1dB each (-48 to +15)
const GAIN_STEP_DB_NORMAL = 1.0;
const MIN_GAIN_DB = -48.0;
const MAX_GAIN_DB = 15.0;

// Temporal Mode: 5 bits = 32 steps, 2dB each (-48 to +14)
const GAIN_STEP_DB_TEMPORAL = 2.0;

// Band envelope: Normal=3 bits/band, Temporal=2 bits/band
const BAND_ENV_STEP_DB_NORMAL = 2.0;  // 8 steps: -6 to +8dB
const BAND_ENV_STEP_DB_TEMPORAL = 3.0; // 4 steps: -4.5 to +4.5dB
const BAND_ENV_MIN_DB = -6.0;
const BAND_ENV_MIN_DB_TEMPORAL = -4.5;

// Data Structures

/**
 * SBR Parameters for Normal Mode (full precision)
 */
export interface SBRParams {
    temporalMode: boolean;    // false = normal mode
    hfGain: number;           // dB (-48 to +15)
    bandEnvelope: number[];   // 4 bands, each in dB relative adjustment
    noiseFloorRatio: number;  // 0-15 (0 = pure tone, 15 = pure noise)
    tonality: number;         // 0-7 in v300, 0-3 in v301+
    patchMode: number;        // 0-3 (source frequency selection)
    procMode: number;         // 0-3 (legacy v300 processing mode)
    stereoCue: number;        // 0-7 (v301+ stereo HF cue)
    transientShape: number;   // 0-3 (temporal envelope) - Normal only
}

/**
 * SBR Parameters for Temporal Mode (2* update rate for fast params)
 */
export interface SBRParamsTemporal {
    temporalMode: true;
    // Shared (slow-changing) parameters
    patchMode: number;        // 0-3
    procMode: number;         // 0-3 (legacy v300 processing mode)
    tonality: number;         // 0-3 (reduced precision)
    stereoCue: number;        // 0-7 (v301+ stereo HF cue)
    bandEnvelope: number[];   // 4 bands * 2 bits each (reduced precision)

    // Fast parameters (first half of subgroup)
    hfGainA: number;          // dB (5 bits, 2dB steps)
    noiseFloorRatioA: number; // 0-3 (reduced)
    transientA: number;       // 0-1 (attack or not)

    // Fast parameters (second half of subgroup)
    hfGainB: number;
    noiseFloorRatioB: number;
    transientB: number;
}

export type SBRParamsUnion = SBRParams | SBRParamsTemporal;

export interface RowSBRParams {
    subgroups: [SBRParamsUnion, SBRParamsUnion];
}

export interface StereoSbrCueInfo {
    raw: number;
    sign: number;
    coherenceClass: number;
    sharedAmount: number;
    residualScale: number;
}

export interface SbrSubgroupRange {
    start: number;
    end: number;
}

/**
 * Block range [start, end) covered by an SBR subgroup within a row.
 * Subgroups are split relative to the row's actual data block count, so a
 * partial (last) row still gets two subgroups. The decoder must use the same
 * partition to pick the parameters the encoder analyzed for each block.
 */
export function getSbrSubgroupRange(rowDataCount: number, subgroupIdx: number): SbrSubgroupRange {
    const blocksPerSubgroup = Math.max(1, Math.floor(rowDataCount / SBR_SUBGROUPS_PER_ROW));
    const start = subgroupIdx * blocksPerSubgroup;
    const end = (subgroupIdx === SBR_SUBGROUPS_PER_ROW - 1)
        ? rowDataCount
        : Math.min(rowDataCount, (subgroupIdx + 1) * blocksPerSubgroup);
    return { start, end };
}

export function getSbrSubgroupIndexForBlock(rowDataCount: number, colInRow: number): number {
    const blocksPerSubgroup = Math.max(1, Math.floor(rowDataCount / SBR_SUBGROUPS_PER_ROW));
    return Math.min(SBR_SUBGROUPS_PER_ROW - 1, Math.floor(colInRow / blocksPerSubgroup));
}

// Encoding / Decoding

/**
 * v300 Normal Mode Bit Layout (32 bits, flag=0):
 *   [31:26] hfGain        - 6 bits  (1dB steps, -48 to +15)
 *   [25:14] bandEnvelope  - 12 bits (4 bands * 3 bits)
 *   [13:10] noiseFloor    - 4 bits
 *   [9:7]   tonality      - 3 bits
 *   [6:5]   patchMode     - 2 bits
 *   [4:3]   procMode      - 2 bits
 *   [2:1]   transient     - 2 bits
 *   [0]     mode flag     - 1 bit = 0
 * 
 * v300 Temporal Mode Bit Layout (32 bits, flag=1):
 *   [31:30] patchMode     - 2 bits (shared)
 *   [29:28] procMode      - 2 bits (shared)
 *   [27:26] tonality      - 2 bits (shared, reduced)
 *   [25:18] bandEnvelope  - 8 bits (4 bands * 2 bits, shared, reduced)
 *   [17:13] hfGainA       - 5 bits (first half)
 *   [12:11] noiseFloorA   - 2 bits (first half)
 *   [10]    transientA    - 1 bit (first half)
 *   [9:5]   hfGainB       - 5 bits (second half)
 *   [4:3]   noiseFloorB   - 2 bits (second half)
 *   [2]     transientB    - 1 bit (second half)
 *   [1]     reserved      - 1 bit
 *   [0]     mode flag     - 1 bit = 1
 *
 * v301+ Normal Mode Bit Layout (32 bits, flag=0):
 *   [31:26] hfGain        - 6 bits
 *   [25:14] bandEnvelope  - 12 bits
 *   [13:10] noiseFloor    - 4 bits
 *   [9:8]   tonality      - 2 bits
 *   [7:5]   stereo cue    - 3 bits
 *   [4:3]   patchMode     - 2 bits
 *   [2:1]   transient     - 2 bits
 *   [0]     mode flag     - 1 bit = 0
 *
 * v301+ Temporal Mode Bit Layout (32 bits, flag=1):
 *   [31:29] stereo cue    - 3 bits
 *   [28:27] patchMode     - 2 bits
 *   [26:25] tonality      - 2 bits
 *   [24:17] bandEnvelope  - 8 bits
 *   [16:12] hfGainA       - 5 bits
 *   [11:10] noiseFloorA   - 2 bits
 *   [9]     transientA    - 1 bit
 *   [8:4]   hfGainB       - 5 bits
 *   [3:2]   noiseFloorB   - 2 bits
 *   [1]     transientB    - 1 bit
 *   [0]     mode flag     - 1 bit = 1
 */

export function encodeSBRWord(params: SBRParamsUnion, formatVersion: number = FORMAT_VERSION): number {
    if (formatVersion >= 301) {
        return params.temporalMode
            ? encodeSBRWordTemporalV301(params as SBRParamsTemporal)
            : encodeSBRWordNormalV301(params as SBRParams);
    }

    if (params.temporalMode) {
        return encodeSBRWordTemporalLegacy(params as SBRParamsTemporal);
    } else {
        return encodeSBRWordNormalLegacy(params as SBRParams);
    }
}

function encodeSBRWordNormalLegacy(params: SBRParams): number {
    // Quantize gain (6 bits)
    let gainIdx = Math.round((params.hfGain - MIN_GAIN_DB) / GAIN_STEP_DB_NORMAL);
    gainIdx = Math.max(0, Math.min(63, gainIdx));

    // Quantize band envelopes (12 bits total)
    let bandBits = 0;
    for (let b = 0; b < 4; b++) {
        let envIdx = Math.round((params.bandEnvelope[b] - BAND_ENV_MIN_DB) / BAND_ENV_STEP_DB_NORMAL);
        envIdx = Math.max(0, Math.min(7, envIdx));
        bandBits |= (envIdx << (b * 3));
    }

    return ((gainIdx & 0x3F) << 26) |
        ((bandBits & 0xFFF) << 14) |
        ((params.noiseFloorRatio & 0x0F) << 10) |
        ((params.tonality & 0x07) << 7) |
        ((params.patchMode & 0x03) << 5) |
        ((params.procMode & 0x03) << 3) |
        ((params.transientShape & 0x03) << 1) |
        0; // mode flag = 0
}

function encodeSBRWordTemporalLegacy(params: SBRParamsTemporal): number {
    // Quantize gains (5 bits each)
    let gainIdxA = Math.round((params.hfGainA - MIN_GAIN_DB) / GAIN_STEP_DB_TEMPORAL);
    gainIdxA = Math.max(0, Math.min(31, gainIdxA));

    let gainIdxB = Math.round((params.hfGainB - MIN_GAIN_DB) / GAIN_STEP_DB_TEMPORAL);
    gainIdxB = Math.max(0, Math.min(31, gainIdxB));

    // Quantize band envelopes (8 bits total, 2 bits per band)
    let bandBits = 0;
    for (let b = 0; b < 4; b++) {
        let envIdx = Math.round((params.bandEnvelope[b] - BAND_ENV_MIN_DB_TEMPORAL) / BAND_ENV_STEP_DB_TEMPORAL);
        envIdx = Math.max(0, Math.min(3, envIdx));
        bandBits |= (envIdx << (b * 2));
    }

    return ((params.patchMode & 0x03) << 30) |
        ((params.procMode & 0x03) << 28) |
        ((params.tonality & 0x03) << 26) |
        ((bandBits & 0xFF) << 18) |
        ((gainIdxA & 0x1F) << 13) |
        ((params.noiseFloorRatioA & 0x03) << 11) |
        ((params.transientA & 0x01) << 10) |
        ((gainIdxB & 0x1F) << 5) |
        ((params.noiseFloorRatioB & 0x03) << 3) |
        ((params.transientB & 0x01) << 2) |
        // bit 1 reserved
        1; // mode flag = 1
}

function encodeSBRWordNormalV301(params: SBRParams): number {
    let gainIdx = Math.round((params.hfGain - MIN_GAIN_DB) / GAIN_STEP_DB_NORMAL);
    gainIdx = Math.max(0, Math.min(63, gainIdx));

    let bandBits = 0;
    for (let b = 0; b < 4; b++) {
        let envIdx = Math.round((params.bandEnvelope[b] - BAND_ENV_MIN_DB) / BAND_ENV_STEP_DB_NORMAL);
        envIdx = Math.max(0, Math.min(7, envIdx));
        bandBits |= (envIdx << (b * 3));
    }

    const tonality = Math.max(0, Math.min(3, params.tonality));
    const stereoCue = Math.max(0, Math.min(7, params.stereoCue));

    return ((gainIdx & 0x3F) << 26) |
        ((bandBits & 0xFFF) << 14) |
        ((params.noiseFloorRatio & 0x0F) << 10) |
        ((tonality & 0x03) << 8) |
        ((stereoCue & 0x07) << 5) |
        ((params.patchMode & 0x03) << 3) |
        ((params.transientShape & 0x03) << 1);
}

function encodeSBRWordTemporalV301(params: SBRParamsTemporal): number {
    let gainIdxA = Math.round((params.hfGainA - MIN_GAIN_DB) / GAIN_STEP_DB_TEMPORAL);
    gainIdxA = Math.max(0, Math.min(31, gainIdxA));

    let gainIdxB = Math.round((params.hfGainB - MIN_GAIN_DB) / GAIN_STEP_DB_TEMPORAL);
    gainIdxB = Math.max(0, Math.min(31, gainIdxB));

    let bandBits = 0;
    for (let b = 0; b < 4; b++) {
        let envIdx = Math.round((params.bandEnvelope[b] - BAND_ENV_MIN_DB_TEMPORAL) / BAND_ENV_STEP_DB_TEMPORAL);
        envIdx = Math.max(0, Math.min(3, envIdx));
        bandBits |= (envIdx << (b * 2));
    }

    const tonality = Math.max(0, Math.min(3, params.tonality));
    const stereoCue = Math.max(0, Math.min(7, params.stereoCue));

    return ((stereoCue & 0x07) << 29) |
        ((params.patchMode & 0x03) << 27) |
        ((tonality & 0x03) << 25) |
        ((bandBits & 0xFF) << 17) |
        ((gainIdxA & 0x1F) << 12) |
        ((params.noiseFloorRatioA & 0x03) << 10) |
        ((params.transientA & 0x01) << 9) |
        ((gainIdxB & 0x1F) << 4) |
        ((params.noiseFloorRatioB & 0x03) << 2) |
        ((params.transientB & 0x01) << 1) |
        1;
}

export function decodeSBRWord(word: number, formatVersion: number = FORMAT_VERSION): SBRParamsUnion {
    const modeFlag = word & 1;
    if (formatVersion >= 301) {
        return modeFlag === 1 ? decodeSBRWordTemporalV301(word) : decodeSBRWordNormalV301(word);
    }

    if (modeFlag === 1) {
        return decodeSBRWordTemporalLegacy(word);
    } else {
        return decodeSBRWordNormalLegacy(word);
    }
}

function decodeSBRWordNormalLegacy(word: number): SBRParams {
    const gainIdx = (word >>> 26) & 0x3F;
    const bandBits = (word >>> 14) & 0xFFF;

    const bandEnvelope: number[] = [];
    for (let b = 0; b < 4; b++) {
        const envIdx = (bandBits >>> (b * 3)) & 0x07;
        bandEnvelope.push((envIdx * BAND_ENV_STEP_DB_NORMAL) + BAND_ENV_MIN_DB);
    }

    return {
        temporalMode: false,
        hfGain: (gainIdx * GAIN_STEP_DB_NORMAL) + MIN_GAIN_DB,
        bandEnvelope,
        noiseFloorRatio: (word >>> 10) & 0x0F,
        tonality: (word >>> 7) & 0x07,
        patchMode: (word >>> 5) & 0x03,
        procMode: (word >>> 3) & 0x03,
        stereoCue: 0,
        transientShape: (word >>> 1) & 0x03
    };
}

function decodeSBRWordTemporalLegacy(word: number): SBRParamsTemporal {
    const bandBits = (word >>> 18) & 0xFF;

    const bandEnvelope: number[] = [];
    for (let b = 0; b < 4; b++) {
        const envIdx = (bandBits >>> (b * 2)) & 0x03;
        bandEnvelope.push((envIdx * BAND_ENV_STEP_DB_TEMPORAL) + BAND_ENV_MIN_DB_TEMPORAL);
    }

    return {
        temporalMode: true,
        patchMode: (word >>> 30) & 0x03,
        procMode: (word >>> 28) & 0x03,
        tonality: (word >>> 26) & 0x03,
        stereoCue: 0,
        bandEnvelope,
        hfGainA: (((word >>> 13) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioA: (word >>> 11) & 0x03,
        transientA: (word >>> 10) & 0x01,
        hfGainB: (((word >>> 5) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioB: (word >>> 3) & 0x03,
        transientB: (word >>> 2) & 0x01
    };
}

function decodeSBRWordNormalV301(word: number): SBRParams {
    const gainIdx = (word >>> 26) & 0x3F;
    const bandBits = (word >>> 14) & 0xFFF;

    const bandEnvelope: number[] = [];
    for (let b = 0; b < 4; b++) {
        const envIdx = (bandBits >>> (b * 3)) & 0x07;
        bandEnvelope.push((envIdx * BAND_ENV_STEP_DB_NORMAL) + BAND_ENV_MIN_DB);
    }

    return {
        temporalMode: false,
        hfGain: (gainIdx * GAIN_STEP_DB_NORMAL) + MIN_GAIN_DB,
        bandEnvelope,
        noiseFloorRatio: (word >>> 10) & 0x0F,
        tonality: (word >>> 8) & 0x03,
        patchMode: (word >>> 3) & 0x03,
        procMode: 0,
        stereoCue: (word >>> 5) & 0x07,
        transientShape: (word >>> 1) & 0x03
    };
}

function decodeSBRWordTemporalV301(word: number): SBRParamsTemporal {
    const bandBits = (word >>> 17) & 0xFF;

    const bandEnvelope: number[] = [];
    for (let b = 0; b < 4; b++) {
        const envIdx = (bandBits >>> (b * 2)) & 0x03;
        bandEnvelope.push((envIdx * BAND_ENV_STEP_DB_TEMPORAL) + BAND_ENV_MIN_DB_TEMPORAL);
    }

    return {
        temporalMode: true,
        patchMode: (word >>> 27) & 0x03,
        procMode: 0,
        tonality: (word >>> 25) & 0x03,
        stereoCue: (word >>> 29) & 0x07,
        bandEnvelope,
        hfGainA: (((word >>> 12) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioA: (word >>> 10) & 0x03,
        transientA: (word >>> 9) & 0x01,
        hfGainB: (((word >>> 4) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioB: (word >>> 2) & 0x03,
        transientB: (word >>> 1) & 0x01
    };
}

export function encodeRowSBR(rowParams: RowSBRParams, formatVersion: number = FORMAT_VERSION): Uint8Array {
    const bytes = new Uint8Array(SBR_BYTES_PER_ROW);
    for (let i = 0; i < SBR_SUBGROUPS_PER_ROW; i++) {
        const word = encodeSBRWord(rowParams.subgroups[i], formatVersion);
        // Big-endian encoding (4 bytes per word)
        bytes[i * 4 + 0] = (word >>> 24) & 0xFF;
        bytes[i * 4 + 1] = (word >>> 16) & 0xFF;
        bytes[i * 4 + 2] = (word >>> 8) & 0xFF;
        bytes[i * 4 + 3] = word & 0xFF;
    }
    return bytes;
}

export function decodeRowSBR(bytes: Uint8Array, formatVersion: number = FORMAT_VERSION): RowSBRParams {
    if (bytes.length !== SBR_BYTES_PER_ROW) {
        throw new Error(`Invalid SBR bytes length: expected ${SBR_BYTES_PER_ROW}, got ${bytes.length}`);
    }
    const subgroups: SBRParamsUnion[] = [];
    for (let i = 0; i < SBR_SUBGROUPS_PER_ROW; i++) {
        const word = (bytes[i * 4] << 24) | (bytes[i * 4 + 1] << 16) |
            (bytes[i * 4 + 2] << 8) | bytes[i * 4 + 3];
        subgroups.push(decodeSBRWord(word, formatVersion));
    }
    return { subgroups: subgroups as [SBRParamsUnion, SBRParamsUnion] };
}

export function decodeStereoSbrCue(cue: number): StereoSbrCueInfo {
    const raw = Math.max(0, Math.min(7, cue | 0));
    const sign = (raw >>> 2) & 0x01;
    const coherenceClass = raw & 0x03;

    return {
        raw,
        sign,
        coherenceClass,
        sharedAmount: STEREO_COHERENCE_AMOUNTS[coherenceClass],
        residualScale: STEREO_RESIDUAL_SCALES[coherenceClass]
    };
}

// Deterministic Noise Generator

function getDeterministicNoise(seed: number, binIndex: number): number {
    let h = Math.imul(seed ^ binIndex, 0x1B873593);
    h = Math.imul(h ^ (h >>> 13), 0x5D588B65);
    h = Math.imul(h ^ (h >>> 15), 0x1B873593);
    return ((h >>> 0) / 4294967296.0) * 2.0 - 1.0;
}

// Synthesis

// First source bin of each patch mode's 32-bin tile (mode 3 mirrors mode 0's tile)
const PATCH_SOURCE_OFFSETS = [64, 48, 32, 64] as const;

function patchSourceIndex(patchMode: number, j: number): number {
    if (patchMode === 3) {
        // Pair-swapped mirror preserves Even/Odd parity
        return PATCH_SOURCE_OFFSETS[3] + (j % 2 === 0 ? 30 - j : 32 - j);
    }
    return PATCH_SOURCE_OFFSETS[patchMode] + j;
}

/**
 * Reads the 32-bin source tile of a patch mode. whiteningLevel 0..3 flattens
 * the tile by compressing every bin's magnitude with the exponent
 * 1 - level/3 (level 3 leaves only the signs), so a tonal lowband can stand
 * in for a noisier highband. Each 8-bin band keeps its energy, so gains mean
 * the same at every level.
 */
export function readSourceTile(mdctCoeffs: Float32Array, patchMode: number, whiteningLevel: number, tile: Float32Array): void {
    for (let j = 0; j < SBR_NUM_BINS; j++) {
        tile[j] = mdctCoeffs[patchSourceIndex(patchMode, j)];
    }
    if (whiteningLevel <= 0) return;

    const exponent = 1 - Math.min(3, whiteningLevel) / 3;

    for (let band = 0; band < 4; band++) {
        let energy = 0;
        let whitenedEnergy = 0;
        for (let j = band * 8; j < band * 8 + 8; j++) {
            const magnitude = Math.abs(tile[j]);
            energy += magnitude * magnitude;
            tile[j] = magnitude > 1e-12 ? Math.sign(tile[j]) * Math.pow(magnitude, exponent) : 0;
            whitenedEnergy += tile[j] * tile[j];
        }
        const scale = whitenedEnergy > 1e-20 ? Math.sqrt(energy / whitenedEnergy) : 0;
        for (let j = band * 8; j < band * 8 + 8; j++) tile[j] *= scale;
    }
}

// RMS of each transient shape over its span, so v301 shapes keep the energy
// the gain was fitted for
const TRANSIENT_SHAPE_RMS = [1.0, Math.sqrt(7 / 12), Math.sqrt(7 / 12), Math.sqrt(7 / 16)] as const;

function transientShapeGain(shape: number, position: number, normalized: boolean): number {
    let gain = 1.0;
    switch (shape) {
        case 1: // Attack
            gain = 0.5 + 0.5 * position;
            break;
        case 2: // Decay
            gain = 1.0 - 0.5 * position;
            break;
        case 3: // Impulse
            gain = 1.0 - Math.abs(position - 0.5) * 1.5;
            break;
    }
    return normalized ? gain / TRANSIENT_SHAPE_RMS[shape & 3] : gain;
}

/**
 * Synthesizes HF bins (96-127) based on mode.
 * For temporal mode, selects A or B parameters based on block position.
 */
export function applySBRSynthesis(
    mdctCoeffs: Float32Array,
    params: SBRParamsUnion,
    blockIndexInSubgroup: number = 0,
    subgroupSize: number = 1,
    externalSeed?: number,
    formatVersion: number = FORMAT_VERSION
): void {
    const synthParams = resolveSynthesisParams(params, blockIndexInSubgroup, subgroupSize, formatVersion);
    synthesizeBlock(mdctCoeffs, synthParams, externalSeed, formatVersion);
}

interface SynthesisParams {
    hfGain: number;
    bandEnvelope: number[];
    // Fraction of the HF energy replaced by noise (0..1)
    noiseRatio: number;
    // Position (0..1) inside the span the transient shape runs over, or
    // null when the span is a single block
    shapePosition: number | null;
    tonality: number;
    patchMode: number;
    procMode: number;
    stereoCue: number;
    transientShape: number;
}

function resolveSynthesisParams(
    params: SBRParamsUnion,
    blockIndexInSubgroup: number,
    subgroupSize: number,
    formatVersion: number
): SynthesisParams {
    const spanPosition = (index: number, size: number) => size > 1 ? index / (size - 1) : null;

    if (params.temporalMode) {
        const temporal = params as SBRParamsTemporal;
        const halfSize = Math.floor(subgroupSize / 2);
        const isSecondHalf = blockIndexInSubgroup >= halfSize;
        const noiseFloorRatio = isSecondHalf ? temporal.noiseFloorRatioB : temporal.noiseFloorRatioA;

        return {
            hfGain: isSecondHalf ? temporal.hfGainB : temporal.hfGainA,
            // v300 read the 2-bit temporal field on the 4-bit scale
            noiseRatio: Math.min(1.0, noiseFloorRatio / (formatVersion >= 301 ? 3.0 : 15.0)),
            transientShape: isSecondHalf ? temporal.transientB : temporal.transientA,
            // v301 runs the shape over the half it was analyzed on
            shapePosition: formatVersion >= 301
                ? (isSecondHalf
                    ? spanPosition(blockIndexInSubgroup - halfSize, subgroupSize - halfSize)
                    : spanPosition(blockIndexInSubgroup, halfSize))
                : spanPosition(blockIndexInSubgroup, subgroupSize),
            bandEnvelope: temporal.bandEnvelope,
            tonality: temporal.tonality,
            patchMode: temporal.patchMode,
            procMode: formatVersion >= 301 ? 0 : temporal.procMode,
            stereoCue: temporal.stereoCue
        };
    }

    const normal = params as SBRParams;
    return {
        hfGain: normal.hfGain,
        bandEnvelope: normal.bandEnvelope,
        noiseRatio: Math.min(1.0, normal.noiseFloorRatio / 15.0),
        shapePosition: spanPosition(blockIndexInSubgroup, subgroupSize),
        tonality: normal.tonality,
        patchMode: normal.patchMode,
        procMode: formatVersion >= 301 ? 0 : normal.procMode,
        stereoCue: normal.stereoCue,
        transientShape: normal.transientShape
    };
}

function synthesizeBlock(
    mdctFull: Float32Array,
    params: SynthesisParams,
    externalSeed?: number,
    formatVersion: number = FORMAT_VERSION,
    unitNoiseProvider?: (destIdx: number) => number
): void {
    const isV301 = formatVersion >= 301;
    const noiseRatio = params.noiseRatio;
    const toneRatio = 1.0 - noiseRatio;
    // v300 used tonality as a second tone/noise mix control. In v301 it
    // selects how much the source tile is whitened and the mix is set by
    // the noise ratio alone.
    const tonalityFactor = isV301 ? 1.0 : Math.min(1.0, params.tonality / 7.0);

    // Temporal envelope multiplier
    const temporalMult = params.shapePosition === null
        ? 1.0
        : transientShapeGain(params.transientShape, params.shapePosition, isV301);

    // Content-based seed or external seed
    const frameSeed = externalSeed !== undefined ? externalSeed : Math.floor(
        Math.abs(mdctFull[4]) * 10000 +
        Math.abs(mdctFull[32]) * 20000 +
        Math.abs(mdctFull[60]) * 30000
    ) | 0;

    // Source offset
    const srcOffset = PATCH_SOURCE_OFFSETS[params.patchMode];
    const mirror = params.patchMode === 3;

    const sourceTile = new Float32Array(SBR_NUM_BINS);
    readSourceTile(mdctFull, params.patchMode, isV301 ? 3 - Math.min(3, params.tonality) : 0, sourceTile);

    // --- Interpolation setup ---

    // 1. Calculate source RMS and target gains for each band
    const bandGainsDb = new Float32Array(4);
    const bandSourceRMS = new Float32Array(4);
    const bandActualSourceRMS = new Float32Array(4);

    for (let b = 0; b < 4; b++) {
        const bandStart = b * 8;
        let srcEnergy = 0;
        for (let i = 0; i < 8; i++) {
            srcEnergy += sourceTile[bandStart + i] ** 2;
        }
        const actualSourceRMS = Math.sqrt(srcEnergy / 8);
        const floor = (noiseRatio > 0.5) ? 0.001 : 1e-9;
        bandActualSourceRMS[b] = actualSourceRMS;
        bandSourceRMS[b] = actualSourceRMS + floor;

        // Total gain for this band in dB
        bandGainsDb[b] = params.hfGain + params.bandEnvelope[b];
    }

    // 2. Junction Gain (from baseband to first SBR band)
    // We want the gain at the very start of SBR to be continuous with the baseband.
    let junctionGainDb = 0;
    if (mirror) {
        junctionGainDb = bandGainsDb[0];
    } else {
        let basebandEnergy = 0;
        let basebandSrcEnergy = 0;
        for (let i = 0; i < 8; i++) {
            const destIdx = 88 + i;
            let srcIdx = srcOffset - 8 + i;
            if (srcIdx < 0) srcIdx = 0;
            basebandEnergy += mdctFull[destIdx] ** 2;
            basebandSrcEnergy += mdctFull[srcIdx] ** 2;
        }
        if (basebandSrcEnergy > 1e-9 && basebandEnergy > 1e-9) {
            junctionGainDb = 20 * Math.log10(Math.sqrt(basebandEnergy / basebandSrcEnergy));
            // Clamp junction gain to avoid extreme jumps if source is silent but target isn't
            junctionGainDb = Math.max(bandGainsDb[0] - 6, Math.min(bandGainsDb[0] + 6, junctionGainDb));
        } else {
            junctionGainDb = bandGainsDb[0];
        }
    }

    // 3. Define control points (x = bin index, y = gain in dB)
    // Junction point: 95.5 (edge of baseband)
    const ctrlX = [95.5, 99.5, 107.5, 115.5, 123.5];
    const ctrlY = [junctionGainDb, bandGainsDb[0], bandGainsDb[1], bandGainsDb[2], bandGainsDb[3]];

    // --- Main Synthesis loop ---

    for (let b = 0; b < 4; b++) {
        const bandStart = b * 8;
        const srcRMS = bandSourceRMS[b]; // Still use band RMS for noise/mix logic
        const actualSrcRMS = bandActualSourceRMS[b];
        const floor = (noiseRatio > 0.5) ? 0.001 : 1e-9;

        for (let i = 0; i < 8; i++) {
            const destIdx = SBR_START_BIN + bandStart + i;

            // Interpolate gain in dB
            let interpolatedGainDb = ctrlY[4]; // Default to last band center
            for (let c = 0; c < 4; c++) {
                if (destIdx >= ctrlX[c] && destIdx < ctrlX[c + 1]) {
                    const t = (destIdx - ctrlX[c]) / (ctrlX[c + 1] - ctrlX[c]);
                    interpolatedGainDb = ctrlY[c] * (1 - t) + ctrlY[c + 1] * t;
                    break;
                }
            }

            const finalGainLin = Math.pow(10, interpolatedGainDb / 20) * temporalMult;

            if (actualSrcRMS <= SBR_SILENCE_RMS_THRESHOLD) {
                mdctFull[destIdx] = 0;
                continue;
            }

            let val = sourceTile[bandStart + i];

            // Processing modes
            if (params.procMode === 2) {
                const safeRMS = Math.max(srcRMS, 1e-6);
                const norm = val / (safeRMS * 2.0);
                val = (norm * norm * norm) * (safeRMS * 2.0);
            } else if (params.procMode === 3) {
                if (i & 1) val = -val;
            }

            // Mix with energy preservation: wTonal^2 + wNoisy^2 = 1.0
            // Since getDeterministicNoise has RMS of 1/sqrt(3), 
            // we multiply by sqrt(3) ~= 1.732 to normalize noise to RMS 1.0.
            const SCALE_SQRT3 = Math.sqrt(3.0);
            let finalVal: number;
            if (params.procMode === 1) {
                const noiseSample = unitNoiseProvider ? unitNoiseProvider(destIdx) : getDeterministicNoise(frameSeed, destIdx);
                if (srcRMS <= floor * 1.1 && noiseRatio > 0.5) {
                    finalVal = noiseSample * srcRMS * SCALE_SQRT3;
                } else {
                    finalVal = val;
                }
            } else {
                // Determine weights
                const wTonal = Math.sqrt(tonalityFactor * toneRatio);
                const wNoisy = Math.sqrt((1.0 - tonalityFactor) * toneRatio + noiseRatio);

                // Normalize noise power
                const noiseSample = unitNoiseProvider ? unitNoiseProvider(destIdx) : getDeterministicNoise(frameSeed, destIdx);
                const noise = noiseSample * srcRMS * SCALE_SQRT3;
                finalVal = (val * wTonal) + (noise * wNoisy);
            }

            mdctFull[destIdx] = finalVal * finalGainLin;
        }
    }
}

export function applyJointStereoSBRSynthesis(
    midCoeffs: Float32Array,
    sideCoeffs: Float32Array,
    midParamsUnion: SBRParamsUnion,
    sideParamsUnion: SBRParamsUnion,
    blockIndexInSubgroup: number = 0,
    subgroupSize: number = 1,
    sharedSeed?: number,
    midSeed?: number,
    sideSeed?: number,
    formatVersion: number = FORMAT_VERSION
): void {
    const midParams = resolveSynthesisParams(midParamsUnion, blockIndexInSubgroup, subgroupSize, formatVersion);
    const sideParams = resolveSynthesisParams(sideParamsUnion, blockIndexInSubgroup, subgroupSize, formatVersion);
    const cue = decodeStereoSbrCue(midParams.stereoCue);
    const sharedMix = Math.sqrt(cue.sharedAmount);
    const independentMix = Math.sqrt(Math.max(0.0, 1.0 - cue.sharedAmount));
    const signFactor = cue.sign === 1 ? -1.0 : 1.0;

    const sharedFrameSeed = sharedSeed ?? ((midSeed ?? 0) ^ (sideSeed ?? 0) ^ 0x9e3779b9);
    const midFrameSeed = midSeed ?? (sharedFrameSeed ^ 0x13579bdf);
    const sideFrameSeed = sideSeed ?? (sharedFrameSeed ^ 0x2468ace0);

    const sharedNoise = (destIdx: number) => getDeterministicNoise(sharedFrameSeed, destIdx);
    const midNoise = (destIdx: number) =>
        (sharedMix * sharedNoise(destIdx)) +
        (independentMix * getDeterministicNoise(midFrameSeed, destIdx));
    const sideNoise = (destIdx: number) =>
        (signFactor * sharedMix * sharedNoise(destIdx)) +
        (independentMix * getDeterministicNoise(sideFrameSeed, destIdx));

    synthesizeBlock(midCoeffs, midParams, midSeed, formatVersion, midNoise);
    synthesizeBlock(sideCoeffs, sideParams, sideSeed, formatVersion, sideNoise);
    projectStereoCueToHighFrequencies(midCoeffs, sideCoeffs, cue);
}

// Analysis

// Noise-like spectra averaged over a subgroup measure about this flat; less
// than this much of a flatness gap is not worth whitening or noise for
const FLATNESS_TOLERANCE = 0.05;
// Switch to temporal mode when the two halves need gains this far apart
const TEMPORAL_GAIN_DELTA_DB = 3.0;
// A transient shape must beat the flat envelope by this factor to be used
const TRANSIENT_SHAPE_MARGIN = 0.9;

/**
 * Pseudo-spectrum power of bin k: MDCT[k]^2 + (MDCT[k+1] - MDCT[k-1])^2,
 * scaled so that it sums to the same energy as MDCT[k]^2 does on average.
 * Unlike the raw MDCT it barely depends on the phase of a stationary tone,
 * so it gives steadier energy and tonality estimates.
 */
function pseudoPower(bins: ArrayLike<number>, k: number, length: number): number {
    const below = k > 0 ? bins[k - 1] : 0;
    const above = k + 1 < length ? bins[k + 1] : 0;
    return (bins[k] * bins[k] + (above - below) * (above - below)) / 3;
}

/** Spectral flatness of time-averaged bin powers, per band, weighted by band energy. */
function bandedFlatness(binPower: Float64Array): number {
    let weighted = 0;
    let total = 0;
    for (let band = 0; band < 4; band++) {
        let logSum = 0;
        let sum = 0;
        for (let i = 0; i < 8; i++) {
            const power = binPower[band * 8 + i];
            logSum += Math.log(power + 1e-20);
            sum += power;
        }
        if (sum <= 1e-18) continue;
        weighted += sum * Math.min(1.0, Math.exp(logSum / 8) / (sum / 8));
        total += sum;
    }
    return total > 0 ? weighted / total : 1.0;
}

interface RangeStats {
    blockCount: number;
    // Pseudo-spectrum energy per block (target, and source tile of each patch mode)
    targetBlock: Float64Array;
    sourceBlock: Float64Array[];
    // Same, per band over the whole range
    targetBand: Float64Array;
    sourceBand: Float64Array[];
    targetTotal: number;
    sourceTotal: number[];
    // Time-averaged target power per HF bin
    targetBins: Float64Array;
}

/**
 * Energy statistics of blocks [start, end). The target is the clean
 * highband; the source is the lowband as the decoder will have it.
 */
function measureRange(
    targetCoeffsArray: Float32Array[],
    sourceCoeffsArray: Float32Array[],
    start: number,
    end: number
): RangeStats {
    const blockCount = Math.max(0, end - start);
    const stats: RangeStats = {
        blockCount,
        targetBlock: new Float64Array(blockCount),
        sourceBlock: [0, 1, 2, 3].map(() => new Float64Array(blockCount)),
        targetBand: new Float64Array(4),
        sourceBand: [0, 1, 2, 3].map(() => new Float64Array(4)),
        targetTotal: 0,
        sourceTotal: [0, 0, 0, 0],
        targetBins: new Float64Array(SBR_NUM_BINS)
    };
    const tile = new Float32Array(SBR_NUM_BINS);

    for (let b = start; b < end; b++) {
        const target = targetCoeffsArray[b];
        const source = sourceCoeffsArray[b];
        if (!target || !source) continue;

        for (let j = 0; j < SBR_NUM_BINS; j++) {
            const power = pseudoPower(target, SBR_START_BIN + j, SBR_END_BIN);
            stats.targetBins[j] += power;
            stats.targetBand[j >> 3] += power;
            stats.targetBlock[b - start] += power;
            stats.targetTotal += power;
        }

        for (let patchMode = 0; patchMode < 4; patchMode++) {
            readSourceTile(source, patchMode, 0, tile);
            for (let j = 0; j < SBR_NUM_BINS; j++) {
                const power = pseudoPower(tile, j, SBR_NUM_BINS);
                stats.sourceBand[patchMode][j >> 3] += power;
                stats.sourceBlock[patchMode][b - start] += power;
                stats.sourceTotal[patchMode] += power;
            }
        }
    }

    for (let j = 0; j < SBR_NUM_BINS; j++) stats.targetBins[j] /= Math.max(1, blockCount);
    return stats;
}

function isSilent(totalEnergy: number, blockCount: number): boolean {
    return totalEnergy / Math.max(1, blockCount * SBR_NUM_BINS) <= SBR_SILENCE_ENERGY_PER_BIN;
}

/** Gain (dB) that brings a patch mode's source tile to the target energy. */
function fitGain(stats: RangeStats, patchMode: number): number {
    const source = stats.sourceTotal[patchMode];
    if (isSilent(stats.targetTotal, stats.blockCount) || source <= 1e-9 || stats.targetTotal <= 1e-9) {
        return MIN_GAIN_DB;
    }
    return Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, 10 * Math.log10(stats.targetTotal / source)));
}

/**
 * How badly a patch mode's band energies fit the target once its own
 * overall gain is applied, i.e. how much the band envelope has to correct.
 */
function patchShapeError(stats: RangeStats, patchMode: number): number {
    const gainLin = Math.pow(10, fitGain(stats, patchMode) / 20);
    let error = 0;
    for (let band = 0; band < 4; band++) {
        const targetMag = Math.sqrt(stats.targetBand[band]);
        const sourceMag = Math.sqrt(stats.sourceBand[patchMode][band]);
        error += (targetMag - sourceMag * gainLin) ** 2;
    }
    return error;
}

function fitBandEnvelope(stats: RangeStats, patchMode: number, gainDb: number, minDb: number, maxDb: number): number[] {
    const bandEnvelope: number[] = [];
    for (let band = 0; band < 4; band++) {
        const target = stats.targetBand[band];
        const source = stats.sourceBand[patchMode][band];
        const bandGainDb = source > 1e-9 && target > 1e-9 ? 10 * Math.log10(target / source) - gainDb : 0;
        bandEnvelope.push(Math.max(minDb, Math.min(maxDb, bandGainDb)));
    }
    return bandEnvelope;
}

/** Transient shape whose envelope best explains the target given the source and gain. */
function fitTransientShape(stats: RangeStats, patchMode: number, gainDb: number, candidates: number[]): number {
    if (stats.blockCount < 2) return 0;

    const gainLin = Math.pow(10, gainDb / 20);
    let bestShape = 0;
    let bestError = Infinity;
    let flatError = Infinity;

    for (const shape of [0, ...candidates]) {
        let error = 0;
        for (let b = 0; b < stats.blockCount; b++) {
            const envelope = transientShapeGain(shape, b / (stats.blockCount - 1), true);
            error += (Math.sqrt(stats.targetBlock[b]) - Math.sqrt(stats.sourceBlock[patchMode][b]) * gainLin * envelope) ** 2;
        }
        if (shape === 0) flatError = error;
        if (error < bestError) {
            bestError = error;
            bestShape = shape;
        }
    }

    return bestError < flatError * TRANSIENT_SHAPE_MARGIN ? bestShape : 0;
}

/**
 * Chooses how to turn the source tile into something as noise-like as the
 * target: first by whitening it (tonality 3 = untouched .. 0 = fully
 * whitened), then by replacing the remaining share with noise.
 */
function fitTonality(
    stats: RangeStats,
    sourceCoeffsArray: Float32Array[],
    start: number,
    end: number,
    patchMode: number
): { tonality: number; noiseRatio: number } {
    const targetFlatness = bandedFlatness(stats.targetBins);
    const tile = new Float32Array(SBR_NUM_BINS);
    const sourceBins = new Float64Array(SBR_NUM_BINS);
    let sourceFlatness = 1.0;
    let level = 0;

    for (; level <= 3; level++) {
        sourceBins.fill(0);
        for (let b = start; b < end; b++) {
            const source = sourceCoeffsArray[b];
            if (!source) continue;
            readSourceTile(source, patchMode, level, tile);
            for (let j = 0; j < SBR_NUM_BINS; j++) sourceBins[j] += pseudoPower(tile, j, SBR_NUM_BINS);
        }
        sourceFlatness = bandedFlatness(sourceBins);
        if (sourceFlatness >= targetFlatness - FLATNESS_TOLERANCE) break;
    }
    level = Math.min(3, level);

    const gap = targetFlatness - sourceFlatness;
    const noiseRatio = gap > FLATNESS_TOLERANCE
        ? Math.max(0, Math.min(1, gap / Math.max(1e-6, 1 - sourceFlatness)))
        : 0;

    return { tonality: 3 - level, noiseRatio };
}

function bestPatchMode(statsList: RangeStats[]): number {
    let best = 0;
    let bestError = Infinity;
    for (let patchMode = 0; patchMode < 4; patchMode++) {
        let error = 0;
        for (const stats of statsList) error += patchShapeError(stats, patchMode);
        if (error < bestError) {
            bestError = error;
            best = patchMode;
        }
    }
    return best;
}

function analyzeSubgroup(
    targetCoeffsArray: Float32Array[],
    sourceCoeffsArray: Float32Array[],
    start: number,
    end: number,
    forcedPatchMode?: number
): SBRParamsUnion {
    const full = measureRange(targetCoeffsArray, sourceCoeffsArray, start, end);
    const patchMode = forcedPatchMode ?? bestPatchMode([full]);

    if (isSilent(full.targetTotal, full.blockCount)) {
        return {
            temporalMode: false,
            hfGain: MIN_GAIN_DB,
            bandEnvelope: [0, 0, 0, 0],
            noiseFloorRatio: 0,
            tonality: 0,
            patchMode: forcedPatchMode ?? 0,
            procMode: 0,
            stereoCue: 0,
            transientShape: 0
        };
    }

    const midpoint = Math.floor((start + end) / 2);
    const halfA = measureRange(targetCoeffsArray, sourceCoeffsArray, start, midpoint);
    const halfB = measureRange(targetCoeffsArray, sourceCoeffsArray, midpoint, end);
    const gainA = fitGain(halfA, patchMode);
    const gainB = fitGain(halfB, patchMode);
    const gain = fitGain(full, patchMode);
    const { tonality, noiseRatio } = fitTonality(full, sourceCoeffsArray, start, end, patchMode);

    // The decoder follows the source's energy block by block, so only a
    // change in the gain it needs calls for the finer time resolution.
    const useTemporalMode = halfA.blockCount > 0 && halfB.blockCount > 0 &&
        Math.abs(gainA - gainB) > TEMPORAL_GAIN_DELTA_DB;

    if (useTemporalMode) {
        const quantize = (value: number) =>
            Math.max(MIN_GAIN_DB, Math.round((value - MIN_GAIN_DB) / GAIN_STEP_DB_TEMPORAL) * GAIN_STEP_DB_TEMPORAL + MIN_GAIN_DB);
        const hfGainA = quantize(gainA);
        const hfGainB = quantize(gainB);
        const noiseFloorRatio = Math.round(noiseRatio * 3);

        return {
            temporalMode: true,
            patchMode,
            procMode: 0,
            tonality,
            stereoCue: 0,
            bandEnvelope: fitBandEnvelope(full, patchMode, gain, BAND_ENV_MIN_DB_TEMPORAL, 4.5),
            hfGainA,
            noiseFloorRatioA: noiseFloorRatio,
            transientA: fitTransientShape(halfA, patchMode, hfGainA, [1]),
            hfGainB,
            noiseFloorRatioB: noiseFloorRatio,
            transientB: fitTransientShape(halfB, patchMode, hfGainB, [1])
        };
    }

    const hfGain = Math.round(gain / GAIN_STEP_DB_NORMAL) * GAIN_STEP_DB_NORMAL;
    return {
        temporalMode: false,
        hfGain,
        bandEnvelope: fitBandEnvelope(full, patchMode, hfGain, BAND_ENV_MIN_DB, 8.0),
        noiseFloorRatio: Math.round(noiseRatio * 15),
        tonality,
        patchMode,
        procMode: 0,
        stereoCue: 0,
        transientShape: fitTransientShape(full, patchMode, hfGain, [1, 2, 3])
    };
}

/**
 * Analyzes a row's SBR parameters. targetCoeffsArray holds the clean MDCT
 * blocks (bins 96..127 are what synthesis should recreate);
 * sourceCoeffsArray holds bins 0..95 as the decoder will read them, so the
 * parameters are fitted to the lowband synthesis actually patches from.
 */
export function analyzeRowSBR(
    targetCoeffsArray: Float32Array[],
    rowDataCount: number,
    sourceCoeffsArray: Float32Array[] = targetCoeffsArray
): RowSBRParams {
    const subgroups: SBRParamsUnion[] = [];

    for (let s = 0; s < SBR_SUBGROUPS_PER_ROW; s++) {
        const { start, end } = getSbrSubgroupRange(rowDataCount, s);

        if (start >= rowDataCount || end <= start) {
            subgroups.push(createDefaultSBRParams());
            continue;
        }

        subgroups.push(analyzeSubgroup(targetCoeffsArray, sourceCoeffsArray, start, end));
    }

    return { subgroups: subgroups as [SBRParamsUnion, SBRParamsUnion] };
}

function analyzeStereoCueRange(
    midMdctCoeffsArray: Float32Array[],
    sideMdctCoeffsArray: Float32Array[],
    start: number,
    end: number
): number {
    let totalWeight = 0;
    let totalCoherenceWeight = 0;
    let positiveCoherenceWeight = 0;
    let negativeCoherenceWeight = 0;

    for (let band = 0; band < 4; band++) {
        let cross = 0;
        let midEnergy = 0;
        let sideEnergy = 0;
        const bandStart = SBR_START_BIN + band * 8;
        const bandEnd = bandStart + 8;

        for (let block = start; block < end; block++) {
            const midBins = midMdctCoeffsArray[block];
            const sideBins = sideMdctCoeffsArray[block];
            if (!midBins || !sideBins) continue;

            for (let bin = bandStart; bin < bandEnd; bin++) {
                const midVal = midBins[bin];
                const sideVal = sideBins[bin];
                cross += midVal * sideVal;
                midEnergy += midVal * midVal;
                sideEnergy += sideVal * sideVal;
            }
        }

        if (midEnergy <= 1e-9 || sideEnergy <= 1e-9) {
            continue;
        }

        const weight = Math.sqrt((midEnergy * sideEnergy) + 1e-9);
        const coherence = Math.min(1.0, Math.abs(cross) / weight);
        totalWeight += weight;
        totalCoherenceWeight += weight * coherence;

        if (cross < 0) {
            negativeCoherenceWeight += weight * coherence;
        } else {
            positiveCoherenceWeight += weight * coherence;
        }
    }

    if (totalWeight <= 1e-9 || totalCoherenceWeight <= 1e-9) {
        return 0;
    }

    const signBit = negativeCoherenceWeight > positiveCoherenceWeight ? 1 : 0;
    const signConsensus = Math.max(positiveCoherenceWeight, negativeCoherenceWeight) / totalCoherenceWeight;
    const averageCoherence = totalCoherenceWeight / totalWeight;
    const coherence = Math.min(1.0, averageCoherence * signConsensus);
    let coherenceClass = 3;
    if (coherence < STEREO_COHERENCE_THRESHOLDS[0]) coherenceClass = 0;
    else if (coherence < STEREO_COHERENCE_THRESHOLDS[1]) coherenceClass = 1;
    else if (coherence < STEREO_COHERENCE_THRESHOLDS[2]) coherenceClass = 2;

    return (signBit << 2) | coherenceClass;
}

/**
 * For subgroups whose highband is strongly correlated between mid and side,
 * makes both channels patch from the same source tile (the one that fits
 * both best) and refits their parameters for it.
 */
export function lockStereoRowPatchModes(
    midRowParams: RowSBRParams,
    sideRowParams: RowSBRParams,
    stereoCues: [number, number],
    midTargetCoeffsArray: Float32Array[],
    sideTargetCoeffsArray: Float32Array[],
    rowDataCount: number,
    midSourceCoeffsArray: Float32Array[] = midTargetCoeffsArray,
    sideSourceCoeffsArray: Float32Array[] = sideTargetCoeffsArray
): { mid: RowSBRParams; side: RowSBRParams } {
    const midSubgroups = [...midRowParams.subgroups] as [SBRParamsUnion, SBRParamsUnion];
    const sideSubgroups = [...sideRowParams.subgroups] as [SBRParamsUnion, SBRParamsUnion];

    for (let subgroup = 0; subgroup < SBR_SUBGROUPS_PER_ROW; subgroup++) {
        const cue = decodeStereoSbrCue(stereoCues[subgroup] ?? 0);
        if (cue.coherenceClass < 2) continue;

        const { start, end } = getSbrSubgroupRange(rowDataCount, subgroup);

        if (start >= rowDataCount || end <= start) continue;

        const patchMode = bestPatchMode([
            measureRange(midTargetCoeffsArray, midSourceCoeffsArray, start, end),
            measureRange(sideTargetCoeffsArray, sideSourceCoeffsArray, start, end)
        ]);

        midSubgroups[subgroup] = analyzeSubgroup(midTargetCoeffsArray, midSourceCoeffsArray, start, end, patchMode);
        sideSubgroups[subgroup] = analyzeSubgroup(sideTargetCoeffsArray, sideSourceCoeffsArray, start, end, patchMode);
    }

    return {
        mid: { subgroups: midSubgroups },
        side: { subgroups: sideSubgroups }
    };
}

export function projectStereoCueToHighFrequencies(
    midCoeffs: Float32Array,
    sideCoeffs: Float32Array,
    cueInfoOrRaw: StereoSbrCueInfo | number
): void {
    const cue = typeof cueInfoOrRaw === 'number' ? decodeStereoSbrCue(cueInfoOrRaw) : cueInfoOrRaw;
    const residualScale = cue.residualScale;
    const signFactor = cue.sign === 1 ? -1.0 : 1.0;

    for (let band = 0; band < 4; band++) {
        const bandStart = SBR_START_BIN + band * 8;
        const bandEnd = bandStart + 8;
        let midEnergy = 0;
        let alignedSideEnergy = 0;

        for (let bin = bandStart; bin < bandEnd; bin++) {
            const midVal = midCoeffs[bin];
            const alignedSide = signFactor * sideCoeffs[bin];
            midEnergy += midVal * midVal;
            alignedSideEnergy += alignedSide * alignedSide;
        }

        let ratio = 1.0;
        if (midEnergy > 1e-12 && alignedSideEnergy > 1e-12) {
            ratio = Math.sqrt(alignedSideEnergy / midEnergy);
        } else if (midEnergy <= 1e-12 && alignedSideEnergy > 1e-12) {
            ratio = 4.0;
        } else if (alignedSideEnergy <= 1e-12 && midEnergy > 1e-12) {
            ratio = 0.25;
        }
        ratio = Math.max(0.25, Math.min(4.0, ratio));

        const axisNormSq = 1.0 + (ratio * ratio);

        for (let bin = bandStart; bin < bandEnd; bin++) {
            const midVal = midCoeffs[bin];
            const sideVal = sideCoeffs[bin];
            const alignedSide = signFactor * sideVal;
            const projectionScale = (midVal + (alignedSide * ratio)) / axisNormSq;
            const projectedMidBase = projectionScale;
            const projectedAlignedSideBase = projectionScale * ratio;
            const midResidual = midVal - projectedMidBase;
            const sideResidual = alignedSide - projectedAlignedSideBase;

            let projectedMid = projectedMidBase + (residualScale * midResidual);
            let projectedAlignedSide = projectedAlignedSideBase + (residualScale * sideResidual);
            let projectedSide = signFactor * projectedAlignedSide;

            const beforeEnergy = (midVal * midVal) + (sideVal * sideVal);
            const afterEnergy = (projectedMid * projectedMid) + (projectedSide * projectedSide);
            if (beforeEnergy > 1e-12 && afterEnergy > 1e-12) {
                const norm = Math.sqrt(beforeEnergy / afterEnergy);
                projectedMid *= norm;
                projectedSide *= norm;
            }

            midCoeffs[bin] = projectedMid;
            sideCoeffs[bin] = projectedSide;
        }
    }
}

export function analyzeStereoRowSbrCues(
    midMdctCoeffsArray: Float32Array[],
    sideMdctCoeffsArray: Float32Array[],
    rowDataCount: number
): [number, number] {
    const cues: number[] = [];

    for (let subgroup = 0; subgroup < SBR_SUBGROUPS_PER_ROW; subgroup++) {
        const { start, end } = getSbrSubgroupRange(rowDataCount, subgroup);

        if (start >= rowDataCount || end <= start) {
            cues.push(0);
            continue;
        }

        cues.push(analyzeStereoCueRange(midMdctCoeffsArray, sideMdctCoeffsArray, start, end));
    }

    return [cues[0] ?? 0, cues[1] ?? 0];
}

export function applyStereoCuesToRowSBR(
    rowParams: RowSBRParams,
    stereoCues: [number, number]
): RowSBRParams {
    const subgroups = rowParams.subgroups.map((subgroup, idx) => ({
        ...subgroup,
        stereoCue: stereoCues[idx] ?? 0
    })) as [SBRParamsUnion, SBRParamsUnion];

    return { subgroups };
}

export function createDefaultSBRParams(): SBRParams {
    return {
        temporalMode: false,
        hfGain: 0,
        bandEnvelope: [0, 0, 0, 0],
        noiseFloorRatio: 4,
        tonality: 2,
        patchMode: 0,
        procMode: 0,
        stereoCue: 0,
        transientShape: 0
    };
}

export function createDefaultRowSBR(): RowSBRParams {
    return {
        subgroups: [createDefaultSBRParams(), createDefaultSBRParams()]
    };
}
