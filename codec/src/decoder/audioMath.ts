// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import {
    BLOCKS_PER_ROW,
    DATA_BLOCKS_PER_ROW,
    FORMAT_VERSION,
    MDCT_WINDOW_SIZE,
} from '../constants';
import { dct4x4, dct8x8, imdct } from '../utils/audioUtils';
import { AUDIO_PSYCHOACOUSTICS, getBlockMapForVersion } from '../psychoacoustics';
import { reverseMdctWhiteningWithProfile } from '../utils/mdctWhitening';
import type { MdctWhiteningProfile } from '../utils/mdctWhitening';
import {
    decodeRowSBR,
    applySBRSynthesis,
    applyJointStereoSBRSynthesis,
    decodeStereoSbrCue,
    getSbrSubgroupIndexForBlock,
    getSbrSubgroupRange,
    SBR_START_BIN,
    SBR_END_BIN,
    type SBRParamsUnion,
} from '../utils/sbr';
import { decodeRGBToPoint } from '../utils/obb';

const BAND_MAP = AUDIO_PSYCHOACOUSTICS.bandMap;

export interface DecodeBlockBuffers {
    spatialY: Float32Array;
    spatialCb: Float32Array;
    spatialCr: Float32Array;
    dctY: Float32Array;
    dctCb: Float32Array;
    dctCr: Float32Array;
    temp: Float32Array;
}

export interface DecodeBlockDebugCapture {
    mdctPreSpatial?: Float32Array;
    mdctAfterSpatial?: Float32Array;
    mdctAfterBand?: Float32Array;
    rawPixelsY?: Float32Array;
    rawPixelsCb?: Float32Array;
    rawPixelsCr?: Float32Array;
}

export interface SelectedSbrParams {
    params: SBRParamsUnion;
    blockIdxInSubgroup: number;
    subgroupSize: number;
}

/**
 * Core YCbCr block decoding function that converts pixel data back to audio samples.
 * Performs the complete decoding pipeline: pixel reading, spatial unscaling, DCT,
 * frequency domain processing, SBR synthesis, and IMDCT to time domain.
 */
