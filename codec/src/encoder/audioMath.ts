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
    audioBlockToImageBlock,
    BLOCKS_PER_MCU,
    FIRST_AUDIO_BLOCK_ROW,
    chromaGroupIndex,
    isLumaSubgroupA,
    MCUS_PER_AUDIO_ROW,
} from '../audioLayout';
import { AUDIO_PSYCHOACOUSTICS, getBlockMapForVersion } from '../psychoacoustics';
import { analyzeRowSBR, createDefaultRowSBR, encodeRowSBR, type RowSBRParams } from '../utils/sbr';
import { decodeBlockToCoefficients } from '../decoder/audioMath';
import { floatToHalf, halfToFloat } from '../utils/ieee';
import { simulateJpegChannel } from './jpegChannel';
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
import type { SimpleImageData } from './types';

const BAND_MAP = AUDIO_PSYCHOACOUSTICS.bandMap;
const BLOCK_MAP_CHROMA_8X8 = AUDIO_PSYCHOACOUSTICS.blockMap.chroma8x8;


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
    // Blocks as SBR analysis should see them: bins 0..95 the way the decoder
    // reads them back, bins 96..127 clean. Same as rowMDCTCoeffs until
    // analyzeRowPairSbr has run.
    sbrSourceCoeffs: Float32Array[];
    rowSpatialY: Float32Array;
    // v300: per-block 4x4 chroma spatial samples (16 per block)
    rowSpatialCb: Float32Array;
    rowSpatialCr: Float32Array;
    // v301: per-block chroma MDCT coefficients (16 per block, bins 64..95)
    rowChromaCb: Float32Array;
    rowChromaCr: Float32Array;
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
    buffers: EncodeRowBuffers,
    formatVersion: number = FORMAT_VERSION
): PreparedAudioRow {
    const isV301 = formatVersion >= 301;
    const blockMap = getBlockMapForVersion(formatVersion);
    const rowCoeffsBuffer = new Float32Array(rowDataCount * 96);
    const rowMDCTCoeffs: Float32Array[] = [];

    const rowSpatialY = new Float32Array(rowDataCount * 64);
    const rowSpatialCb = new Float32Array(isV301 ? 0 : rowDataCount * 16);
    const rowSpatialCr = new Float32Array(isV301 ? 0 : rowDataCount * 16);
    const rowChromaCb = new Float32Array(isV301 ? rowDataCount * 16 : 0);
    const rowChromaCr = new Float32Array(isV301 ? rowDataCount * 16 : 0);

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

    // v301 rows are analyzed by analyzeRowPairSbr once their pixels exist
    const sbrParams = AUDIO_PSYCHOACOUSTICS.enableSbr && !isV301
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
            const isA = isLumaSubgroupA(i, formatVersion);
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
            const isA = isLumaSubgroupA(i, formatVersion);
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
            buffers.dctY[blockMap.luma8x8[k]] = buffers.mdctCoeffs[k];
        }

        idct8x8(buffers.dctY, buffers.spatialY, buffers.temp);

        const spatialOffsetY = i * 64;
        const offsetC = i * 16;
        for (let j = 0; j < 64; j++) {
            rowSpatialY[spatialOffsetY + j] = buffers.spatialY[j];
        }

        if (isV301) {
            // Chroma spatial samples are produced per superblock at row-pair
            // level (prepareRowPairChroma); only keep the coefficients here.
            for (let k = 0; k < 16; k++) {
                rowChromaCb[offsetC + k] = buffers.mdctCoeffs[64 + 2 * k];
                rowChromaCr[offsetC + k] = buffers.mdctCoeffs[65 + 2 * k];
            }
        } else {
            for (let k = 0; k < 16; k++) {
                buffers.dctCb[blockMap.chroma4x4[k]] = buffers.mdctCoeffs[64 + 2 * k];
                buffers.dctCr[blockMap.chroma4x4[k]] = buffers.mdctCoeffs[65 + 2 * k];
            }

            idct4x4(buffers.dctCb, buffers.spatialCb, buffers.temp);
            idct4x4(buffers.dctCr, buffers.spatialCr, buffers.temp);

            for (let j = 0; j < 16; j++) {
                rowSpatialCb[offsetC + j] = buffers.spatialCb[j];
                rowSpatialCr[offsetC + j] = buffers.spatialCr[j];
            }
        }
    }

    let scaleYA: number;
    let scaleYB: number;
    let scaleCAX = 65504;
    let scaleCAY = 65504;
    let scaleCBX = 65504;
    let scaleCBY = 65504;

    if (isV301) {
        // Chroma scales are filled in by prepareRowPairChroma
        ({ scaleYA, scaleYB } = ScalingUtils.calculateLumaScalingFactors(rowSpatialY, rowDataCount, formatVersion));
    } else {
        ({ scaleYA, scaleYB, scaleCAX, scaleCAY, scaleCBX, scaleCBY } = ScalingUtils.calculateRowScalingFactors(
            rowSpatialY, rowSpatialCb, rowSpatialCr, rowDataCount
        ));
    }

    return {
        rowDataCount,
        rowMDCTCoeffs,
        sbrSourceCoeffs: rowMDCTCoeffs,
        rowSpatialY,
        rowSpatialCb,
        rowSpatialCr,
        rowChromaCb,
        rowChromaCr,
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

/**
 * Writes a prepared row using the v300 layout (per-block 4x4 chroma).
 * Only valid for rows prepared with formatVersion <= 300; the v301 path
 * uses writePreparedAudioRowPair.
 */
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

export interface PreparedPairChroma {
    // Scaled 8x8 chroma spatial samples per MCU of the row pair
    // (2 * MCUS_PER_AUDIO_ROW * 64, top row's MCUs first)
    superCb: Float32Array;
    superCr: Float32Array;
}

/**
 * v301 chroma preparation for a pair of rows. Each MCU holds four consecutive
 * audio blocks that share one 8x8 Cb and one 8x8 Cr coefficient block;
 * importance rank 4k + o of the 8x8 chroma map holds bin k of the MCU's
 * block o. Chroma scale groups are whole MCUs, so every MCU has one scale.
 * Computes the max-based chroma scales (assigned onto top/bottom) and returns
 * the scaled spatial samples for pixel writing.
 */
export function prepareRowPairChroma(
    top: PreparedAudioRow,
    bottom: PreparedAudioRow,
    buffers: EncodeRowBuffers,
    formatVersion: number = FORMAT_VERSION
): PreparedPairChroma {
    const rows = [top, bottom];
    const superCb = new Float32Array(2 * MCUS_PER_AUDIO_ROW * 64);
    const superCr = new Float32Array(2 * MCUS_PER_AUDIO_ROW * 64);

    for (let r = 0; r < 2; r++) {
        const row = rows[r];
        const mcuCount = Math.ceil(row.rowDataCount / BLOCKS_PER_MCU);
        const groupMax = [0, 0, 0, 0];

        for (let m = 0; m < mcuCount; m++) {
            buffers.dctCb.fill(0);
            buffers.dctCr.fill(0);
            for (let o = 0; o < BLOCKS_PER_MCU; o++) {
                const i = m * BLOCKS_PER_MCU + o;
                if (i >= row.rowDataCount) break;
                for (let k = 0; k < 16; k++) {
                    const pos = BLOCK_MAP_CHROMA_8X8[4 * k + o];
                    buffers.dctCb[pos] = row.rowChromaCb[i * 16 + k];
                    buffers.dctCr[pos] = row.rowChromaCr[i * 16 + k];
                }
            }
            idct8x8(buffers.dctCb, buffers.spatialCb, buffers.temp);
            idct8x8(buffers.dctCr, buffers.spatialCr, buffers.temp);

            const g = chromaGroupIndex(m * BLOCKS_PER_MCU, formatVersion);
            const off = (r * MCUS_PER_AUDIO_ROW + m) * 64;
            for (let j = 0; j < 64; j++) {
                superCb[off + j] = buffers.spatialCb[j];
                superCr[off + j] = buffers.spatialCr[j];
                groupMax[g] = Math.max(groupMax[g], Math.abs(buffers.spatialCb[j]), Math.abs(buffers.spatialCr[j]));
            }
        }

        const scales = groupMax.map(m => m > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / m) : 65504);
        for (let m = 0; m < mcuCount; m++) {
            const s = scales[chromaGroupIndex(m * BLOCKS_PER_MCU, formatVersion)];
            const off = (r * MCUS_PER_AUDIO_ROW + m) * 64;
            for (let j = 0; j < 64; j++) {
                superCb[off + j] *= s;
                superCr[off + j] *= s;
            }
        }

        [row.scaleCAX, row.scaleCAY, row.scaleCBX, row.scaleCBY] = scales;
    }

    return { superCb, superCr };
}

