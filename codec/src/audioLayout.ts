// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import {
    BLOCKS_PER_ROW,
    CHANNEL_MODE,
    DATA_BLOCKS_PER_ROW,
    MDCT_HOP_SIZE,
} from './constants';

// An audio row is DATA_BLOCKS_PER_ROW consecutive audio blocks described by
// one row metadata record. Rows are stored in JPEG 4:2:0 MCU order: rows come
// in pairs, the pair's data area is 62 MCUs (2x2 blocks each), the first row
// of the pair owns the left 31 MCUs and the second row the right 31. Inside
// an MCU blocks go top-left, top-right, bottom-left, bottom-right.

export const FIRST_AUDIO_BLOCK_ROW = 2;
export const BLOCKS_PER_MCU = 4;
export const MCUS_PER_AUDIO_ROW = DATA_BLOCKS_PER_ROW / BLOCKS_PER_MCU; // 31

// Scale groups are whole MCUs: luma A/B = 16/15 MCUs, chroma
// AX/AY/BX/BY = 8/8/8/7 MCUs
const SUBGROUP_A_SIZE = 16 * BLOCKS_PER_MCU; // 64
const CHROMA_GROUP_SIZE = 8 * BLOCKS_PER_MCU; // 32

/**
 * Silent samples stored ahead of the audio in the first image of a file (and
 * its side image). The extra block gives the first hop of audio the
 * overlapping window it needs for alias cancellation; the header sample count
 * does not include it and the decoder drops it.
 */
export function leadInSamples(channelMode: number, imageIndex: number): number {
    const firstImageIndex = channelMode === CHANNEL_MODE.STEREO_SIDE ? 2 : 1;
    return imageIndex === firstImageIndex ? MDCT_HOP_SIZE : 0;
}

/** Absolute image block index of an audio block. */
export function audioBlockToImageBlock(rowInAudioArea: number, colInAudioArea: number): number {
    const mcu = (rowInAudioArea & 1) * MCUS_PER_AUDIO_ROW + Math.floor(colInAudioArea / BLOCKS_PER_MCU);
    const ordinal = colInAudioArea % BLOCKS_PER_MCU;
    const imageRow = FIRST_AUDIO_BLOCK_ROW + (rowInAudioArea & ~1) + (ordinal >> 1);
    return imageRow * BLOCKS_PER_ROW + mcu * 2 + (ordinal & 1);
}

/** Inverse of audioBlockToImageBlock; null outside the audio data area. */
export function imageBlockToAudioBlock(
    imageRow: number,
    imageCol: number
): { rowInAudioArea: number; colInAudioArea: number } | null {
    if (imageRow < FIRST_AUDIO_BLOCK_ROW || imageCol < 0 || imageCol >= DATA_BLOCKS_PER_ROW) {
        return null;
    }
    const row = imageRow - FIRST_AUDIO_BLOCK_ROW;
    const mcu = imageCol >> 1;
    const ordinal = (row & 1) * 2 + (imageCol & 1);
    const half = mcu >= MCUS_PER_AUDIO_ROW ? 1 : 0;
    return {
        rowInAudioArea: (row & ~1) + half,
        colInAudioArea: (mcu - half * MCUS_PER_AUDIO_ROW) * BLOCKS_PER_MCU + ordinal
    };
}

/** Image block rows that hold the blocks of an audio row. */
export function audioRowImageSpan(rowInAudioArea: number): { firstRow: number; rowCount: number } {
    return { firstRow: FIRST_AUDIO_BLOCK_ROW + (rowInAudioArea & ~1), rowCount: 2 };
}

export function isLumaSubgroupA(colInAudioArea: number): boolean {
    return colInAudioArea < SUBGROUP_A_SIZE;
}

/** Chroma scale group of a block: 0=AX, 1=AY, 2=BX, 3=BY. */
export function chromaGroupIndex(colInAudioArea: number): number {
    return Math.min(3, Math.floor(colInAudioArea / CHROMA_GROUP_SIZE));
}
