// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * Proven JPEG IDCT implementation adapted from a reference decoder.
 * Uses fixed-point arithmetic for reliability and matches standard JPEG behavior.
 */

const dctCos1 = 4017;   // cos(pi/16)
const dctSin1 = 799;    // sin(pi/16)
const dctCos3 = 3406;   // cos(3*pi/16)
const dctSin3 = 2276;   // sin(3*pi/16)
const dctCos6 = 1567;   // cos(6*pi/16)
const dctSin6 = 3784;   // sin(6*pi/16)
const dctSqrt2 = 5793;  // sqrt(2)
const dctSqrt1d2 = 2896; // sqrt(2) / 2

export function inverseDCT(block: number[]): number[] {
  // block is expected to be in natural order (row-major) and dequantized.
  // We use a local Float32Array for the IDCT calculation to avoid mutating the input.
  const p = new Float32Array(block);
  const dataOut = new Array(64);
  let v0, v1, v2, v3, v4, v5, v6, v7, t;

  // 1. Inverse DCT on rows
  for (let i = 0; i < 8; ++i) {
    const row = 8 * i;

    // Check for all-zero AC coefficients
    if (p[1 + row] === 0 && p[2 + row] === 0 && p[3 + row] === 0 &&
      p[4 + row] === 0 && p[5 + row] === 0 && p[6 + row] === 0 &&
      p[7 + row] === 0) {
      t = (dctSqrt2 * p[0 + row] + 512) >> 10;
      p[0 + row] = t;
      p[1 + row] = t;
      p[2 + row] = t;
      p[3 + row] = t;
      p[4 + row] = t;
      p[5 + row] = t;
      p[6 + row] = t;
      p[7 + row] = t;
      continue;
    }

    // stage 4
    v0 = (dctSqrt2 * p[0 + row] + 128) >> 8;
    v1 = (dctSqrt2 * p[4 + row] + 128) >> 8;
    v2 = p[2 + row];
    v3 = p[6 + row];
    v4 = (dctSqrt1d2 * (p[1 + row] - p[7 + row]) + 128) >> 8;
    v7 = (dctSqrt1d2 * (p[1 + row] + p[7 + row]) + 128) >> 8;
    v5 = p[3 + row] << 4;
    v6 = p[5 + row] << 4;

    // stage 3
    t = (v0 - v1 + 1) >> 1;
    v0 = (v0 + v1 + 1) >> 1;
    v1 = t;
    t = (v2 * dctSin6 + v3 * dctCos6 + 128) >> 8;
    v2 = (v2 * dctCos6 - v3 * dctSin6 + 128) >> 8;
    v3 = t;
    t = (v4 - v6 + 1) >> 1;
    v4 = (v4 + v6 + 1) >> 1;
    v6 = t;
    t = (v7 + v5 + 1) >> 1;
    v5 = (v7 - v5 + 1) >> 1;
    v7 = t;

    // stage 2
    t = (v0 - v3 + 1) >> 1;
    v0 = (v0 + v3 + 1) >> 1;
    v3 = t;
    t = (v1 - v2 + 1) >> 1;
    v1 = (v1 + v2 + 1) >> 1;
    v2 = t;
    t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
    v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
    v7 = t;
    t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
    v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
    v6 = t;

    // stage 1
    p[0 + row] = v0 + v7;
    p[7 + row] = v0 - v7;
    p[1 + row] = v1 + v6;
    p[6 + row] = v1 - v6;
    p[2 + row] = v2 + v5;
    p[5 + row] = v2 - v5;
    p[3 + row] = v3 + v4;
    p[4 + row] = v3 - v4;
  }

  // 2. Inverse DCT on columns
  for (let i = 0; i < 8; ++i) {
    const col = i;

    // Check for all-zero AC coefficients
    if (p[1 * 8 + col] === 0 && p[2 * 8 + col] === 0 && p[3 * 8 + col] === 0 &&
      p[4 * 8 + col] === 0 && p[5 * 8 + col] === 0 && p[6 * 8 + col] === 0 &&
      p[7 * 8 + col] === 0) {
      t = (dctSqrt2 * p[0 * 8 + col] + 8192) >> 14;
      p[0 * 8 + col] = t;
      p[1 * 8 + col] = t;
      p[2 * 8 + col] = t;
      p[3 * 8 + col] = t;
      p[4 * 8 + col] = t;
      p[5 * 8 + col] = t;
      p[6 * 8 + col] = t;
      p[7 * 8 + col] = t;
      continue;
    }

    // stage 4
    v0 = (dctSqrt2 * p[0 * 8 + col] + 2048) >> 12;
    v1 = (dctSqrt2 * p[4 * 8 + col] + 2048) >> 12;
    v2 = p[2 * 8 + col];
    v3 = p[6 * 8 + col];
    v4 = (dctSqrt1d2 * (p[1 * 8 + col] - p[7 * 8 + col]) + 2048) >> 12;
    v7 = (dctSqrt1d2 * (p[1 * 8 + col] + p[7 * 8 + col]) + 2048) >> 12;
    v5 = p[3 * 8 + col];
    v6 = p[5 * 8 + col];

    // stage 3
    t = (v0 - v1 + 1) >> 1;
    v0 = (v0 + v1 + 1) >> 1;
    v1 = t;
    t = (v2 * dctSin6 + v3 * dctCos6 + 2048) >> 12;
    v2 = (v2 * dctCos6 - v3 * dctSin6 + 2048) >> 12;
    v3 = t;
    t = (v4 - v6 + 1) >> 1;
    v4 = (v4 + v6 + 1) >> 1;
    v6 = t;
    t = (v7 + v5 + 1) >> 1;
    v5 = (v7 - v5 + 1) >> 1;
    v7 = t;

    // stage 2
    t = (v0 - v3 + 1) >> 1;
    v0 = (v0 + v3 + 1) >> 1;
    v3 = t;
    t = (v1 - v2 + 1) >> 1;
    v1 = (v1 + v2 + 1) >> 1;
    v2 = t;
    t = (v4 * dctSin3 + v7 * dctCos3 + 2048) >> 12;
    v4 = (v4 * dctCos3 - v7 * dctSin3 + 2048) >> 12;
    v7 = t;
    t = (v5 * dctSin1 + v6 * dctCos1 + 2048) >> 12;
    v5 = (v5 * dctCos1 - v6 * dctSin1 + 2048) >> 12;
    v6 = t;

    // stage 1
    p[0 * 8 + col] = v0 + v7;
    p[7 * 8 + col] = v0 - v7;
    p[1 * 8 + col] = v1 + v6;
    p[6 * 8 + col] = v1 - v6;
    p[2 * 8 + col] = v2 + v5;
    p[5 * 8 + col] = v2 - v5;
    p[3 * 8 + col] = v3 + v4;
    p[4 * 8 + col] = v3 - v4;
  }

  // 3. Final Level Shift and Clamp to 8-bit
  for (let i = 0; i < 64; ++i) {
    const sample = 128 + ((p[i] + 8) >> 4);
    dataOut[i] = sample < 0 ? 0 : sample > 255 ? 255 : sample;
  }

  return dataOut;
}

/**
 * ZigZag Table from reference - Matches standard JPEG order:
 * Figures A.6 and F.1 in the JPEG spec.
 */
export function zigzagToNatural(zigzag: number[]): number[] {
  const dctZigZag = [
    0,
    1, 8,
    16, 9, 2,
    3, 10, 17, 24,
    32, 25, 18, 11, 4,
    5, 12, 19, 26, 33, 40,
    48, 41, 34, 27, 20, 13, 6,
    7, 14, 21, 28, 35, 42, 49, 56,
    57, 50, 43, 36, 29, 22, 15,
    23, 30, 37, 44, 51, 58,
    59, 52, 45, 38, 31,
    39, 46, 53, 60,
    61, 54, 47,
    55, 62,
    63
  ];

  const natural = new Array(64);
  for (let j = 0; j < 64; j++) {
    const z = dctZigZag[j];
    natural[z] = zigzag[j];
  }
  return natural;
}