/**
 * Writes the pixels of a prepared pair of rows using the v301 layout: blocks
 * in MCU order, per-block luma plus the MCU's shared chroma NN-upsampled to
 * 16x16 px. The whole data area of the pair is written; blocks past the end
 * of the audio get silent luma.
 */
export function writeRowPairPixels(
    topRowIndex: number,
    top: PreparedAudioRow,
    bottom: PreparedAudioRow,
    pairChroma: PreparedPairChroma,
    imageData: SimpleImageData,
    formatVersion: number = FORMAT_VERSION
): void {
    const rows = [top, bottom];
    const { superCb, superCr } = pairChroma;

    for (let r = 0; r < 2; r++) {
        const row = rows[r];
        const rowIndex = topRowIndex + r;

        for (let i = 0; i < DATA_BLOCKS_PER_ROW; i++) {
            const hasData = i < row.rowDataCount;
            const scaleY = isLumaSubgroupA(i, formatVersion) ? row.scaleYA : row.scaleYB;

            const imgBlockIdx = audioBlockToImageBlock(rowIndex, i, formatVersion);
            const bx = (imgBlockIdx % BLOCKS_PER_ROW) * 8;
            const by = Math.floor(imgBlockIdx / BLOCKS_PER_ROW) * 8;

            const ordinal = i % BLOCKS_PER_MCU;
            const superOff = (r * MCUS_PER_AUDIO_ROW + Math.floor(i / BLOCKS_PER_MCU)) * 64;
            const spatialOffsetY = i * 64;

            for (let y = 0; y < 8; y++) {
                const cy = ((ordinal >> 1) * 8 + y) >> 1;
                for (let x = 0; x < 8; x++) {
                    const cx = ((ordinal & 1) * 8 + x) >> 1;
                    const cIdx = cy * 8 + cx;

                    const [rr, gg, bb] = encodePointToRGB([
                        hasData ? row.rowSpatialY[spatialOffsetY + y * 8 + x] * scaleY : 0,
                        superCb[superOff + cIdx],
                        superCr[superOff + cIdx]
                    ]);

                    const off = ((by + y) * IMAGE_WIDTH + (bx + x)) * 4;
                    imageData.data[off] = Math.max(0, Math.min(255, Math.round(rr)));
                    imageData.data[off + 1] = Math.max(0, Math.min(255, Math.round(gg)));
                    imageData.data[off + 2] = Math.max(0, Math.min(255, Math.round(bb)));
                    imageData.data[off + 3] = 255;
                }
            }
        }
    }
}