export function decodeBlockToCoefficients(
    data: Uint8ClampedArray, width: number, blockIndex: number,
    maxY: number, maxC: number,
    whiteningProfile: MdctWhiteningProfile,
    bandFactors: Float32Array, coeffBuffer: Float32Array,
    buffers: DecodeBlockBuffers,
    debugCapture?: DecodeBlockDebugCapture,
    formatVersion: number = FORMAT_VERSION
): Float32Array {
    // Check for invalid scaling factors - output silence if any are zero
    if (maxY === 0 || maxC === 0 || bandFactors.some(f => f === 0)) {
        coeffBuffer.fill(0);
        return coeffBuffer;
    }

    const isV301 = formatVersion >= 301;
    const blockMap = getBlockMapForVersion(formatVersion);
    const bx = (blockIndex % BLOCKS_PER_ROW) * 8;
    const by = Math.floor(blockIndex / BLOCKS_PER_ROW) * 8;

    // --- STEP 1: READ PIXELS AND APPLY SAFETY MARGIN ---
    buffers.spatialCb.fill(0);
    buffers.spatialCr.fill(0);

    if (isV301) {
        // Chroma lives in a shared 8x8 block spanning the MCU's 2x2 luma group
        // (16x16 px, NN-upsampled). The data area is 16px-aligned, so the
        // MCU origin is the block position rounded down to 16.
        const sbx = bx & ~15;
        const sby = by & ~15;
        const obx = bx - sbx;
        const oby = by - sby;

        for (let y = 0; y < 16; y++) {
            const ly = y - oby;
            for (let x = 0; x < 16; x++) {
                const off = ((sby + y) * width + (sbx + x)) * 4;
                const cIdx = (y >> 1) * 8 + (x >> 1);

                const [p1, p2, p3] = decodeRGBToPoint(data[off], data[off + 1], data[off + 2]);

                buffers.spatialCb[cIdx] += p2;
                buffers.spatialCr[cIdx] += p3;

                const lx = x - obx;
                if (ly >= 0 && ly < 8 && lx >= 0 && lx < 8) {
                    buffers.spatialY[ly * 8 + lx] = p1;
                }
            }
        }

        for (let i = 0; i < 64; i++) {
            buffers.spatialCb[i] /= 4.0;
            buffers.spatialCr[i] /= 4.0;
        }
    } else {
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const off = ((by + y) * width + (bx + x)) * 4;
                const idx = y * 8 + x;
                const cIdx = (y >> 1) * 4 + (x >> 1);

                const [p1, p2, p3] = decodeRGBToPoint(data[off], data[off + 1], data[off + 2]);

                buffers.spatialY[idx] = p1;
                buffers.spatialCb[cIdx] += p2;
                buffers.spatialCr[cIdx] += p3;
            }
        }

        for (let i = 0; i < 16; i++) {
            buffers.spatialCb[i] /= 4.0;
            buffers.spatialCr[i] /= 4.0;
        }
    }

    // CAPTURE: Raw Spatial Pixels
    if (debugCapture) {
        if (debugCapture.rawPixelsY) debugCapture.rawPixelsY.set(buffers.spatialY);
        if (debugCapture.rawPixelsCb) debugCapture.rawPixelsCb.set(buffers.spatialCb.subarray(0, debugCapture.rawPixelsCb.length));
        if (debugCapture.rawPixelsCr) debugCapture.rawPixelsCr.set(buffers.spatialCr.subarray(0, debugCapture.rawPixelsCr.length));
    }

    // Spatial Unscaling (with numerical stability)
    for (let k = 0; k < 64; k++) {
        buffers.spatialY[k] /= maxY;
        // Clamp extreme values to prevent numerical instability
        buffers.spatialY[k] = Math.max(-1e9, Math.min(1e9, buffers.spatialY[k]));
    }
    if (!isV301) {
        // v301 unscales chroma per-coefficient after the DCT
        for (let k = 0; k < 16; k++) {
            buffers.spatialCb[k] /= maxC;
            buffers.spatialCr[k] /= maxC;
            // Clamp extreme values to prevent numerical instability
            buffers.spatialCb[k] = Math.max(-1e9, Math.min(1e9, buffers.spatialCb[k]));
            buffers.spatialCr[k] = Math.max(-1e9, Math.min(1e9, buffers.spatialCr[k]));
        }
    }

    // --- STEP 2: DCT TO FREQUENCY DOMAIN ---
    dct8x8(buffers.spatialY, buffers.dctY, buffers.temp);
    if (isV301) {
        dct8x8(buffers.spatialCb, buffers.dctCb, buffers.temp);
        dct8x8(buffers.spatialCr, buffers.dctCr, buffers.temp);
    } else {
        dct4x4(buffers.spatialCb, buffers.dctCb, buffers.temp);
        dct4x4(buffers.spatialCr, buffers.dctCr, buffers.temp);
    }

    // --- STEP 3: APPLY LUMA/CHROMA SCALING (REVERSE) ---
    for (let k = 0; k < 64; k++) {
        coeffBuffer[k] = buffers.dctY[blockMap.luma8x8[k]];
    }
    if (isV301) {
        // This block's bins sit at importance rank 4k + ordinal in the shared map
        const ordinal = (Math.floor(blockIndex / BLOCKS_PER_ROW) & 1) * 2 + (blockIndex % 2);
        for (let k = 0; k < 16; k++) {
            const pos = blockMap.chroma8x8[4 * k + ordinal];
            coeffBuffer[64 + 2 * k] = Math.max(-1e9, Math.min(1e9, buffers.dctCb[pos] / maxC));
            coeffBuffer[65 + 2 * k] = Math.max(-1e9, Math.min(1e9, buffers.dctCr[pos] / maxC));
        }
    } else {
        for (let k = 0; k < 16; k++) {
            coeffBuffer[64 + 2 * k] = buffers.dctCb[blockMap.chroma4x4[k]];
            coeffBuffer[65 + 2 * k] = buffers.dctCr[blockMap.chroma4x4[k]];
        }
    }

    // CAPTURE: MDCT bins after flat-layout but BEFORE ANY SCALING
    if (debugCapture && debugCapture.mdctPreSpatial) {
        debugCapture.mdctPreSpatial.set(coeffBuffer.subarray(0, 96));
    }

    // CAPTURE: MDCT after spatial scaling reversal
    if (debugCapture && debugCapture.mdctAfterSpatial) {
        debugCapture.mdctAfterSpatial.set(coeffBuffer.subarray(0, 96));
    }

    // --- STEP 4: DIVIDE BY BAND FACTORS (REVERSE) ---
    // Use pre-computed bandMap for optimization
    if (AUDIO_PSYCHOACOUSTICS.enableBandNormalization) {
        for (let k = 0; k < 64; k++) {
            coeffBuffer[k] /= bandFactors[BAND_MAP[k]];
        }
    }

    // CAPTURE: MDCT after band factor reversal
    if (debugCapture && debugCapture.mdctAfterBand) {
        debugCapture.mdctAfterBand.set(coeffBuffer.subarray(0, 96));
    }

    // --- STEP 5: REVERSE STATIC MDCT BIN WHITENING (bins 0..95) ---
    if (AUDIO_PSYCHOACOUSTICS.enableMdctWhitening) {
        reverseMdctWhiteningWithProfile(coeffBuffer, whiteningProfile);
    }

    return coeffBuffer;
}

