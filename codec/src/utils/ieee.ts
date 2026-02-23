// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * IEEE 754-2008 verified implementation
 */

const floatView = new Float32Array(1);
const uint32View = new Uint32Array(floatView.buffer);

/**
 * Converts a JS number (double/float32) to IEEE 754 Binary16 (Half Precision).
 * Accurate to IEEE 754-2008 standards including:
 * - Round to Nearest, Ties to Even
 * - Correct Subnormal handling
 * - Signed Infinity and NaN payload preservation
 */
export function floatToHalf(val: number): number {
    // 1. Force value into Float32 to align with standard rounding first
    floatView[0] = val;
    const x = uint32View[0];

    // 2. Extract Float32 components
    const sign = (x >>> 16) & 0x8000; // Sign bit (moved to pos 15)
    let exp = (x >>> 23) & 0xff;      // Exponent (8 bits)
    let mant = x & 0x7fffff;          // Mantissa (23 bits)

    // ----------------------------------------
    // Case 1: NaN or Infinity
    // ----------------------------------------
    if (exp === 255) {
        if (mant !== 0) {
            // NaN
            // We strip the top 13 bits of the Float32 mantissa.
            // If the result is 0, we add a bit to ensure it remains NaN (not Inf).
            // (0x200 is the MSB of the half-float mantissa, making it a Quiet NaN)
            return sign | 0x7c00 | ((mant >>> 13) || 0x200);
        }
        return sign | 0x7c00; // Infinity
    }

    // ----------------------------------------
    // Case 2: Zero or very small numbers
    // ----------------------------------------
    if (exp === 0) {
        // Float32 subnormals are smaller than the smallest Float16 subnormal.
        // They simply flush to zero (signed).
        return sign; 
    }

    // ----------------------------------------
    // Case 3: Normalized and Subnormal Outputs
    // ----------------------------------------
    
    // Rebias the exponent: 
    // Float32 bias is 127. Float16 bias is 15. Difference is 112.
    let newExp = exp - 112;

    // Handle Float32 values that become Float16 subnormals
    if (newExp <= 0) {
        // If the number is too small to represent even as a subnormal, return signed zero.
        // (Smallest subnormal exponent is effectively -14. If value < 2^-25, it's 0)
        if (newExp < -10) return sign; 

        // Add the implicit leading 1 bit from the normalized Float32
        mant |= 0x800000;

        // Calculate how much we need to shift to fit into subnormal land.
        // Standard shift is 13 (23 -> 10 bits).
        // Extra shift is required to get exponent down to 0.
        const shift = 14 - newExp;

        // Apply Rounding (Round to Nearest, Ties to Even)
        // We are shifting away `shift` bits.
        const outputMant = mant >>> shift;
        const roundBit = (mant >>> (shift - 1)) & 1; // The highest bit being discarded
        // Check if ANY bits below the round bit are set (Sticky bits)
        const stickyBits = mant & ((1 << (shift - 1)) - 1); 

        // Round up if:
        // 1. Round bit is 1 AND Sticky bits are > 0 (Standard nearest)
        // 2. Round bit is 1 AND Sticky bits are 0 AND Result bit 0 is 1 (Tie break to even)
        if (roundBit && (stickyBits || (outputMant & 1))) {
            return sign | (outputMant + 1);
        }

        return sign | outputMant;
    }

    // Handle Normal numbers
    
    // Check for overflow to Infinity before we mess with mantissa
    if (newExp > 30) {
        return sign | 0x7c00; 
    }

    // Standard Rounding (Round to Nearest, Ties to Even)
    // We want to keep the top 10 bits of the 23-bit mantissa.
    // So we drop the bottom 13 bits.
    const outputMant = mant >>> 13;
    const roundBit = (mant >>> 12) & 1;     // Bit 12
    const stickyBits = mant & 0xfff;        // Bits 0-11

    let resultMant = outputMant;

    // Round up condition (Nearest, Ties to Even)
    if (roundBit && (stickyBits || (resultMant & 1))) {
        resultMant++;
        
        // Check if rounding caused overflow (e.g. 1111111111 + 1 = 10000000000)
        if (resultMant > 0x3ff) {
            newExp++;
            resultMant = 0; // Mantissa becomes 0, exponent increments
            
            // Did exponent overflow to Infinity?
            if (newExp > 30) {
                return sign | 0x7c00;
            }
        }
    }

    return sign | (newExp << 10) | resultMant;
}

/**
 * Converts IEEE 754 Binary16 to JS number.
 */
export function halfToFloat(h: number): number {
    const s = (h & 0x8000) >> 15;
    const e = (h & 0x7c00) >> 10;
    const f = h & 0x03ff;

    if (e === 0) {
        // Subnormal: (-1)^s * 2^-14 * (f / 1024)
        return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    } else if (e === 0x1f) {
        // NaN / Infinity
        return f ? NaN : (s ? -Infinity : Infinity);
    } else {
        // Normalized: (-1)^s * 2^(e-15) * (1 + f/1024)
        return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
    }
}