/**
 * Reads a written pair of rows back the way a decoder will (after the target
 * JPEG transport when sbrClosedLoop is on) and stores the result in each
 * row's sbrSourceCoeffs. SBR is then fitted to the lowband synthesis will
 * really patch from, which carries the transport's quantization noise.
 */
export function readBackRowPair(
    topRowIndex: number,
    top: PreparedAudioRow,
    bottom: PreparedAudioRow,
    imageData: SimpleImageData,
    whiteningProfile: MdctWhiteningProfile | null,
    formatVersion: number = FORMAT_VERSION
): void {
    if (!AUDIO_PSYCHOACOUSTICS.enableSbr || !AUDIO_PSYCHOACOUSTICS.sbrClosedLoop || !whiteningProfile) return;

    const firstImageRow = FIRST_AUDIO_BLOCK_ROW + topRowIndex;
    const stripStart = firstImageRow * 8 * IMAGE_WIDTH * 4;
    const strip = simulateJpegChannel(
        imageData.data.subarray(stripStart, stripStart + 16 * IMAGE_WIDTH * 4), IMAGE_WIDTH, 16
    );

    const buffers = {
        spatialY: new Float32Array(64),
        spatialCb: new Float32Array(64),
        spatialCr: new Float32Array(64),
        dctY: new Float32Array(64),
        dctCb: new Float32Array(64),
        dctCr: new Float32Array(64),
        temp: new Float32Array(64)
    };
    // The decoder gets the scales from half-float row metadata
    const stored = (scale: number) => halfToFloat(floatToHalf(scale));

    [top, bottom].forEach((row, r) => {
        const chromaScales = [row.scaleCAX, row.scaleCAY, row.scaleCBX, row.scaleCBY];
        row.sbrSourceCoeffs = row.rowMDCTCoeffs.map((clean, i) => {
            const isA = isLumaSubgroupA(i, formatVersion);
            const coeffs = new Float32Array(clean.length);
            decodeBlockToCoefficients(
                strip, IMAGE_WIDTH,
                audioBlockToImageBlock(topRowIndex + r, i, formatVersion) - firstImageRow * BLOCKS_PER_ROW,
                stored(isA ? row.scaleYA : row.scaleYB),
                stored(chromaScales[chromaGroupIndex(i, formatVersion)]),
                whiteningProfile,
                isA ? row.bandFactorsA : row.bandFactorsB,
                coeffs, buffers, undefined, formatVersion
            );
            coeffs.set(clean.subarray(96), 96);
            return coeffs;
        });
    });
}

