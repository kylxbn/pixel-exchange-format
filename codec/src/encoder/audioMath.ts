// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import {
    BLOCKS_PER_ROW,
    DATA_BLOCKS_PER_ROW,
    IMAGE_WIDTH,
    ROW_META_SBR_BYTES,
    SILENCE_THRESHOLD,
    SUBGROUP_A_SIZE,
    SUBGROUP_X_SIZE,
} from '../constants';
import {
    AUDIO_PSYCHOACOUSTICS,
} from '../psychoacoustics';
import { analyzeRowSBR, encodeRowSBR } from '../utils/sbr';
import {
    idct4x4,
    idct8x8,
    logDecode,
    logEncode,
    mdct,
} from '../utils/audioUtils';
import { applyMdctWhiteningWithProfile } from '../utils/mdctWhitening';
import type { MdctWhiteningProfile } from '../utils/mdctWhitening';
import { encodePointToRGB } from '../utils/obb';
import { ScalingUtils } from './scaling';
import type { SimpleImageData } from './audio';

const BAND_MAP = AUDIO_PSYCHOACOUSTICS.bandMap;
const BLOCK_MAP_8X8 = AUDIO_PSYCHOACOUSTICS.blockMap.luma8x8;
const BLOCK_MAP_4X4 = AUDIO_PSYCHOACOUSTICS.blockMap.chroma4x4;

export interface EncodeRowBuffers {
    winFrame: Float32Array;
    mdctCoeffs: Float32Array;
    dctY: Float32Array;
    dctCb: Float32Array;
    dctCr: Float32Array;
    spatialY: Float32Array;
    spatialCb: Float32Array;
    spatialCr: Float32Array;
    temp: Float32Array;
}

export type RowMetadataWriter = (
    rowIndex: number,
    scaleYA: number,
    scaleYB: number,
    scaleCAX: number,
    scaleCAY: number,
    scaleCBX: number,
    scaleCBY: number,
    bandFactorsA: Float32Array,
    bandFactorsB: Float32Array,
    sbrData: Uint8Array,
    imageData: SimpleImageData,
    blockIndex: number
) => void;

