// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * Based on Point-Space [-1, 1] stats:
 * Avg StdDev ~ 0.078 * (255/2) ~= 9.95.
 * We use 12.0 to be slightly conservative against the heavy-tailed outliers.
 */
const LUMA_SIGMA = 12.0;
const CHROMA_SIGMA = 40.0;

function generateLLR1Bit(
    sigma: number,
    Lmax: number = 20, 
): number[] {
    const table: number[] = new Array(256);
    
    // 1-bit Centroids: 0 and 255
    // Decision boundary is 127.5
    for (let y = 0; y < 256; y++) {
        // Distances
        const d0 = Math.abs(y - 0);
        const d1 = Math.abs(y - 255);
        
        // Log-Likelihood Ratio for Laplacian Noise
        // LLR = ln( P(0) / P(1) )
        // Positive LLR -> Likely 0
        // Negative LLR -> Likely 1 (255)
        let llr = (d1 - d0) / sigma;

        // Clamp
        if (llr >  Lmax) llr =  Lmax;
        if (llr < -Lmax) llr = -Lmax;

        table[y] = llr;
    }

    return table;
}

function generateLLR2Bit(
    sigma: number,
    Lmax: number = 20, 
): number[][] {
    const table: number[][] = new Array(256);

    // 2-bit Centroids (I confirmed these are the optimal values)
    const centroids = [0, 85, 170, 255];

    for (let y = 0; y < 256; y++) {
        
        // 1. Calculate raw distance to all 4 theoretical centers
        const d0   = Math.abs(y - centroids[0]); // 00
        const d85  = Math.abs(y - centroids[1]); // 01
        const d170 = Math.abs(y - centroids[2]); // 11
        const d255 = Math.abs(y - centroids[3]); // 10

        // 2. Compute MSB LLR (Bit 0)
        // Group 0: {0, 85}  vs  Group 1: {170, 255}
        // "How close is y to the nearest '0' symbol vs the nearest '1' symbol?"
        const minDistMSB0 = Math.min(d0, d85);
        const minDistMSB1 = Math.min(d170, d255);
        
        let llrMSB = (minDistMSB1 - minDistMSB0) / sigma;
        llrMSB = Math.max(-Lmax, Math.min(Lmax, llrMSB));

        // 3. Compute LSB LLR (Bit 1)
        // Group 0: {0, 255} vs  Group 1: {85, 170}
        const minDistLSB0 = Math.min(d0, d255);
        const minDistLSB1 = Math.min(d85, d170);

        let llrLSB = (minDistLSB1 - minDistLSB0) / sigma;
        llrLSB = Math.max(-Lmax, Math.min(Lmax, llrLSB));

        table[y] = [llrMSB, llrLSB];
    }

    return table;
}

const LLR_LOOKUP_1BIT_CHROMA: number[] = generateLLR1Bit(CHROMA_SIGMA);
const LLR_LOOKUP_1BIT_LUMA: number[] = generateLLR1Bit(LUMA_SIGMA);
const LLR_LOOKUP_2BIT: number[][] = generateLLR2Bit(LUMA_SIGMA);

export { LLR_LOOKUP_1BIT_CHROMA, LLR_LOOKUP_1BIT_LUMA, LLR_LOOKUP_2BIT };