/** Fits each row's SBR parameters; call after readBackRowPair. */
export function analyzeRowPairSbr(top: PreparedAudioRow, bottom: PreparedAudioRow): void {
    if (!AUDIO_PSYCHOACOUSTICS.enableSbr) return;
    for (const row of [top, bottom]) {
        row.sbrParams = analyzeRowSBR(row.rowMDCTCoeffs, row.rowDataCount, row.sbrSourceCoeffs);
    }
}

export function writeRowPairMetadata(
    topRowIndex: number,
    firstAudioBlockIndex: number,
    top: PreparedAudioRow,
    bottom: PreparedAudioRow,
    imageData: SimpleImageData,
    writeRowMetadata: RowMetadataWriter,
    formatVersion: number = FORMAT_VERSION
): void {
    [top, bottom].forEach((row, r) => {
        const rowIndex = topRowIndex + r;
        const sbrBytes = AUDIO_PSYCHOACOUSTICS.enableSbr
            ? encodeRowSBR(row.sbrParams, formatVersion)
            : new Uint8Array(ROW_META_SBR_BYTES);

        writeRowMetadata(
            rowIndex,
            row.scaleYA,
            row.scaleYB,
            row.scaleCAX,
            row.scaleCAY,
            row.scaleCBX,
            row.scaleCBY,
            row.bandFactorsA,
            row.bandFactorsB,
            sbrBytes,
            imageData,
            firstAudioBlockIndex + rowIndex * BLOCKS_PER_ROW + DATA_BLOCKS_PER_ROW
        );
    });
}

export function processRowPair(
    topRowIndex: number,
    topRowDataCount: number,
    bottomRowDataCount: number,
    firstAudioBlockIndex: number,
    totalAudioBlocks: number,
    paddedAudio: Float32Array,
    imageData: SimpleImageData,
    hopSize: number,
    windowSize: number,
    mdctWindow: Float32Array,
    whiteningProfile: MdctWhiteningProfile | null,
    buffers: EncodeRowBuffers,
    writeRowMetadata: RowMetadataWriter
): void {
    const top = prepareAudioRow(
        topRowDataCount,
        topRowIndex * DATA_BLOCKS_PER_ROW,
        totalAudioBlocks,
        paddedAudio,
        hopSize,
        windowSize,
        mdctWindow,
        whiteningProfile,
        buffers
    );
    const bottom = prepareAudioRow(
        bottomRowDataCount,
        (topRowIndex + 1) * DATA_BLOCKS_PER_ROW,
        totalAudioBlocks,
        paddedAudio,
        hopSize,
        windowSize,
        mdctWindow,
        whiteningProfile,
        buffers
    );

    const pairChroma = prepareRowPairChroma(top, bottom, buffers);

    writeRowPairPixels(topRowIndex, top, bottom, pairChroma, imageData);
    readBackRowPair(topRowIndex, top, bottom, imageData, whiteningProfile);
    analyzeRowPairSbr(top, bottom);
    writeRowPairMetadata(topRowIndex, firstAudioBlockIndex, top, bottom, imageData, writeRowMetadata);
}