export function processRow(
    rowIndex: number,
    rowDataCount: number,
    firstImageBlockInRow: number,
    firstAudioBlockIndex: number,
    totalAudioBlocks: number,
    paddedAudio: Float32Array,
    imageData: SimpleImageData,
    hopSize: number,
    windowSize: number,
    mdctWindow: Float32Array,
    sampleRate: number,
    whiteningProfile: MdctWhiteningProfile | null,
    buffers: EncodeRowBuffers,
    writeRowMetadata: RowMetadataWriter
): void {
    // Intermediate buffers to hold MDCT coefficients for the whole row
    const rowCoeffsBuffer = new Float32Array(rowDataCount * 96);
    const rowMDCTCoeffs: Float32Array[] = []; // Full 128-bin MDCT for SBR analysis

    // Row-level spatial buffers to store IDCT results (one pass)
    const rowSpatialY = new Float32Array(rowDataCount * 64);
    const rowSpatialCb = new Float32Array(rowDataCount * 16);
    const rowSpatialCr = new Float32Array(rowDataCount * 16);

    // --- STEP 1: COMPUTE MDCT AND SBR ANALYSIS ---
    for (let i = 0; i < rowDataCount; i++) {
        const audioBlockIdx = firstImageBlockInRow + i;
        if (audioBlockIdx < totalAudioBlocks) {
            const fStart = audioBlockIdx * hopSize;
            for (let k = 0; k < windowSize; k++) {
                buffers.winFrame[k] = paddedAudio[fStart + k] * mdctWindow[k];
            }

            mdct(buffers.winFrame, buffers.mdctCoeffs);

            // Save bins 0-95 for processing
            for (let k = 0; k < 96; k++) {
                rowCoeffsBuffer[i * 96 + k] = buffers.mdctCoeffs[k];
            }

            // Save full 128-bin MDCT for SBR analysis
            rowMDCTCoeffs.push(new Float32Array(buffers.mdctCoeffs));
        }
    }

    // SBR: Analyze entire row using dedicated SBR module
    const sbrBytes = AUDIO_PSYCHOACOUSTICS.enableSbr
        ? encodeRowSBR(analyzeRowSBR(rowMDCTCoeffs, rowDataCount))
        : new Uint8Array(ROW_META_SBR_BYTES);

    // --- STEP 2: STATIC MDCT BIN WHITENING (bins 0..95) ---
    for (let i = 0; i < rowDataCount; i++) {
        if (AUDIO_PSYCHOACOUSTICS.enableMdctWhitening && whiteningProfile) {
            applyMdctWhiteningWithProfile(rowCoeffsBuffer, whiteningProfile, i * 96);
        }
    }

    // --- STEP 3: ANALYZE BANDS ON MDCT COEFFICIENTS ---
    // We'll analyze bands separately for subgroup A and B
    const bandFactorsA = new Float32Array([1, 1, 1, 1]);
    const bandFactorsB = new Float32Array([1, 1, 1, 1]);

    if (AUDIO_PSYCHOACOUSTICS.enableBandNormalization) {
        const bandMaxA = new Float32Array(4).fill(0);
        const bandMaxB = new Float32Array(4).fill(0);

        for (let i = 0; i < rowDataCount; i++) {
            const isA = i < SUBGROUP_A_SIZE;
            const bandMax = isA ? bandMaxA : bandMaxB;

            // Retrieve coefficients for this block
            for (let k = 0; k < 64; k++) {
                buffers.mdctCoeffs[k] = rowCoeffsBuffer[i * 96 + k];
            }

            // Analyze each bin and assign to band using pre-computed bandMap
            for (let k = 0; k < 64; k++) {
                const val = Math.abs(buffers.mdctCoeffs[k]);
                const bandIdx = BAND_MAP[k];
                bandMax[bandIdx] = Math.max(bandMax[bandIdx], val);
            }
        }

        // Create band factors with logDecode(logEncode(...)) quantization
        for (let b = 0; b < 4; b++) {
            if (bandMaxA[b] > SILENCE_THRESHOLD) {
                bandFactorsA[b] = logDecode(logEncode(1.0 / bandMaxA[b]));
            } else {
                bandFactorsA[b] = logDecode(logEncode(1.0));
            }

            if (bandMaxB[b] > SILENCE_THRESHOLD) {
                bandFactorsB[b] = logDecode(logEncode(1.0 / bandMaxB[b]));
            } else {
                bandFactorsB[b] = logDecode(logEncode(1.0));
            }
        }

        // --- STEP 4: APPLY BAND FACTORS TO MDCT ---
        // Apply band factors directly using pre-computed bandMap
        for (let i = 0; i < rowDataCount; i++) {
            const isA = i < SUBGROUP_A_SIZE;
            const bandFactors = isA ? bandFactorsA : bandFactorsB;
            const rowOffset = i * 96;

            for (let k = 0; k < 64; k++) {
                const bandIdx = BAND_MAP[k];
                rowCoeffsBuffer[rowOffset + k] *= bandFactors[bandIdx];
            }
        }
    }

    // --- STEP 5: IDCT TO SPATIAL DOMAIN ---
    // Do IDCT once per block and store spatial results
    for (let i = 0; i < rowDataCount; i++) {
        // Load MDCT coefficients (with band factors applied)
        const rowOffset = i * 96;
        for (let k = 0; k < 96; k++) {
            buffers.mdctCoeffs[k] = rowCoeffsBuffer[rowOffset + k];
        }

        // Prepare DCT buffers
        buffers.dctY.fill(0);
        buffers.dctCb.fill(0);
        buffers.dctCr.fill(0);

        // Y channel (bins 0-63)
        for (let k = 0; k < 64; k++) {
            buffers.dctY[BLOCK_MAP_8X8[k]] = buffers.mdctCoeffs[k];
        }

        // Chroma channels (bins 64-95) -> 4x4 DCT
        for (let k = 0; k < 16; k++) {
            const cbBin = 64 + 2 * k;
            const crBin = 65 + 2 * k;
            buffers.dctCb[BLOCK_MAP_4X4[k]] = buffers.mdctCoeffs[cbBin];
            buffers.dctCr[BLOCK_MAP_4X4[k]] = buffers.mdctCoeffs[crBin];
        }

        // IDCT to spatial domain
        idct8x8(buffers.dctY, buffers.spatialY, buffers.temp);
        idct4x4(buffers.dctCb, buffers.spatialCb, buffers.temp);
        idct4x4(buffers.dctCr, buffers.spatialCr, buffers.temp);

        // Store spatial results in row buffers
        const spatialOffsetY = i * 64;
        const spatialOffsetC = i * 16;
        for (let j = 0; j < 64; j++) {
            rowSpatialY[spatialOffsetY + j] = buffers.spatialY[j];
        }
        for (let j = 0; j < 16; j++) {
            rowSpatialCb[spatialOffsetC + j] = buffers.spatialCb[j];
            rowSpatialCr[spatialOffsetC + j] = buffers.spatialCr[j];
        }
    }

    // --- STEP 6: CALCULATE SCALING FACTORS ---
    // Use max-based scaling to ensure NO clipping
    const { scaleYA, scaleYB, scaleCAX, scaleCAY, scaleCBX, scaleCBY } = ScalingUtils.calculateRowScalingFactors(
        rowSpatialY, rowSpatialCb, rowSpatialCr, rowDataCount
    );

    // --- STEP 6: WRITE PIXELS ---
    // Reuse upsampled chroma buffers to avoid allocations in the loop
    const upCb = new Float32Array(64);
    const upCr = new Float32Array(64);

    for (let i = 0; i < rowDataCount; i++) {
        const isA = i < SUBGROUP_A_SIZE;
        const isX = (i % SUBGROUP_A_SIZE) < SUBGROUP_X_SIZE;

        const scaleY = isA ? scaleYA : scaleYB;
        const scaleC = isA
            ? (isX ? scaleCAX : scaleCAY)
            : (isX ? scaleCBX : scaleCBY);

        const imgBlockIdx = firstAudioBlockIndex + rowIndex * BLOCKS_PER_ROW + i;
        const bx = (imgBlockIdx % BLOCKS_PER_ROW) * 8;
        const by = Math.floor(imgBlockIdx / BLOCKS_PER_ROW) * 8;

        // Load spatial data from row buffers and scale
        const spatialOffsetY = i * 64;
        const spatialOffsetC = i * 16;
        for (let j = 0; j < 64; j++) {
            buffers.spatialY[j] = rowSpatialY[spatialOffsetY + j] * scaleY;
        }
        for (let j = 0; j < 16; j++) {
            buffers.spatialCb[j] = rowSpatialCb[spatialOffsetC + j] * scaleC;
            buffers.spatialCr[j] = rowSpatialCr[spatialOffsetC + j] * scaleC;
        }

        // Upsample chroma from 4x4 to 8x8 in-place
        for (let y = 0; y < 8; y++) {
            const sy = Math.floor(y / 2); // 0..3
            for (let x = 0; x < 8; x++) {
                const sx = Math.floor(x / 2); // 0..3
                const idx = y * 8 + x;
                const srcIdx = sy * 4 + sx;
                upCb[idx] = buffers.spatialCb[srcIdx];
                upCr[idx] = buffers.spatialCr[srcIdx];
            }
        }

        // Write pixels with safety margin applied
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const idx = y * 8 + x;

                const [r, g, b] = encodePointToRGB([
                    buffers.spatialY[idx],
                    upCb[idx],
                    upCr[idx]
                ]);

                const off = ((by + y) * IMAGE_WIDTH + (bx + x)) * 4;
                imageData.data[off] = Math.max(0, Math.min(255, Math.round(r)));
                imageData.data[off + 1] = Math.max(0, Math.min(255, Math.round(g)));
                imageData.data[off + 2] = Math.max(0, Math.min(255, Math.round(b)));
                imageData.data[off + 3] = 255;
            }
        }
    }

    // Store metadata for decoder
    const metaBlockIdx = firstAudioBlockIndex + rowIndex * BLOCKS_PER_ROW + DATA_BLOCKS_PER_ROW;
    writeRowMetadata(
        rowIndex,
        scaleYA,
        scaleYB,
        scaleCAX,
        scaleCAY,
        scaleCBX,
        scaleCBY,
        bandFactorsA,
        bandFactorsB,
        sbrBytes,
        imageData,
        metaBlockIdx
    );
}
