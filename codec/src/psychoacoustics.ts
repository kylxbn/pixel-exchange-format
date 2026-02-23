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
    },
    raster: {
        luma8x8: RASTER_8X8_FLAT,
        chroma4x4: RASTER_4X4_FLAT,
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
    // Swap this to AUDIO_PIXEL_MAPPING_PRESETS.raster for a raster path.
    blockMap: AUDIO_PIXEL_MAPPING_PRESETS.zigzag,

    // Mu-law companding strengths used by OBB point mapping.
    // Set any value to 0 to make that axis linear (no mu-law).
    muLaw: {
        luma: 6,
        chromaCb: 2,
        chromaCr: 3,
    },
} as const;
