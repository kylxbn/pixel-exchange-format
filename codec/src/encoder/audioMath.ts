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
import { AUDIO_PSYCHOACOUSTICS, getBlockMapForVersion } from '../psychoacoustics';
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
import type { SimpleImageData } from './types';

const BAND_MAP = AUDIO_PSYCHOACOUSTICS.bandMap;
const BLOCK_MAP_CHROMA_8X8 = AUDIO_PSYCHOACOUSTICS.blockMap.chroma8x8;

// v301: one 8x8 chroma block spans a 2x2 group of luma blocks (16x16 px)
const SUPERBLOCK_COLS = DATA_BLOCKS_PER_ROW / 2; // 62

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
        ({ scaleYA, scaleYB } = ScalingUtils.calculateLumaScalingFactors(rowSpatialY, rowDataCount));
    } else {
        ({ scaleYA, scaleYB, scaleCAX, scaleCAY, scaleCBX, scaleCBY } = ScalingUtils.calculateRowScalingFactors(
            rowSpatialY, rowSpatialCb, rowSpatialCr, rowDataCount
        ));
    }

    return {
        rowDataCount,
        rowMDCTCoeffs,
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
    // Combined 8x8 chroma spatial samples per superblock (SUPERBLOCK_COLS * 64)
    superCb: Float32Array;
    superCr: Float32Array;
}

function chromaGroupIndex(i: number): number {
    const isA = i < SUBGROUP_A_SIZE;
    const isX = (i % SUBGROUP_A_SIZE) < SUBGROUP_X_SIZE;
    return (isA ? 0 : 2) + (isX ? 0 : 1); // 0=AX, 1=AY, 2=BX, 3=BY
}

/**
 * v301 chroma preparation for a pair of rows. Each 2x2 group of luma blocks
 * shares one 8x8 Cb and one 8x8 Cr coefficient block; importance rank 4k + o
 * of the 8x8 chroma map holds bin k of block ordinal o = rowParity * 2 + colParity.
 * Computes per-(row, quadrant) chroma scales (assigned back onto top/bottom)
 * and returns the combined superblock spatial samples for pixel writing.
 */
export function prepareRowPairChroma(
    top: PreparedAudioRow,
    bottom: PreparedAudioRow,
    buffers: EncodeRowBuffers
): PreparedPairChroma {
    const rows = [top, bottom];

    // Per-block solo spatial contributions (IDCT is linear, so the combined
    // superblock is the sum of individually scaled solo contributions)
    const soloCb = rows.map(row => new Float32Array(row.rowDataCount * 64));
    const soloCr = rows.map(row => new Float32Array(row.rowDataCount * 64));
    const soloMax = rows.map(row => new Float32Array(row.rowDataCount));

    for (let r = 0; r < 2; r++) {
        const row = rows[r];
        for (let i = 0; i < row.rowDataCount; i++) {
            const ordinal = r * 2 + (i & 1);
            buffers.dctCb.fill(0);
            buffers.dctCr.fill(0);
            for (let k = 0; k < 16; k++) {
                const pos = BLOCK_MAP_CHROMA_8X8[4 * k + ordinal];
                buffers.dctCb[pos] = row.rowChromaCb[i * 16 + k];
                buffers.dctCr[pos] = row.rowChromaCr[i * 16 + k];
            }
            idct8x8(buffers.dctCb, buffers.spatialCb, buffers.temp);
            idct8x8(buffers.dctCr, buffers.spatialCr, buffers.temp);

            let m = 0;
            const off = i * 64;
            for (let j = 0; j < 64; j++) {
                soloCb[r][off + j] = buffers.spatialCb[j];
                soloCr[r][off + j] = buffers.spatialCr[j];
                m = Math.max(m, Math.abs(buffers.spatialCb[j]), Math.abs(buffers.spatialCr[j]));
            }
            soloMax[r][i] = m;
        }
    }

    // Candidate scales per (row, quadrant), same max-based semantics as v300
    const groupMax = [
        [0, 0, 0, 0],
        [0, 0, 0, 0]
    ];
    for (let r = 0; r < 2; r++) {
        for (let i = 0; i < rows[r].rowDataCount; i++) {
            const g = chromaGroupIndex(i);
            groupMax[r][g] = Math.max(groupMax[r][g], soloMax[r][i]);
        }
    }
    const silent = groupMax.map(maxes => maxes.map(m => m <= SILENCE_THRESHOLD));
    const scales = groupMax.map(maxes => maxes.map(m => m > SILENCE_THRESHOLD ? Math.min(65504, 1.0 / m) : 65504));

    const superCb = new Float32Array(SUPERBLOCK_COLS * 64);
    const superCr = new Float32Array(SUPERBLOCK_COLS * 64);

    const computeCombined = () => {
        superCb.fill(0);
        superCr.fill(0);
        for (let r = 0; r < 2; r++) {
            const row = rows[r];
            for (let i = 0; i < row.rowDataCount; i++) {
                const s = scales[r][chromaGroupIndex(i)];
                const src = i * 64;
                const dst = (i >> 1) * 64;
                for (let j = 0; j < 64; j++) {
                    superCb[dst + j] += s * soloCb[r][src + j];
                    superCr[dst + j] += s * soloCr[r][src + j];
                }
            }
        }
    };

    // Up to 4 different scales mix inside one superblock, so the max-based
    // candidates cannot guarantee |spatial| <= 1 by themselves. Shrink the
    // participating (row, quadrant) groups until nothing clips.
    const EPS = 1e-6;
    for (let iter = 0; ; iter++) {
        computeCombined();

        const shrink = [
            [1, 1, 1, 1],
            [1, 1, 1, 1]
        ];
        let worst = 1;
        for (let c = 0; c < SUPERBLOCK_COLS; c++) {
            let m = 0;
            const off = c * 64;
            for (let j = 0; j < 64; j++) {
                m = Math.max(m, Math.abs(superCb[off + j]), Math.abs(superCr[off + j]));
            }
            if (m > 1 + EPS) {
                worst = Math.max(worst, m);
                for (let r = 0; r < 2; r++) {
                    for (let i = c * 2; i <= c * 2 + 1; i++) {
                        if (i < rows[r].rowDataCount) {
                            const g = chromaGroupIndex(i);
                            shrink[r][g] = Math.max(shrink[r][g], m);
                        }
                    }
                }
            }
        }
        if (worst <= 1 + EPS) break;

        if (iter >= 8) {
            // Uniform fallback: shrinking every contributing group by the
            // worst overshoot scales all superblocks linearly, so this is an
            // exact fix in one step.
            for (let r = 0; r < 2; r++) {
                for (let g = 0; g < 4; g++) {
                    if (!silent[r][g]) scales[r][g] /= worst;
                }
            }
            computeCombined();
            break;
        }

        for (let r = 0; r < 2; r++) {
            for (let g = 0; g < 4; g++) {
                if (!silent[r][g]) scales[r][g] /= shrink[r][g];
            }
        }
    }

    top.scaleCAX = scales[0][0];
    top.scaleCAY = scales[0][1];
    top.scaleCBX = scales[0][2];
    top.scaleCBY = scales[0][3];
    bottom.scaleCAX = scales[1][0];
    bottom.scaleCAY = scales[1][1];
    bottom.scaleCBX = scales[1][2];
    bottom.scaleCBY = scales[1][3];

    return { superCb, superCr };
}

