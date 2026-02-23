// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

// --- Precomputed Constants & Tables ---

const MDCT_N_128 = 128;
const MDCT_M_256 = 256;

// Tables are initialized lazily to avoid global scope overhead on module load
let MDCT_TABLE_128: Float32Array | null = null;
let IMDCT_TABLE_128: Float32Array | null = null;

let DCT_8_TABLE: Float32Array | null = null;
let DCT_4_TABLE: Float32Array | null = null;

let SINE_WINDOW_256: Float32Array | null = null;

/**
 * Initialize mathematical tables for transform operations.
 * These tables represent the basis functions for MDCT and DCT types.
 */
function initTables() {
    if (MDCT_TABLE_128) return;

    // Generates the transform matrix for MDCT (Type IV DCT variant)
    const genMdct = (n: number, m: number) => {
        const table = new Float32Array(n * m);
        const n0 = (n / 2.0) + 0.5;
        // Matrix definition: cos( (PI/n) * (k + 0.5) * (i + n0) )
        for (let k = 0; k < n; k++) {
            for (let i = 0; i < m; i++) {
                table[k * m + i] = Math.cos((Math.PI / n) * (k + 0.5) * (i + n0));
            }
        }
        return table;
    };

    // Generates the transform matrix for Inverse MDCT
    const genImdct = (n: number, m: number) => {
        const table = new Float32Array(m * n);
        const n0 = (n / 2.0) + 0.5;
        const scale = 2.0 / n;
        for (let i = 0; i < m; i++) {
            for (let k = 0; k < n; k++) {
                table[i * n + k] = Math.cos((Math.PI / n) * (k + 0.5) * (i + n0)) * scale;
            }
        }
        return table;
    };

    // Standard Sine Window for Time-Domain Aliasing Cancellation (TDAC)
    const genWindow = (m: number) => {
        const w = new Float32Array(m);
        for (let i = 0; i < m; i++) {
            w[i] = Math.sin(Math.PI * (i + 0.5) / m);
        }
        return w;
    };

    MDCT_TABLE_128 = genMdct(MDCT_N_128, MDCT_M_256);
    IMDCT_TABLE_128 = genImdct(MDCT_N_128, MDCT_M_256);

    SINE_WINDOW_256 = genWindow(MDCT_M_256);

    // DCT Type-II 8x8 Matrix (Flattened 64 elements)
    // Used for JPEG-style 2D spatial compression
    DCT_8_TABLE = new Float32Array(64);
    for (let k = 0; k < 8; k++) {
        const alpha = k === 0 ? 1 / Math.sqrt(2) : 1;
        const s = Math.sqrt(2 / 8) * alpha;
        for (let n = 0; n < 8; n++) {
            DCT_8_TABLE[k * 8 + n] = s * Math.cos((Math.PI * k * (2 * n + 1)) / 16);
        }
    }

    // DCT Type-II 4x4 Matrix (Flattened 16 elements)
    DCT_4_TABLE = new Float32Array(16);
    for (let k = 0; k < 4; k++) {
        const alpha = k === 0 ? 1 / Math.sqrt(2) : 1;
        const s = Math.sqrt(2 / 4) * alpha;
        for (let n = 0; n < 4; n++) {
            DCT_4_TABLE[k * 4 + n] = s * Math.cos((Math.PI * k * (2 * n + 1)) / 8);
        }
    }
}

// Initialize tables immediately
initTables();

export function getSineWindow(size: number = 256): Float32Array {
    if (size === 256) return SINE_WINDOW_256!;

    // Fallback for custom sizes
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) w[i] = Math.sin(Math.PI * (i + 0.5) / size);
    return w;
}

/**
 * Modified Discrete Cosine Transform (MDCT).
 * Implemented as a Matrix-Vector multiplication.
 * Output[k] = Sum( Input[n] * cos(...) )
 */
export function mdct(signal: Float32Array, output?: Float32Array): Float32Array {
    const len = signal.length;
    let N: number, M: number, table: Float32Array;

    // Select precomputed kernel
    if (len === 256) {
        N = 128; M = 256; table = MDCT_TABLE_128!;
    } else {
        // Fallback for arbitrary sizes (slow)
        N = len / 2; M = len;
        if (!output) output = new Float32Array(N);
        const n0 = (N / 2.0) + 0.5;
        for (let k = 0; k < N; k++) {
            let sum = 0;
            for (let n = 0; n < M; n++) {
                sum += signal[n] * Math.cos((Math.PI / N) * (k + 0.5) * (n + n0));
            }
            output[k] = sum;
        }
        return output;
    }

    if (!output) output = new Float32Array(N);

    // Matrix Multiply: Output = Table * Signal
    for (let k = 0; k < N; k++) {
        let sum = 0;
        const rowOffset = k * M;
        for (let n = 0; n < M; n++) {
            sum += signal[n] * table[rowOffset + n];
        }
        output[k] = sum;
    }
    return output;
}

