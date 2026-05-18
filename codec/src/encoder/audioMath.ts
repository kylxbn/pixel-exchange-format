// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import {
    BLOCKS_PER_ROW,
    DATA_BLOCKS_PER_ROW,
    FORMAT_VERSION,
    IMAGE_WIDTH,
    ROW_META_SBR_BYTES,
    SILENCE_THRESHOLD,
    SUBGROUP_A_SIZE,
    SUBGROUP_X_SIZE,
} from '../constants';
import {
    AUDIO_PSYCHOACOUSTICS,
} from '../psychoacoustics';
import { analyzeRowSBR, createDefaultRowSBR, encodeRowSBR, type RowSBRParams } from '../utils/sbr';
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

export interface PreparedAudioRow {
    rowDataCount: number;
    rowMDCTCoeffs: Float32Array[];
    rowSpatialY: Float32Array;
    rowSpatialCb: Float32Array;
    rowSpatialCr: Float32Array;
    scaleYA: number;
    scaleYB: number;
    scaleCAX: number;
    scaleCAY: number;
    scaleCBX: number;
    scaleCBY: number;
    bandFactorsA: Float32Array;
    bandFactorsB: Float32Array;
    sbrParams: RowSBRParams;
}

export function prepareAudioRow(
    rowDataCount: number,
    firstImageBlockInRow: number,
    totalAudioBlocks: number,
    paddedAudio: Float32Array,
    hopSize: number,
    windowSize: number,
    mdctWindow: Float32Array,
    whiteningProfile: MdctWhiteningProfile | null,
    buffers: EncodeRowBuffers
): PreparedAudioRow {
    const rowCoeffsBuffer = new Float32Array(rowDataCount * 96);
    const rowMDCTCoeffs: Float32Array[] = [];

    const rowSpatialY = new Float32Array(rowDataCount * 64);
    const rowSpatialCb = new Float32Array(rowDataCount * 16);
    const rowSpatialCr = new Float32Array(rowDataCount * 16);

    for (let i = 0; i < rowDataCount; i++) {
        const audioBlockIdx = firstImageBlockInRow + i;
        if (audioBlockIdx < totalAudioBlocks) {
            const fStart = audioBlockIdx * hopSize;
            for (let k = 0; k < windowSize; k++) {
                buffers.winFrame[k] = paddedAudio[fStart + k] * mdctWindow[k];
            }

            mdct(buffers.winFrame, buffers.mdctCoeffs);

            for (let k = 0; k < 96; k++) {
                rowCoeffsBuffer[i * 96 + k] = buffers.mdctCoeffs[k];
            }

            rowMDCTCoeffs.push(new Float32Array(buffers.mdctCoeffs));
        }
    }

    const sbrParams = AUDIO_PSYCHOACOUSTICS.enableSbr
        ? analyzeRowSBR(rowMDCTCoeffs, rowDataCount)
        : createDefaultRowSBR();

    for (let i = 0; i < rowDataCount; i++) {
        if (AUDIO_PSYCHOACOUSTICS.enableMdctWhitening && whiteningProfile) {
            applyMdctWhiteningWithProfile(rowCoeffsBuffer, whiteningProfile, i * 96);
        }
    }

    const bandFactorsA = new Float32Array([1, 1, 1, 1]);
    const bandFactorsB = new Float32Array([1, 1, 1, 1]);

    if (AUDIO_PSYCHOACOUSTICS.enableBandNormalization) {
        const bandMaxA = new Float32Array(4).fill(0);
        const bandMaxB = new Float32Array(4).fill(0);

        for (let i = 0; i < rowDataCount; i++) {
            const isA = i < SUBGROUP_A_SIZE;
            const bandMax = isA ? bandMaxA : bandMaxB;

            for (let k = 0; k < 64; k++) {
                buffers.mdctCoeffs[k] = rowCoeffsBuffer[i * 96 + k];
            }

            for (let k = 0; k < 64; k++) {
                const val = Math.abs(buffers.mdctCoeffs[k]);
                const bandIdx = BAND_MAP[k];
                bandMax[bandIdx] = Math.max(bandMax[bandIdx], val);
            }
        }

        for (let b = 0; b < 4; b++) {
            bandFactorsA[b] = bandMaxA[b] > SILENCE_THRESHOLD
                ? logDecode(logEncode(1.0 / bandMaxA[b]))
                : logDecode(logEncode(1.0));
            bandFactorsB[b] = bandMaxB[b] > SILENCE_THRESHOLD
                ? logDecode(logEncode(1.0 / bandMaxB[b]))
                : logDecode(logEncode(1.0));
        }

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

    for (let i = 0; i < rowDataCount; i++) {
        const rowOffset = i * 96;
        for (let k = 0; k < 96; k++) {
            buffers.mdctCoeffs[k] = rowCoeffsBuffer[rowOffset + k];
        }

        buffers.dctY.fill(0);
        buffers.dctCb.fill(0);
        buffers.dctCr.fill(0);

        for (let k = 0; k < 64; k++) {
            buffers.dctY[BLOCK_MAP_8X8[k]] = buffers.mdctCoeffs[k];
        }

        for (let k = 0; k < 16; k++) {
            const cbBin = 64 + 2 * k;
            const crBin = 65 + 2 * k;
            buffers.dctCb[BLOCK_MAP_4X4[k]] = buffers.mdctCoeffs[cbBin];
            buffers.dctCr[BLOCK_MAP_4X4[k]] = buffers.mdctCoeffs[crBin];
        }

        idct8x8(buffers.dctY, buffers.spatialY, buffers.temp);
        idct4x4(buffers.dctCb, buffers.spatialCb, buffers.temp);
        idct4x4(buffers.dctCr, buffers.spatialCr, buffers.temp);

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

    const { scaleYA, scaleYB, scaleCAX, scaleCAY, scaleCBX, scaleCBY } = ScalingUtils.calculateRowScalingFactors(
        rowSpatialY, rowSpatialCb, rowSpatialCr, rowDataCount
    );

    return {
        rowDataCount,
        rowMDCTCoeffs,
        rowSpatialY,
        rowSpatialCb,
        rowSpatialCr,
        scaleYA,
        scaleYB,
        scaleCAX,
        scaleCAY,
        scaleCBX,
        scaleCBY,
        bandFactorsA,
        bandFactorsB,
        sbrParams
    };
}

export function writePreparedAudioRow(
    rowIndex: number,
    firstAudioBlockIndex: number,
    preparedRow: PreparedAudioRow,
    imageData: SimpleImageData,
    buffers: EncodeRowBuffers,
    writeRowMetadata: RowMetadataWriter,
    formatVersion: number = FORMAT_VERSION
): void {
    const {
        rowDataCount,
        rowSpatialY,
        rowSpatialCb,
        rowSpatialCr,
        scaleYA,
        scaleYB,
        scaleCAX,
        scaleCAY,
        scaleCBX,
        scaleCBY,
        bandFactorsA,
        bandFactorsB,
        sbrParams
    } = preparedRow;
    const sbrBytes = AUDIO_PSYCHOACOUSTICS.enableSbr
        ? encodeRowSBR(sbrParams, formatVersion)
        : new Uint8Array(ROW_META_SBR_BYTES);

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

        const spatialOffsetY = i * 64;
        const spatialOffsetC = i * 16;
        for (let j = 0; j < 64; j++) {
            buffers.spatialY[j] = rowSpatialY[spatialOffsetY + j] * scaleY;
        }
        for (let j = 0; j < 16; j++) {
            buffers.spatialCb[j] = rowSpatialCb[spatialOffsetC + j] * scaleC;
            buffers.spatialCr[j] = rowSpatialCr[spatialOffsetC + j] * scaleC;
        }

        for (let y = 0; y < 8; y++) {
            const sy = Math.floor(y / 2);
            for (let x = 0; x < 8; x++) {
                const sx = Math.floor(x / 2);
                const idx = y * 8 + x;
                const srcIdx = sy * 4 + sx;
                upCb[idx] = buffers.spatialCb[srcIdx];
                upCr[idx] = buffers.spatialCr[srcIdx];
            }
        }

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
    const preparedRow = prepareAudioRow(
        rowDataCount,
        firstImageBlockInRow,
        totalAudioBlocks,
        paddedAudio,
        hopSize,
        windowSize,
        mdctWindow,
        whiteningProfile,
        buffers
    );

    writePreparedAudioRow(
        rowIndex,
        firstAudioBlockIndex,
        preparedRow,
        imageData,
        buffers,
        writeRowMetadata
    );
}