/**
 * Writes a prepared pair of rows using the v301 layout: per-block luma plus
 * shared superblock chroma NN-upsampled to 16x16 px. Chroma pixels cover the
 * full data extent of both rows (missing blocks get silent luma) because the
 * superblock IDCT spreads energy across all four block areas.
 */
export function writePreparedAudioRowPair(
    topRowIndex: number,
    firstAudioBlockIndex: number,
    top: PreparedAudioRow,
    bottom: PreparedAudioRow,
    pairChroma: PreparedPairChroma,
    imageData: SimpleImageData,
    writeRowMetadata: RowMetadataWriter,
    formatVersion: number = FORMAT_VERSION
): void {
    const rows = [top, bottom];
    const { superCb, superCr } = pairChroma;

    for (let r = 0; r < 2; r++) {
        const row = rows[r];
        const rowIndex = topRowIndex + r;
        const sbrBytes = AUDIO_PSYCHOACOUSTICS.enableSbr
            ? encodeRowSBR(row.sbrParams, formatVersion)
            : new Uint8Array(ROW_META_SBR_BYTES);

        for (let i = 0; i < DATA_BLOCKS_PER_ROW; i++) {
            const hasData = i < row.rowDataCount;
            const scaleY = i < SUBGROUP_A_SIZE ? row.scaleYA : row.scaleYB;

            const imgBlockIdx = firstAudioBlockIndex + rowIndex * BLOCKS_PER_ROW + i;
            const bx = (imgBlockIdx % BLOCKS_PER_ROW) * 8;
            const by = Math.floor(imgBlockIdx / BLOCKS_PER_ROW) * 8;

            const superOff = (i >> 1) * 64;
            const spatialOffsetY = i * 64;

            for (let y = 0; y < 8; y++) {
                const cy = (r * 8 + y) >> 1;
                for (let x = 0; x < 8; x++) {
                    const cx = ((i & 1) * 8 + x) >> 1;
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

        const metaBlockIdx = firstAudioBlockIndex + rowIndex * BLOCKS_PER_ROW + DATA_BLOCKS_PER_ROW;
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
            metaBlockIdx
        );
    }
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

    writePreparedAudioRowPair(
        topRowIndex,
        firstAudioBlockIndex,
        top,
        bottom,
        pairChroma,
        imageData,
        writeRowMetadata
    );
}