/**
 * Inverse Modified Discrete Cosine Transform (IMDCT).
 * Implemented as a Matrix-Vector multiplication.
 */
export function imdct(coeffs: Float32Array, output?: Float32Array): Float32Array {
    const len = coeffs.length;
    let N: number, M: number, table: Float32Array;

    if (len === 128) {
        N = 128; M = 256; table = IMDCT_TABLE_128!;
    } else {
        // Fallback
        N = len; M = len * 2;
        if (!output) output = new Float32Array(M);
        const n0 = (N / 2.0) + 0.5;
        const scale = 2.0 / N;
        for (let n = 0; n < M; n++) {
            let sum = 0;
            for (let k = 0; k < N; k++) {
                sum += coeffs[k] * Math.cos((Math.PI / N) * (k + 0.5) * (n + n0));
            }
            output[n] = sum * scale;
        }
        return output;
    }

    if (!output) output = new Float32Array(M);

    // Matrix Multiply: Output = Table^T * Coeffs
    for (let n = 0; n < M; n++) {
        let sum = 0;
        const rowOffset = n * N;
        for (let k = 0; k < N; k++) {
            sum += coeffs[k] * table[rowOffset + k];
        }
        output[n] = sum;
    }
    return output;
}

/**
 * 2D Separable DCT 8x8.
 * Applied as Row transform then Column transform.
 */
export function dct8x8(src: Float32Array, dest: Float32Array, temp: Float32Array) {
    const table = DCT_8_TABLE!;

    // 1. Transform Rows -> Temp
    for (let i = 0; i < 8; i++) {
        const rowOff = i * 8;
        for (let k = 0; k < 8; k++) {
            let sum = 0;
            const tableRow = k * 8;
            for (let n = 0; n < 8; n++) {
                sum += src[rowOff + n] * table[tableRow + n];
            }
            temp[rowOff + k] = sum;
        }
    }

    // 2. Transform Columns -> Dest
    for (let j = 0; j < 8; j++) {
        for (let k = 0; k < 8; k++) {
            let sum = 0;
            const tableRow = k * 8;
            for (let i = 0; i < 8; i++) {
                sum += table[tableRow + i] * temp[i * 8 + j];
            }
            dest[k * 8 + j] = sum;
        }
    }
}

/**
 * 2D Separable IDCT 8x8.
 */
export function idct8x8(src: Float32Array, dest: Float32Array, temp: Float32Array) {
    const table = DCT_8_TABLE!;

    // 1. Transform Columns -> Temp
    for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) {
            let sum = 0;
            for (let k = 0; k < 8; k++) {
                sum += table[k * 8 + i] * src[k * 8 + j];
            }
            temp[i * 8 + j] = sum;
        }
    }

    // 2. Transform Rows -> Dest
    for (let i = 0; i < 8; i++) {
        const rowOff = i * 8;
        for (let n = 0; n < 8; n++) {
            let sum = 0;
            for (let k = 0; k < 8; k++) {
                sum += temp[rowOff + k] * table[k * 8 + n];
            }
            dest[rowOff + n] = sum;
        }
    }
}

// Optimized 4x4 DCT
export function dct4x4(src: Float32Array, dest: Float32Array, temp: Float32Array) {
    const table = DCT_4_TABLE!;
    // Rows
    for (let i = 0; i < 4; i++) {
        const rowOff = i * 4;
        for (let k = 0; k < 4; k++) {
            let sum = 0;
            const tableRow = k * 4;
            for (let n = 0; n < 4; n++) {
                sum += src[rowOff + n] * table[tableRow + n];
            }
            temp[rowOff + k] = sum;
        }
    }
    // Cols
    for (let j = 0; j < 4; j++) {
        for (let k = 0; k < 4; k++) {
            let sum = 0;
            const tableRow = k * 4;
            for (let i = 0; i < 4; i++) {
                sum += table[tableRow + i] * temp[i * 4 + j];
            }
            dest[k * 4 + j] = sum;
        }
    }
}

