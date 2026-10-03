// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import {
    BLOCKS_PER_ROW,
    DATA_BLOCKS_PER_ROW,
    MDCT_WINDOW_SIZE,
} from '../constants';
import { dct8x8, imdct } from '../utils/audioUtils';
import { AUDIO_PSYCHOACOUSTICS } from '../psychoacoustics';
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
const BLOCK_MAP = AUDIO_PSYCHOACOUSTICS.blockMap;

export interface DecodeBlockBuffers {
    spatialY: Float32Array;
    spatialCb: Float32Array;
    spatialCr: Float32Array;
    dctY: Float32Array;
    dctCb: Float32Array;
    dctCr: Float32Array;
    temp: Float32Array;
}

export interface SelectedSbrParams {
    params: SBRParamsUnion;
    blockIdxInSubgroup: number;
    subgroupSize: number;
}

/**
 * Reads a block's pixels back into its stored MDCT coefficients (bins 0..95):
 * pixel reading, unscaling, DCT, band factor and whitening reversal. SBR
 * synthesis and the IMDCT happen in decodeBlock / decodeStereoBlocks.
 */
export function decodeBlockToCoefficients(
    data: Uint8ClampedArray, width: number, blockIndex: number,
    maxY: number, maxC: number,
    whiteningProfile: MdctWhiteningProfile,
    bandFactors: Float32Array, coeffBuffer: Float32Array,
    buffers: DecodeBlockBuffers
): Float32Array {
    // Check for invalid scaling factors - output silence if any are zero
    if (maxY === 0 || maxC === 0 || bandFactors.some(f => f === 0)) {
        coeffBuffer.fill(0);
        return coeffBuffer;
    }

    const bx = (blockIndex % BLOCKS_PER_ROW) * 8;
    const by = Math.floor(blockIndex / BLOCKS_PER_ROW) * 8;

    // --- STEP 1: READ PIXELS AND APPLY SAFETY MARGIN ---
    buffers.spatialCb.fill(0);
    buffers.spatialCr.fill(0);

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

    // Spatial Unscaling (with numerical stability)
    for (let k = 0; k < 64; k++) {
        buffers.spatialY[k] /= maxY;
        // Clamp extreme values to prevent numerical instability
        buffers.spatialY[k] = Math.max(-1e9, Math.min(1e9, buffers.spatialY[k]));
    }

    // --- STEP 2: DCT TO FREQUENCY DOMAIN ---
    dct8x8(buffers.spatialY, buffers.dctY, buffers.temp);
    dct8x8(buffers.spatialCb, buffers.dctCb, buffers.temp);
    dct8x8(buffers.spatialCr, buffers.dctCr, buffers.temp);

    // --- STEP 3: MAP COEFFICIENTS TO BINS, UNSCALE CHROMA ---
    for (let k = 0; k < 64; k++) {
        coeffBuffer[k] = buffers.dctY[BLOCK_MAP.luma8x8[k]];
    }
    // This block's bins sit at importance rank 4k + ordinal in the shared map
    const ordinal = (Math.floor(blockIndex / BLOCKS_PER_ROW) & 1) * 2 + (blockIndex % 2);
    for (let k = 0; k < 16; k++) {
        const pos = BLOCK_MAP.chroma8x8[4 * k + ordinal];
        coeffBuffer[64 + 2 * k] = Math.max(-1e9, Math.min(1e9, buffers.dctCb[pos] / maxC));
        coeffBuffer[65 + 2 * k] = Math.max(-1e9, Math.min(1e9, buffers.dctCr[pos] / maxC));
    }

    // --- STEP 4: DIVIDE BY BAND FACTORS (REVERSE) ---
    // Use pre-computed bandMap for optimization
    if (AUDIO_PSYCHOACOUSTICS.enableBandNormalization) {
        for (let k = 0; k < 64; k++) {
            coeffBuffer[k] /= bandFactors[BAND_MAP[k]];
        }
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
    rowDataCount: number = DATA_BLOCKS_PER_ROW
): SelectedSbrParams | null {
    if (!AUDIO_PSYCHOACOUSTICS.enableSbr || !sbrBytes || sbrBytes.length !== 8 || colInAudioArea === undefined) {
        return null;
    }

    const rowParams = decodeRowSBR(sbrBytes);
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
    externalSbrSeed?: number,
    rowDataCount: number = DATA_BLOCKS_PER_ROW
): Float32Array {
    decodeBlockToCoefficients(
        data, width, blockIndex, maxY, maxC, whiteningProfile, bandFactors, coeffBuffer, buffers
    );

    const selection = selectSbrParamsForBlock(sbrBytes, colInAudioArea, rowDataCount);
    if (selection) {
        applySBRSynthesis(
            coeffBuffer,
            selection.params,
            selection.blockIdxInSubgroup,
            selection.subgroupSize,
            externalSbrSeed
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
        buffers
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
        buffers
    );

    const midSelection = selectSbrParamsForBlock(midBlock.sbrBytes, colInAudioArea, rowDataCount);
    const sideSelection = selectSbrParamsForBlock(sideBlock.sbrBytes, colInAudioArea, rowDataCount);

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
            sideSeed
        );
    } else if (midSelection) {
        applySBRSynthesis(
            midBlock.coeffBuffer,
            midSelection.params,
            midSelection.blockIdxInSubgroup,
            midSelection.subgroupSize,
            midSeed
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
            sideSeed
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
