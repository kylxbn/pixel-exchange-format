// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

export const ZIGZAG_4X4_FLAT = new Uint8Array([
    0, 1, 4, 8,
    5, 2, 3, 6,
    9, 12, 13, 10,
    7, 11, 14, 15
]);

export const RASTER_4X4_FLAT = new Uint8Array([
    0, 1, 2, 3,
    4, 5, 6, 7,
    8, 9, 10, 11,
    12, 13, 14, 15
]);

export const ZIGZAG_8X8_FLAT = new Uint8Array([
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
]);

export const RASTER_8X8_FLAT = new Uint8Array([
    0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23,
    24, 25, 26, 27, 28, 29, 30, 31,
    32, 33, 34, 35, 36, 37, 38, 39,
    40, 41, 42, 43, 44, 45, 46, 47,
    48, 49, 50, 51, 52, 53, 54, 55,
    56, 57, 58, 59, 60, 61, 62, 63
]);

// Derived from the average of ImageMagick/libjpeg Q91/Q92/Q93 luma tables.
// Order is sorted by lower quantization first, with ties broken by lower Q92
// value and then the original JPEG zigzag slot. See:
// doc/notes/jpeg-q91-q92-q93-quant-rankings.txt
export const Q92PM1_LUMA_8X8_FLAT = new Uint8Array([
    2, 1, 8, 9, 17, 16, 10, 24,
    0, 3, 25, 18, 32, 11, 4, 19,
    26, 33, 40, 12, 27, 41, 34, 5,
    20, 48, 6, 28, 13, 21, 35, 42,
    15, 23, 14, 7, 31, 49, 43, 36,
    22, 56, 50, 39, 30, 44, 29, 51,
    57, 58, 47, 59, 61, 55, 63, 52,
    38, 62, 45, 37, 46, 60, 53, 54
]);

// Derived from the average of ImageMagick/libjpeg Q91/Q92/Q93 chroma tables
// over the first 16 JPEG chroma zigzag slots. The current codec uses one
// shared 4x4 chroma map for both Cb and Cr because the JPEGs we are targeting
// also use one shared chroma quantization table.
export const Q92PM1_CHROMA_4X4_FLAT = new Uint8Array([
    0, 1, 4, 5,
    8, 2, 6, 9,
    3, 12, 7, 10,
    11, 13, 14, 15
]);

// Derived from the average of ImageMagick/libjpeg Q91/Q92/Q93 chroma tables
// over all 64 JPEG chroma zigzag slots. Used by v301+ where one 8x8 chroma
// block spans a 2x2 group of luma blocks (16x16 px at 4:2:0). The chroma
// tables flatten beyond the early slots, so the tail resolves to zigzag order.
export const Q92PM1_CHROMA_8X8_FLAT = new Uint8Array([
    0, 1, 8, 9, 16, 2, 10, 17,
    3, 24, 18, 25, 11, 32, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
]);

// Derived from weighted ImageMagick/libjpeg Q84..Q100 tables using triangular
// weights centered on Q92. See:
// doc/notes/jpeg-q84-q100-q92pm8-quant-rankings.txt
export const Q92PM8_LUMA_8X8_FLAT = new Uint8Array([
    2, 1, 8, 9, 17, 16, 10, 24,
    0, 3, 18, 25, 32, 11, 26, 33,
    4, 19, 40, 12, 27, 41, 34, 5,
    20, 48, 6, 28, 42, 15, 35, 23,
    21, 13, 14, 7, 31, 49, 43, 36,
    22, 56, 39, 50, 30, 44, 29, 51,
    57, 47, 58, 59, 61, 55, 63, 52,
    38, 62, 45, 37, 60, 46, 54, 53
]);

// Derived from weighted ImageMagick/libjpeg Q84..Q100 chroma tables over the
// first 16 JPEG chroma zigzag slots using the same Q92-centered weighting.
export const Q92PM8_CHROMA_4X4_FLAT = new Uint8Array([
    0, 1, 4, 5,
    8, 2, 6, 9,
    3, 12, 7, 10,
    11, 13, 14, 15
]);

// Derived from weighted ImageMagick/libjpeg Q84..Q100 chroma tables over all
// 64 JPEG chroma zigzag slots using the same Q92-centered weighting. Equal to
// the Q92PM1 ranking because the chroma tables flatten beyond the early slots.
export const Q92PM8_CHROMA_8X8_FLAT = new Uint8Array([
    0, 1, 8, 9, 16, 2, 10, 17,
    3, 24, 18, 25, 11, 32, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63
]);

const DEFAULT_BAND_MAP = new Int8Array(64);
for (let k = 0; k < 64; k++) {
    if (k < 3) DEFAULT_BAND_MAP[k] = 0;
    else if (k < 9) DEFAULT_BAND_MAP[k] = 1;
    else if (k < 25) DEFAULT_BAND_MAP[k] = 2;
    else DEFAULT_BAND_MAP[k] = 3;
}

export const AUDIO_PIXEL_MAPPING_PRESETS = {
    zigzag: {
        luma8x8: ZIGZAG_8X8_FLAT,
        chroma4x4: ZIGZAG_4X4_FLAT,
        chroma8x8: ZIGZAG_8X8_FLAT,
    },
    q92pm1: {
        luma8x8: Q92PM1_LUMA_8X8_FLAT,
        chroma4x4: Q92PM1_CHROMA_4X4_FLAT,
        chroma8x8: Q92PM1_CHROMA_8X8_FLAT,
    },
    q92pm8: {
        luma8x8: Q92PM8_LUMA_8X8_FLAT,
        chroma4x4: Q92PM8_CHROMA_4X4_FLAT,
        chroma8x8: Q92PM8_CHROMA_8X8_FLAT,
    },
    raster: {
        luma8x8: RASTER_8X8_FLAT,
        chroma4x4: RASTER_4X4_FLAT,
        chroma8x8: RASTER_8X8_FLAT,
    },
} as const;

export const AUDIO_PSYCHOACOUSTICS = {
    // High-frequency reconstruction for bins 96..127
    enableSbr: true,

    // Static MDCT whitening on stored bins 0..95
    enableMdctWhitening: true,

    // Adaptive band normalization for bins 0..63
    enableBandNormalization: true,

    // Band assignment for stored luma MDCT bins (0..63).
    // Values are band indices in range [0..3].
    bandMap: DEFAULT_BAND_MAP,

    // Active coefficient maps used for block <-> flat bin mapping.
    // The q92pm8 preset uses weighted Q84..Q100 rankings centered on Q92.
    blockMap: AUDIO_PIXEL_MAPPING_PRESETS.q92pm8,

    // Mu-law companding strengths used by OBB point mapping.
    // Set any value to 0 to make that axis linear (no mu-law).
    muLaw: {
        luma: 6,
        chromaCb: 2,
        chromaCr: 3,
    },
} as const;