// Optimized 4x4 IDCT
export function idct4x4(src: Float32Array, dest: Float32Array, temp: Float32Array) {
    const table = DCT_4_TABLE!;
    // Cols
    for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += table[k * 4 + i] * src[k * 4 + j];
            }
            temp[i * 4 + j] = sum;
        }
    }
    // Rows
    for (let i = 0; i < 4; i++) {
        const rowOff = i * 4;
        for (let n = 0; n < 4; n++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += temp[rowOff + k] * table[k * 4 + n];
            }
            dest[rowOff + n] = sum;
        }
    }
}

// --- Data & Pixel Conversion Helpers ---

export function setPixel(imageData: Uint8ClampedArray, x: number, y: number, width: number, color: number) {
    const offset = (y * width + x) * 4;
    imageData[offset] = color; imageData[offset + 1] = color; imageData[offset + 2] = color; imageData[offset + 3] = 255;
}
export function getPixel(imageData: Uint8ClampedArray, x: number, y: number, width: number): number {
    const offset = (y * width + x) * 4;
    return (imageData[offset] + imageData[offset + 1] + imageData[offset + 2]) / 3.0;
}

export function encodeBytesToBlocks(bytes: Uint8Array, imageData: Uint8ClampedArray, imageWidth: number, startBlockIndex: number): number {
    const totalBits = bytes.length * 8;
    const blocksPerRow = imageWidth / 8;
    for (let bitIndex = 0; bitIndex < totalBits; bitIndex++) {
        const byteIndex = (bitIndex >>> 3);
        const bitInByte = 7 - (bitIndex & 7); // MSB First
        const bit = (bytes[byteIndex] >> bitInByte) & 1;
        const pixelIndexInStream = bitIndex;
        const blockIndex = startBlockIndex + (pixelIndexInStream >>> 6); // / 64
        const pixelInBlock = pixelIndexInStream & 63; // % 64
        const blockX = (blockIndex % blocksPerRow) * 8;
        const blockY = Math.floor(blockIndex / blocksPerRow) * 8;
        const x = blockX + (pixelInBlock & 7);
        const y = blockY + (pixelInBlock >>> 3);
        setPixel(imageData, x, y, imageWidth, bit === 1 ? 255 : 0);
    }
    return Math.ceil(totalBits / 64);
}

export function decodeBytesFromBlocks(byteLength: number, imageData: Uint8ClampedArray, imageWidth: number, startBlockIndex: number): Uint8Array {
    const bytes = new Uint8Array(byteLength);
    if (byteLength === 0) return bytes;
    const totalBits = byteLength * 8;
    const blocksPerRow = imageWidth / 8;
    for (let bitIndex = 0; bitIndex < totalBits; bitIndex++) {
        const pixelIndexInStream = bitIndex;
        const blockIndex = startBlockIndex + (pixelIndexInStream >>> 6);
        const pixelInBlock = pixelIndexInStream & 63;
        const blockX = (blockIndex % blocksPerRow) * 8;
        const blockY = Math.floor(blockIndex / blocksPerRow) * 8;
        const x = blockX + (pixelInBlock & 7);
        const y = blockY + (pixelInBlock >>> 3);
        const bit = getPixel(imageData, x, y, imageWidth) > 127 ? 1 : 0;
        if (bit === 1) {
            const byteIndex = (bitIndex >>> 3);
            const bitInByte = 7 - (bitIndex & 7); // MSB First
            bytes[byteIndex] |= (1 << bitInByte);
        }
    }
    return bytes;
}

export function numberToBytes(num: number, byteCount: number): Uint8Array {
    const bytes = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i++) { bytes[i] = (num >> (i * 8)) & 0xff; }
    return bytes;
}
export function bytesToNumber(bytes: Uint8Array): number {
    let num = 0;
    for (let i = 0; i < bytes.length; i++) { num |= bytes[i] << (i * 8); }
    return num;
}

export const BAND_MAX_GAIN = 2.0;
const LOG2E = 1 / Math.LN2;
const LOG_MAX = Math.log1p(BAND_MAX_GAIN) * LOG2E;

export function logEncode(val: number): number {
    if (val <= 0) return 0;

    const safeVal = Math.min(val, BAND_MAX_GAIN);

    const encoded =
        Math.round(
            255 * (Math.log1p(safeVal) * LOG2E) / LOG_MAX
        );

    return Math.max(0, Math.min(255, encoded));
}

export function logDecode(code: number): number {
    if (code <= 0) return 0;

    const logValue = (code / 255) * LOG_MAX;
    return Math.pow(2, logValue) - 1;
}