/**
 * Picks the SBR subgroup parameters for a block. The partition must match
 * analyzeRowSBR, which splits subgroups relative to the row's actual data
 * block count rather than the full DATA_BLOCKS_PER_ROW.
 */
export function selectSbrParamsForBlock(
    sbrBytes: Uint8Array | null,
    colInAudioArea: number,
    formatVersion: number = FORMAT_VERSION,
    rowDataCount: number = DATA_BLOCKS_PER_ROW
): SelectedSbrParams | null {
    if (!AUDIO_PSYCHOACOUSTICS.enableSbr || !sbrBytes || sbrBytes.length !== 8 || colInAudioArea === undefined) {
        return null;
    }

    const rowParams = decodeRowSBR(sbrBytes, formatVersion);
    const subgroupIdx = getSbrSubgroupIndexForBlock(rowDataCount, colInAudioArea);
    const { start, end } = getSbrSubgroupRange(rowDataCount, subgroupIdx);

    return {
        params: rowParams.subgroups[subgroupIdx],
        blockIdxInSubgroup: colInAudioArea - start,
        subgroupSize: Math.max(1, end - start)
    };
}

export function finalizeDecodedBlock(
    coeffBuffer: Float32Array,
    outputWindow: Float32Array,
    mdctWindow: Float32Array
): Float32Array {
    imdct(coeffBuffer, outputWindow);

    for (let k = 0; k < MDCT_WINDOW_SIZE; k++) {
        outputWindow[k] *= mdctWindow[k];
    }

    return outputWindow;
}

export function decodeBlock(
    data: Uint8ClampedArray, width: number, blockIndex: number,
    maxY: number, maxC: number,
    whiteningProfile: MdctWhiteningProfile,
    bandFactors: Float32Array,
    coeffBuffer: Float32Array, outputWindow: Float32Array, mdctWindow: Float32Array,
    buffers: DecodeBlockBuffers,
    sbrBytes: Uint8Array | null,
    colInAudioArea: number,
    debugCapture?: DecodeBlockDebugCapture,
    externalSbrSeed?: number,
    formatVersion: number = FORMAT_VERSION,
    rowDataCount: number = DATA_BLOCKS_PER_ROW
): Float32Array {
    decodeBlockToCoefficients(
        data, width, blockIndex, maxY, maxC, whiteningProfile, bandFactors, coeffBuffer, buffers, debugCapture, formatVersion
    );

    const selection = selectSbrParamsForBlock(sbrBytes, colInAudioArea, formatVersion, rowDataCount);
    if (selection) {
        applySBRSynthesis(
            coeffBuffer,
            selection.params,
            selection.blockIdxInSubgroup,
            selection.subgroupSize,
            externalSbrSeed,
            formatVersion
        );
    } else {
        for (let k = 96; k < 128; k++) {
            coeffBuffer[k] = 0;
        }
    }

    return finalizeDecodedBlock(coeffBuffer, outputWindow, mdctWindow);
}

