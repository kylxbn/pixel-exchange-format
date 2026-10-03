// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { dct8x8, idct8x8 } from '../utils/audioUtils';

// Model of the transport the audio layout is tuned for: baseline JPEG at
// quality 92 with 4:2:0 chroma (libjpeg tables and box downsampling), read
// back without chroma interpolation. The encoder uses it to see the lowband
// the way a decoder will, so SBR can be fitted to that instead of to the
// clean signal.

const TARGET_QUALITY = 92;

const BASE_LUMA_TABLE = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99
];

const BASE_CHROMA_TABLE = [
    17, 18, 24, 47, 99, 99, 99, 99,
    18, 21, 26, 66, 99, 99, 99, 99,
    24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99
];

function scaleTable(base: number[], quality: number): Float32Array {
    const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
    return Float32Array.from(base, value => Math.max(1, Math.min(255, Math.floor((value * scale + 50) / 100))));
}

const LUMA_TABLE = scaleTable(BASE_LUMA_TABLE, TARGET_QUALITY);
const CHROMA_TABLE = scaleTable(BASE_CHROMA_TABLE, TARGET_QUALITY);

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

/** Quantizes a plane of 8x8 blocks in place, as a JPEG round-trip would. */
function quantizePlane(plane: Float32Array, width: number, height: number, table: Float32Array): void {
    const spatial = new Float32Array(64);
    const coeffs = new Float32Array(64);
    const temp = new Float32Array(64);

    for (let by = 0; by < height; by += 8) {
        for (let bx = 0; bx < width; bx += 8) {
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    spatial[y * 8 + x] = plane[(by + y) * width + bx + x] - 128;
                }
            }
            dct8x8(spatial, coeffs, temp);
            for (let k = 0; k < 64; k++) {
                coeffs[k] = Math.round(coeffs[k] / table[k]) * table[k];
            }
            idct8x8(coeffs, spatial, temp);
            for (let y = 0; y < 8; y++) {
                for (let x = 0; x < 8; x++) {
                    plane[(by + y) * width + bx + x] = clampByte(spatial[y * 8 + x] + 128);
                }
            }
        }
    }
}

/**
 * Returns the RGBA pixels as they come back from the target JPEG transport.
 * Width and height must be multiples of 16.
 */
export function simulateJpegChannel(rgba: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
    const chromaWidth = width / 2;
    const chromaHeight = height / 2;
    const planeY = new Float32Array(width * height);
    const fullCb = new Float32Array(width * height);
    const fullCr = new Float32Array(width * height);

    for (let i = 0; i < width * height; i++) {
        const r = rgba[i * 4];
        const g = rgba[i * 4 + 1];
        const b = rgba[i * 4 + 2];
        planeY[i] = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
        fullCb[i] = clampByte(-0.168735892 * r - 0.331264108 * g + 0.5 * b + 128);
        fullCr[i] = clampByte(0.5 * r - 0.418687589 * g - 0.081312411 * b + 128);
    }

    const planeCb = new Float32Array(chromaWidth * chromaHeight);
    const planeCr = new Float32Array(chromaWidth * chromaHeight);
    for (let cy = 0; cy < chromaHeight; cy++) {
        for (let cx = 0; cx < chromaWidth; cx++) {
            const top = cy * 2 * width + cx * 2;
            const bottom = top + width;
            // libjpeg's box filter alternates its rounding bias between 1 and 2
            const bias = 1 + (cx & 1);
            planeCb[cy * chromaWidth + cx] = Math.floor((fullCb[top] + fullCb[top + 1] + fullCb[bottom] + fullCb[bottom + 1] + bias) / 4);
            planeCr[cy * chromaWidth + cx] = Math.floor((fullCr[top] + fullCr[top + 1] + fullCr[bottom] + fullCr[bottom + 1] + bias) / 4);
        }
    }

    quantizePlane(planeY, width, height, LUMA_TABLE);
    quantizePlane(planeCb, chromaWidth, chromaHeight, CHROMA_TABLE);
    quantizePlane(planeCr, chromaWidth, chromaHeight, CHROMA_TABLE);

    const out = new Uint8ClampedArray(rgba.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const c = (y >> 1) * chromaWidth + (x >> 1);
            const cb = planeCb[c] - 128;
            const cr = planeCr[c] - 128;
            out[i * 4] = clampByte(planeY[i] + 1.402 * cr);
            out[i * 4 + 1] = clampByte(planeY[i] - 0.344136 * cb - 0.714136 * cr);
            out[i * 4 + 2] = clampByte(planeY[i] + 1.772 * cb);
            out[i * 4 + 3] = 255;
        }
    }
    return out;
}
