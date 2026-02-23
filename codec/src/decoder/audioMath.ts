// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import {
    BLOCKS_PER_ROW,
    DATA_BLOCKS_PER_ROW,
    MDCT_WINDOW_SIZE,
} from '../constants';
import { dct4x4, dct8x8, imdct } from '../utils/audioUtils';
import {
    AUDIO_PSYCHOACOUSTICS,
} from '../psychoacoustics';
import { reverseMdctWhiteningWithProfile } from '../utils/mdctWhitening';
import type { MdctWhiteningProfile } from '../utils/mdctWhitening';
import { decodeRowSBR, applySBRSynthesis, SBR_SUBGROUPS_PER_ROW } from '../utils/sbr';
import { decodeRGBToPoint } from '../utils/obb';

const BAND_MAP = AUDIO_PSYCHOACOUSTICS.bandMap;
const BLOCK_MAP_8X8 = AUDIO_PSYCHOACOUSTICS.blockMap.luma8x8;
const BLOCK_MAP_4X4 = AUDIO_PSYCHOACOUSTICS.blockMap.chroma4x4;

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

/**
 * Core YCbCr block decoding function that converts pixel data back to audio samples.
 * Performs the complete decoding pipeline: pixel reading, spatial unscaling, DCT,
 * frequency domain processing, SBR synthesis, and IMDCT to time domain.
 */
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
    externalSbrSeed?: number
): Float32Array {
    // Check for invalid scaling factors - output silence if any are zero
    if (maxY === 0 || maxC === 0 || bandFactors.some(f => f === 0)) {
        outputWindow.fill(0);
        return outputWindow;
    }

    const bx = (blockIndex % BLOCKS_PER_ROW) * 8;
    const by = Math.floor(blockIndex / BLOCKS_PER_ROW) * 8;

    // --- STEP 1: READ PIXELS AND APPLY SAFETY MARGIN ---
    buffers.spatialCb.fill(0);
    buffers.spatialCr.fill(0);

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

    // CAPTURE: Raw Spatial Pixels
    if (debugCapture) {
        if (debugCapture.rawPixelsY) debugCapture.rawPixelsY.set(buffers.spatialY);
        if (debugCapture.rawPixelsCb) debugCapture.rawPixelsCb.set(buffers.spatialCb.subarray(0, 16));
        if (debugCapture.rawPixelsCr) debugCapture.rawPixelsCr.set(buffers.spatialCr.subarray(0, 16));
    }

    // Spatial Unscaling (with numerical stability)
    for (let k = 0; k < 64; k++) {
        buffers.spatialY[k] /= maxY;
        // Clamp extreme values to prevent numerical instability
        buffers.spatialY[k] = Math.max(-1e9, Math.min(1e9, buffers.spatialY[k]));
    }
    for (let k = 0; k < 16; k++) {
        buffers.spatialCb[k] /= maxC;
        buffers.spatialCr[k] /= maxC;
        // Clamp extreme values to prevent numerical instability
        buffers.spatialCb[k] = Math.max(-1e9, Math.min(1e9, buffers.spatialCb[k]));
        buffers.spatialCr[k] = Math.max(-1e9, Math.min(1e9, buffers.spatialCr[k]));
    }

    // --- STEP 2: DCT TO FREQUENCY DOMAIN ---
    dct8x8(buffers.spatialY, buffers.dctY, buffers.temp);
    dct4x4(buffers.spatialCb, buffers.dctCb, buffers.temp);
    dct4x4(buffers.spatialCr, buffers.dctCr, buffers.temp);

    // --- STEP 3: APPLY LUMA/CHROMA SCALING (REVERSE) ---
    for (let k = 0; k < 64; k++) {
        coeffBuffer[k] = buffers.dctY[BLOCK_MAP_8X8[k]];
    }
    for (let k = 0; k < 16; k++) {
        coeffBuffer[64 + 2 * k] = buffers.dctCb[BLOCK_MAP_4X4[k]];
        coeffBuffer[65 + 2 * k] = buffers.dctCr[BLOCK_MAP_4X4[k]];
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

    // --- STEP 6: SBR SYNTHESIS ---
    // Generate HF content (bins 96-127) using 2-subgroup AAC-style SBR
    if (AUDIO_PSYCHOACOUSTICS.enableSbr && sbrBytes && sbrBytes.length === 8 && colInAudioArea !== undefined) {
        const rowParams = decodeRowSBR(sbrBytes);
        const subgroupSize = DATA_BLOCKS_PER_ROW / SBR_SUBGROUPS_PER_ROW;
        const blockIdxInSubgroup = colInAudioArea % subgroupSize;
        const subgroupIdx = Math.min(SBR_SUBGROUPS_PER_ROW - 1, Math.floor(colInAudioArea / subgroupSize));
        const params = rowParams.subgroups[subgroupIdx];

        applySBRSynthesis(coeffBuffer, params, blockIdxInSubgroup, subgroupSize, externalSbrSeed);
    } else {
        // No SBR data available - zero out HF bins
        for (let k = 96; k < 128; k++) {
            coeffBuffer[k] = 0;
        }
    }

    // --- STEP 7: IMDCT ---
    imdct(coeffBuffer, outputWindow);

    for (let k = 0; k < MDCT_WINDOW_SIZE; k++) {
        outputWindow[k] *= mdctWindow[k];
    }

    return outputWindow;
}