export function decodeStereoBlocks(
    midBlock: {
        data: Uint8ClampedArray;
        width: number;
        blockIndex: number;
        maxY: number;
        maxC: number;
        whiteningProfile: MdctWhiteningProfile;
        bandFactors: Float32Array;
        coeffBuffer: Float32Array;
        outputWindow: Float32Array;
        sbrBytes: Uint8Array | null;
    },
    sideBlock: {
        data: Uint8ClampedArray;
        width: number;
        blockIndex: number;
        maxY: number;
        maxC: number;
        whiteningProfile: MdctWhiteningProfile;
        bandFactors: Float32Array;
        coeffBuffer: Float32Array;
        outputWindow: Float32Array;
        sbrBytes: Uint8Array | null;
    },
    mdctWindow: Float32Array,
    buffers: DecodeBlockBuffers,
    colInAudioArea: number,
    sharedSeed?: number,
    midSeed?: number,
    sideSeed?: number,
    formatVersion: number = FORMAT_VERSION,
    rowDataCount: number = DATA_BLOCKS_PER_ROW
): { midWindow: Float32Array; sideWindow: Float32Array } {
    decodeBlockToCoefficients(
        midBlock.data,
        midBlock.width,
        midBlock.blockIndex,
        midBlock.maxY,
        midBlock.maxC,
        midBlock.whiteningProfile,
        midBlock.bandFactors,
        midBlock.coeffBuffer,
        buffers,
        undefined,
        formatVersion
    );
    decodeBlockToCoefficients(
        sideBlock.data,
        sideBlock.width,
        sideBlock.blockIndex,
        sideBlock.maxY,
        sideBlock.maxC,
        sideBlock.whiteningProfile,
        sideBlock.bandFactors,
        sideBlock.coeffBuffer,
        buffers,
        undefined,
        formatVersion
    );

    const midSelection = selectSbrParamsForBlock(midBlock.sbrBytes, colInAudioArea, formatVersion, rowDataCount);
    const sideSelection = selectSbrParamsForBlock(sideBlock.sbrBytes, colInAudioArea, formatVersion, rowDataCount);

    if (midSelection && sideSelection) {
        applyJointStereoSBRSynthesis(
            midBlock.coeffBuffer,
            sideBlock.coeffBuffer,
            midSelection.params,
            sideSelection.params,
            midSelection.blockIdxInSubgroup,
            midSelection.subgroupSize,
            sharedSeed,
            midSeed,
            sideSeed,
            formatVersion
        );
    } else if (midSelection) {
        applySBRSynthesis(
            midBlock.coeffBuffer,
            midSelection.params,
            midSelection.blockIdxInSubgroup,
            midSelection.subgroupSize,
            midSeed,
            formatVersion
        );
        deriveMissingStereoHighFrequencies(
            sideBlock.coeffBuffer,
            midBlock.coeffBuffer,
            midSelection.params
        );
    } else if (sideSelection) {
        applySBRSynthesis(
            sideBlock.coeffBuffer,
            sideSelection.params,
            sideSelection.blockIdxInSubgroup,
            sideSelection.subgroupSize,
            sideSeed,
            formatVersion
        );
        deriveMissingStereoHighFrequencies(
            midBlock.coeffBuffer,
            sideBlock.coeffBuffer,
            sideSelection.params
        );
    } else {
        for (let k = 96; k < 128; k++) {
            midBlock.coeffBuffer[k] = 0;
            sideBlock.coeffBuffer[k] = 0;
        }
    }

    return {
        midWindow: finalizeDecodedBlock(midBlock.coeffBuffer, midBlock.outputWindow, mdctWindow),
        sideWindow: finalizeDecodedBlock(sideBlock.coeffBuffer, sideBlock.outputWindow, mdctWindow)
    };
}

function deriveMissingStereoHighFrequencies(
    missingCoeffs: Float32Array,
    validCoeffs: Float32Array,
    validParams: SBRParamsUnion
): void {
    const cue = decodeStereoSbrCue(validParams.stereoCue);
    const signFactor = cue.sign === 1 ? -1.0 : 1.0;
    const sharedAmount = cue.sharedAmount;
    let validEnergy = 0;
    let missingEnergy = 0;

    for (let bin = 64; bin < 96; bin++) {
        validEnergy += validCoeffs[bin] * validCoeffs[bin];
        missingEnergy += missingCoeffs[bin] * missingCoeffs[bin];
    }

    const ratio = validEnergy > 1e-9 ? Math.sqrt(missingEnergy / (validEnergy + 1e-9)) : 0.0;
    for (let bin = SBR_START_BIN; bin < SBR_END_BIN; bin++) {
        missingCoeffs[bin] = signFactor * ratio * sharedAmount * validCoeffs[bin];
    }
}
