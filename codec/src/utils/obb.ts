// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

// Encode/decode between internal point within [-1..1]^3 and RGB using the maximal OBB based on tests.

import { AUDIO_PSYCHOACOUSTICS } from "../psychoacoustics";

// ---------- Types ----------
export type Vec3 = [number, number, number];

// ---------- Constants ----------
const OBB_CENTER: Vec3 = [127.426429853651, 128.000000000000, 128.000000000000];
const OBB_EXTENTS: Vec3 = [41.159043640701, 61.527423138263, 48.637958664678]; // hx, hy, hz (half-extents)
const OBB_ROT: number[][] = [
  [1.000000000000, 0.000000000000, 0.000000000000],
  [0.000000000000, -0.000087098752, 0.999999996207],
  [0.000000000000, -0.999999996207, -0.000087098752]
];
const OBB_ROT_INV: number[][] = [
  [1.000000000000, 0.000000000000, 0.000000000000],
  [0.000000000000, -0.000087098752, -0.999999996207],
  [0.000000000000, 0.999999996207, -0.000087098752]
];

const MU: Vec3 = [
  AUDIO_PSYCHOACOUSTICS.muLaw.luma,
  AUDIO_PSYCHOACOUSTICS.muLaw.chromaCb,
  AUDIO_PSYCHOACOUSTICS.muLaw.chromaCr
];

function mat3_mul_vec3(M: number[][], v: Vec3): Vec3 {
  return [
    M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
    M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
    M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
  ];
}

// ---------- Mu-law ----------
function muLawEncode(x: number, mu: number): number {
  if (mu <= 0) return x;
  const s = Math.sign(x);
  const ax = Math.abs(x);
  return s * Math.log1p(mu * ax) / Math.log1p(mu);
}
function muLawDecode(y: number, mu: number): number {
  if (mu <= 0) return y;
  const s = Math.sign(y);
  const ay = Math.abs(y);
  return s * (Math.expm1(ay * Math.log1p(mu)) / mu);
}

// ---------- BT.601 conversions ----------
function YCbCr_to_RGB(y: number, cb: number, cr: number): Vec3 {
  const R = y + 1.402 * (cr - 128.0);
  const G = y - 0.34414 * (cb - 128.0) - 0.71414 * (cr - 128.0);
  const B = y + 1.772 * (cb - 128.0);
  return [R, G, B];
}
function RGB_to_YCbCr(R: number, G: number, B: number): Vec3 {
  const y = 0.299 * R + 0.587 * G + 0.114 * B;
  const cb = -0.1687 * R - 0.3313 * G + 0.5 * B + 128.0;
  const cr = 0.5 * R - 0.4187 * G - 0.0813 * B + 128.0;
  return [y, cb, cr];
}

// ---------- Forward: point -> YCbCr ----------
/**
 * point: internal coordinate in [-1..1]^3 (audio space)
 * enableMuLaw: whether to apply mu-law companding (default true for audio mode, false for binary mode)
 * Returns YCbCr (float), not clamped.
 */
function encodePointToYCbCr(point: Vec3, enableMuLaw: boolean = true): Vec3 {
  let pmu: Vec3;
  if (enableMuLaw) {
    pmu = [muLawEncode(point[0], MU[0]),
    muLawEncode(point[1], MU[1]),
    muLawEncode(point[2], MU[2])];
  } else {
    pmu = point;
  }
  // 2) scale by extents (half-widths)
  const scaled: Vec3 = [pmu[0] * OBB_EXTENTS[0], pmu[1] * OBB_EXTENTS[1], pmu[2] * OBB_EXTENTS[2]];

  // 3) rotate into YCbCr basis
  const rotated = mat3_mul_vec3(OBB_ROT, scaled);

  // 4) add center
  return [rotated[0] + OBB_CENTER[0], rotated[1] + OBB_CENTER[1], rotated[2] + OBB_CENTER[2]];
}

/** Convenience: point -> RGB (float) */
export function encodePointToRGB(point: Vec3, enableMuLaw: boolean = true): Vec3 {
  const ycbcr = encodePointToYCbCr(point, enableMuLaw);
  return YCbCr_to_RGB(ycbcr[0], ycbcr[1], ycbcr[2]);
}

// ---------- Reverse: YCbCr -> point ----------
/** Inverse mapping from YCbCr to internal point space. */
function decodeYCbCrToPoint(ycbcr: Vec3, enableMuLaw: boolean = true): Vec3 {
  // subtract center
  const shifted: Vec3 = [ycbcr[0] - OBB_CENTER[0], ycbcr[1] - OBB_CENTER[1], ycbcr[2] - OBB_CENTER[2]];

  // rotate back (R^T)
  const rotatedBack = mat3_mul_vec3(OBB_ROT_INV, shifted);

  // divide by extents
  const normed: Vec3 = [rotatedBack[0] / OBB_EXTENTS[0], rotatedBack[1] / OBB_EXTENTS[1], rotatedBack[2] / OBB_EXTENTS[2]];

  if (enableMuLaw) {
    return [muLawDecode(normed[0], MU[0]), muLawDecode(normed[1], MU[1]), muLawDecode(normed[2], MU[2])];
  } else {
    return [normed[0], normed[1], normed[2]];
  }
}

/** Convenience: RGB -> point */
export function decodeRGBToPoint(R: number, G: number, B: number, enableMuLaw: boolean = true): Vec3 {
  const ycbcr = RGB_to_YCbCr(R, G, B);
  return decodeYCbCrToPoint(ycbcr, enableMuLaw);
}

export function decodeBinaryRGBToPoint(R: number, G: number, B: number): Vec3 {
  const ycbcr = RGB_to_YCbCr(R, G, B);
  return decodeYCbCrToPoint(ycbcr, false);
}
