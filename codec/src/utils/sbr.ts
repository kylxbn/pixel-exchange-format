// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

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
 * Processing Mode Names
 */
export const PROCESSING_MODE_NAMES = [
    'Normal',     // Standard tonal/noise mixing
    'Transient',  // Preserve transients, noise only in silence
    'Harmonic',   // Cubic shaping for harmonic enhancement
    'Inverse'     // Invert odd samples for decorrelation
];

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
    tonality: number;         // 0-7 (0 = noisy, 7 = pure harmonic)
    patchMode: number;        // 0-3 (source frequency selection)
    procMode: number;         // 0-3 (processing mode)
    transientShape: number;   // 0-3 (temporal envelope) - Normal only
}

/**
 * SBR Parameters for Temporal Mode (2* update rate for fast params)
 */
export interface SBRParamsTemporal {
    temporalMode: true;
    // Shared (slow-changing) parameters
    patchMode: number;        // 0-3
    procMode: number;         // 0-3
    tonality: number;         // 0-3 (reduced precision)
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

// Encoding / Decoding

/**
 * Normal Mode Bit Layout (32 bits, flag=0):
 *   [31:26] hfGain        - 6 bits  (1dB steps, -48 to +15)
 *   [25:14] bandEnvelope  - 12 bits (4 bands * 3 bits)
 *   [13:10] noiseFloor    - 4 bits
 *   [9:7]   tonality      - 3 bits
 *   [6:5]   patchMode     - 2 bits
 *   [4:3]   procMode      - 2 bits
 *   [2:1]   transient     - 2 bits
 *   [0]     mode flag     - 1 bit = 0
 * 
 * Temporal Mode Bit Layout (32 bits, flag=1):
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
 */

export function encodeSBRWord(params: SBRParamsUnion): number {
    if (params.temporalMode) {
        return encodeSBRWordTemporal(params as SBRParamsTemporal);
    } else {
        return encodeSBRWordNormal(params as SBRParams);
    }
}

function encodeSBRWordNormal(params: SBRParams): number {
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

function encodeSBRWordTemporal(params: SBRParamsTemporal): number {
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

export function decodeSBRWord(word: number): SBRParamsUnion {
    const modeFlag = word & 1;
    if (modeFlag === 1) {
        return decodeSBRWordTemporal(word);
    } else {
        return decodeSBRWordNormal(word);
    }
}

function decodeSBRWordNormal(word: number): SBRParams {
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
        transientShape: (word >>> 1) & 0x03
    };
}

function decodeSBRWordTemporal(word: number): SBRParamsTemporal {
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
        bandEnvelope,
        hfGainA: (((word >>> 13) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioA: (word >>> 11) & 0x03,
        transientA: (word >>> 10) & 0x01,
        hfGainB: (((word >>> 5) & 0x1F) * GAIN_STEP_DB_TEMPORAL) + MIN_GAIN_DB,
        noiseFloorRatioB: (word >>> 3) & 0x03,
        transientB: (word >>> 2) & 0x01
    };
}

export function encodeRowSBR(rowParams: RowSBRParams): Uint8Array {
    const bytes = new Uint8Array(SBR_BYTES_PER_ROW);
    for (let i = 0; i < SBR_SUBGROUPS_PER_ROW; i++) {
        const word = encodeSBRWord(rowParams.subgroups[i]);
        // Big-endian encoding (4 bytes per word)
        bytes[i * 4 + 0] = (word >>> 24) & 0xFF;
        bytes[i * 4 + 1] = (word >>> 16) & 0xFF;
        bytes[i * 4 + 2] = (word >>> 8) & 0xFF;
        bytes[i * 4 + 3] = word & 0xFF;
    }
    return bytes;
}

export function decodeRowSBR(bytes: Uint8Array): RowSBRParams {
    if (bytes.length !== SBR_BYTES_PER_ROW) {
        throw new Error(`Invalid SBR bytes length: expected ${SBR_BYTES_PER_ROW}, got ${bytes.length}`);
    }
    const subgroups: SBRParamsUnion[] = [];
    for (let i = 0; i < SBR_SUBGROUPS_PER_ROW; i++) {
        const word = (bytes[i * 4] << 24) | (bytes[i * 4 + 1] << 16) |
            (bytes[i * 4 + 2] << 8) | bytes[i * 4 + 3];
        subgroups.push(decodeSBRWord(word));
    }
    return { subgroups: subgroups as [SBRParamsUnion, SBRParamsUnion] };
}

// Deterministic Noise Generator

function getDeterministicNoise(seed: number, binIndex: number): number {
    let h = Math.imul(seed ^ binIndex, 0x1B873593);
    h = Math.imul(h ^ (h >>> 13), 0x5D588B65);
    h = Math.imul(h ^ (h >>> 15), 0x1B873593);
    return ((h >>> 0) / 4294967296.0) * 2.0 - 1.0;
}

// Synthesis

/**
 * Synthesizes HF bins (96-127) based on mode.
 * For temporal mode, selects A or B parameters based on block position.
 */
export function applySBRSynthesis(
    mdctCoeffs: Float32Array,
    params: SBRParamsUnion,
    blockIndexInSubgroup: number = 0,
    subgroupSize: number = 1,
    externalSeed?: number
): void {
    if (params.temporalMode) {
        const temporal = params as SBRParamsTemporal;
        const isSecondHalf = blockIndexInSubgroup >= Math.floor(subgroupSize / 2);

        // Convert temporal params to synthesis params
        const synthParams = {
            hfGain: isSecondHalf ? temporal.hfGainB : temporal.hfGainA,
            noiseFloorRatio: isSecondHalf ? temporal.noiseFloorRatioB : temporal.noiseFloorRatioA,
            transientShape: isSecondHalf ? temporal.transientB : temporal.transientA,
            bandEnvelope: temporal.bandEnvelope,
            tonality: temporal.tonality,
            patchMode: temporal.patchMode,
            procMode: temporal.procMode
        };

        synthesizeBlock(mdctCoeffs, synthParams, blockIndexInSubgroup, subgroupSize, externalSeed);
    } else {
        const normal = params as SBRParams;
        synthesizeBlock(mdctCoeffs, normal, blockIndexInSubgroup, subgroupSize, externalSeed);
    }
}

interface SynthesisParams {
    hfGain: number;
    bandEnvelope: number[];
    noiseFloorRatio: number;
    tonality: number;
    patchMode: number;
    procMode: number;
    transientShape: number;
}

function synthesizeBlock(
    mdctFull: Float32Array,
    params: SynthesisParams,
    blockIndexInSubgroup: number,
    subgroupSize: number,
    externalSeed?: number
): void {
    // Scale noise ratio based on precision (temporal mode has 2 bits, normal has 4)
    const noiseRatio = Math.min(1.0, params.noiseFloorRatio / 15.0);
    const toneRatio = 1.0 - noiseRatio;
    const tonalityFactor = Math.min(1.0, params.tonality / 7.0);

    // Temporal envelope multiplier
    let temporalMult = 1.0;
    if (subgroupSize > 1) {
        const t = blockIndexInSubgroup / (subgroupSize - 1);
        switch (params.transientShape) {
            case 1: // Attack
                temporalMult = 0.5 + 0.5 * t;
                break;
            case 2: // Decay
                temporalMult = 1.0 - 0.5 * t;
                break;
            case 3: // Impulse
                temporalMult = 1.0 - Math.abs(t - 0.5) * 1.5;
                break;
        }
    }

    // Content-based seed or external seed
    const frameSeed = externalSeed !== undefined ? externalSeed : Math.floor(
        Math.abs(mdctFull[4]) * 10000 +
        Math.abs(mdctFull[32]) * 20000 +
        Math.abs(mdctFull[60]) * 30000
    ) | 0;

    // Source offset
    let srcOffset = 64;
    let mirror = false;

    switch (params.patchMode) {
        case 0: srcOffset = 64; break;
        case 1: srcOffset = 48; break;
        case 2: srcOffset = 32; break;
        case 3: srcOffset = 64; mirror = true; break;
    }

    // --- Interpolation setup ---

    // 1. Calculate source RMS and target gains for each band
    const bandGainsDb = new Float32Array(4);
    const bandSourceRMS = new Float32Array(4);

    for (let b = 0; b < 4; b++) {
        const bandStart = b * 8;
        let srcEnergy = 0;
        for (let i = 0; i < 8; i++) {
            const j = bandStart + i;
            let srcIdx = srcOffset + j;
            if (mirror) {
                // Pair-swapped mirror preserves Even/Odd parity
                srcIdx = srcOffset + (j % 2 === 0 ? 30 - j : 32 - j);
            }
            srcEnergy += mdctFull[srcIdx] ** 2;
        }
        const floor = (noiseRatio > 0.5) ? 0.001 : 1e-9;
        bandSourceRMS[b] = Math.sqrt(srcEnergy / 8) + floor;

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

            const j = bandStart + i;
            let srcReadIdx = srcOffset + j;
            if (mirror) {
                // Pair-swapped mirror preserves Even/Odd parity
                srcReadIdx = srcOffset + (j % 2 === 0 ? 30 - j : 32 - j);
            }
            let val = mdctFull[srcReadIdx];

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
                if (srcRMS <= floor * 1.1 && noiseRatio > 0.5) {
                    finalVal = getDeterministicNoise(frameSeed, destIdx) * srcRMS * SCALE_SQRT3;
                } else {
                    finalVal = val;
                }
            } else {
                // Determine weights
                const wTonal = Math.sqrt(tonalityFactor * toneRatio);
                const wNoisy = Math.sqrt((1.0 - tonalityFactor) * toneRatio + noiseRatio);

                // Normalize noise power
                const noise = getDeterministicNoise(frameSeed, destIdx) * srcRMS * SCALE_SQRT3;
                finalVal = (val * wTonal) + (noise * wNoisy);
            }

            mdctFull[destIdx] = finalVal * finalGainLin;
        }
    }
}

// Analysis

/**
 * Analyzes a row and decides whether to use Normal or Temporal mode.
 * Uses Temporal mode when energy variation within subgroup is high.
 */
export function analyzeRowSBR(
    mdctCoeffsArray: Float32Array[],
    rowDataCount: number,
): RowSBRParams {
    const subgroups: SBRParamsUnion[] = [];
    const blocksPerSubgroup = Math.max(1, Math.floor(rowDataCount / SBR_SUBGROUPS_PER_ROW));

    for (let s = 0; s < SBR_SUBGROUPS_PER_ROW; s++) {
        const start = s * blocksPerSubgroup;
        const end = (s === SBR_SUBGROUPS_PER_ROW - 1)
            ? rowDataCount
            : Math.min(rowDataCount, (s + 1) * blocksPerSubgroup);

        if (start >= rowDataCount || end <= start) {
            subgroups.push(createDefaultSBRParams());
            continue;
        }

        const midpoint = Math.floor((start + end) / 2);

        // Analyze first and second halves separately
        const analysisA = analyzeHalfSubgroup(mdctCoeffsArray, start, midpoint);
        const analysisB = analyzeHalfSubgroup(mdctCoeffsArray, midpoint, end);
        const analysisFull = analyzeHalfSubgroup(mdctCoeffsArray, start, end);

        // Decide mode: use temporal if gain varies significantly between halves
        const gainDelta = Math.abs(analysisA.hfGain - analysisB.hfGain);
        const energyVariation = Math.abs(analysisA.totalEnergy - analysisB.totalEnergy) /
            (Math.max(analysisA.totalEnergy, analysisB.totalEnergy) + 1e-9);

        const useTemporalMode = gainDelta > 4.0 || energyVariation > 0.5;

        if (useTemporalMode) {
            // Temporal mode: use per-half analysis
            const temporal: SBRParamsTemporal = {
                temporalMode: true,
                patchMode: analysisFull.patchMode,
                procMode: 0,
                tonality: Math.min(3, Math.round(analysisFull.tonality / 2)),
                bandEnvelope: analysisFull.bandEnvelope.map(v =>
                    Math.max(BAND_ENV_MIN_DB_TEMPORAL, Math.min(4.5, v))
                ),
                hfGainA: analysisA.hfGain,
                noiseFloorRatioA: Math.min(3, Math.round(analysisA.noiseFloorRatio / 4)),
                transientA: analysisA.transientShape > 0 ? 1 : 0,
                hfGainB: analysisB.hfGain,
                noiseFloorRatioB: Math.min(3, Math.round(analysisB.noiseFloorRatio / 4)),
                transientB: analysisB.transientShape > 0 ? 1 : 0
            };
            subgroups.push(temporal);
        } else {
            // Normal mode: use full analysis
            const normal: SBRParams = {
                temporalMode: false,
                hfGain: analysisFull.hfGain,
                bandEnvelope: analysisFull.bandEnvelope,
                noiseFloorRatio: analysisFull.noiseFloorRatio,
                tonality: analysisFull.tonality,
                patchMode: analysisFull.patchMode,
                procMode: 0,
                transientShape: analysisFull.transientShape
            };
            subgroups.push(normal);
        }
    }

    return { subgroups: subgroups as [SBRParamsUnion, SBRParamsUnion] };
}

interface SubgroupAnalysis {
    hfGain: number;
    bandEnvelope: number[];
    noiseFloorRatio: number;
    tonality: number;
    patchMode: number;
    transientShape: number;
    totalEnergy: number;
}

function analyzeHalfSubgroup(
    mdctCoeffsArray: Float32Array[],
    start: number,
    end: number
): SubgroupAnalysis {
    if (end <= start) {
        return {
            hfGain: MIN_GAIN_DB,
            bandEnvelope: [0, 0, 0, 0],
            noiseFloorRatio: 4,
            tonality: 4,
            patchMode: 0,
            transientShape: 0,
            totalEnergy: 0
        };
    }

    const targetBandEnergy = new Float32Array(4);
    const sourceBandEnergy = new Float32Array(4);

    // Track sum of energies
    let totalTargetEnergy = 0;
    let totalSourceEnergy = 0;

    let prevEnergy = 0;
    let energyRise = 0;
    let energyFall = 0;

    for (let b = start; b < end; b++) {
        const bins = mdctCoeffsArray[b];
        let blockTargetEnergy = 0;
        let blockSourceEnergy = 0;

        for (let band = 0; band < 4; band++) {
            const bandStart = SBR_START_BIN + band * 8;
            for (let i = 0; i < 8; i++) {
                const val = bins[bandStart + i];
                targetBandEnergy[band] += val * val;
                blockTargetEnergy += val * val;
            }
        }

        for (let band = 0; band < 4; band++) {
            const bandStart = 64 + band * 8;
            for (let i = 0; i < 8; i++) {
                const val = bins[bandStart + i];
                sourceBandEnergy[band] += val * val;
                blockSourceEnergy += val * val;
            }
        }

        totalTargetEnergy += blockTargetEnergy;
        totalSourceEnergy += blockSourceEnergy;

        if (b > start) {
            const delta = blockTargetEnergy - prevEnergy;
            if (delta > 0) energyRise += delta;
            else energyFall -= delta;
        }
        prevEnergy = blockTargetEnergy;
    }

    // Transient shape detection
    let transientShape = 0;
    const maxDelta = Math.max(energyRise, energyFall);
    const isTransient = maxDelta > totalTargetEnergy * 0.3;
    if (isTransient) {
        if (energyRise > energyFall * 2) transientShape = 1;      // Attack
        else if (energyFall > energyRise * 2) transientShape = 2; // Decay
        else transientShape = 3;                                  // Impulse
    }

    // HF gain calculation
    // Base gain from average energy ratio
    let hfGain = 0;
    if (totalSourceEnergy > 1e-9 && totalTargetEnergy > 1e-9) {
        const ratio = Math.sqrt(totalTargetEnergy / totalSourceEnergy);
        hfGain = 20 * Math.log10(ratio);
    }

    hfGain = Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, hfGain));

    // Tonality from spectral flatness
    let spectralFlatness = 0;
    const blockCount = end - start;
    if (blockCount > 0) {
        let geomMean = 0;
        let arithMean = 0;
        let count = 0;
        for (let b = start; b < end; b++) {
            const bins = mdctCoeffsArray[b];
            for (let i = SBR_START_BIN; i < SBR_END_BIN; i++) {
                const mag = Math.abs(bins[i]) + 1e-10;
                geomMean += Math.log(mag);
                arithMean += mag;
                count++;
            }
        }
        if (count > 0) {
            geomMean = Math.exp(geomMean / count);
            arithMean = arithMean / count;
            spectralFlatness = geomMean / (arithMean + 1e-10);
        }
    }

    const tonality = Math.round((1.0 - Math.min(1.0, spectralFlatness)) * 7);
    const noiseFloorRatio = Math.round(spectralFlatness * 15);

    // Patch mode selection
    let bestPatchMode = 0;
    let bestPatchError = Infinity;
    const overallGainLin = Math.pow(10, hfGain / 20);

    for (let patchMode = 0; patchMode < 4; patchMode++) {
        let patchError = 0;
        const srcOffset = [64, 48, 32, 64][patchMode];
        const mirror = patchMode === 3;

        for (let band = 0; band < 4; band++) {
            let patchSourceEnergy = 0;
            for (let b = start; b < end; b++) {
                const bins = mdctCoeffsArray[b];
                const bandStart = band * 8;
                for (let i = 0; i < 8; i++) {
                    const j = bandStart + i;
                    let srcIdx = srcOffset + j;
                    if (mirror) {
                        srcIdx = srcOffset + (j % 2 === 0 ? 30 - j : 32 - j);
                    }
                    patchSourceEnergy += bins[srcIdx] ** 2;
                }
            }
            const targetMag = Math.sqrt(targetBandEnergy[band]);
            const sourceMag = Math.sqrt(patchSourceEnergy);
            const scaledSource = sourceMag * overallGainLin;
            patchError += (targetMag - scaledSource) ** 2;
        }

        if (patchError < bestPatchError) {
            bestPatchError = patchError;
            bestPatchMode = patchMode;
        }
    }

    // Band envelope - Recalculate based on chosen patch mode!
    const bandEnvelope: number[] = [];
    const chosenSrcOffset = [64, 48, 32, 64][bestPatchMode];
    const chosenMirror = bestPatchMode === 3;

    for (let band = 0; band < 4; band++) {
        let patchSourceEnergy = 0;
        for (let b = start; b < end; b++) {
            const bins = mdctCoeffsArray[b];
            const bandStart = band * 8;
            for (let i = 0; i < 8; i++) {
                const j = bandStart + i;
                let srcIdx = chosenSrcOffset + j;
                if (chosenMirror) {
                    // Pair-swapped mirror preserves Even/Odd parity
                    srcIdx = chosenSrcOffset + (j % 2 === 0 ? 30 - j : 32 - j);
                }
                patchSourceEnergy += bins[srcIdx] ** 2;
            }
        }

        let bandGainDb = 0;
        if (patchSourceEnergy > 1e-9 && targetBandEnergy[band] > 1e-9) {
            const bandRatio = Math.sqrt(targetBandEnergy[band] / (patchSourceEnergy + 1e-12));
            const idealBandGain = 20 * Math.log10(bandRatio);
            bandGainDb = idealBandGain - hfGain;
        }
        bandGainDb = Math.max(BAND_ENV_MIN_DB, Math.min(8.0, bandGainDb));
        bandEnvelope.push(bandGainDb);
    }

    return {
        hfGain,
        bandEnvelope,
        noiseFloorRatio,
        tonality,
        patchMode: bestPatchMode,
        transientShape,
        totalEnergy: totalTargetEnergy
    };
}

export function createDefaultSBRParams(): SBRParams {
    return {
        temporalMode: false,
        hfGain: 0,
        bandEnvelope: [0, 0, 0, 0],
        noiseFloorRatio: 4,
        tonality: 4,
        patchMode: 0,
        procMode: 0,
        transientShape: 0
    };
}

export function createDefaultRowSBR(): RowSBRParams {
    return {
        subgroups: [createDefaultSBRParams(), createDefaultSBRParams()]
    };
}
