// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * Based on Point-Space [-1, 1] stats:
 * Avg StdDev ~ 0.078 * (255/2) ~= 9.95.
 * We use 12.0 to be slightly conservative against the heavy-tailed outliers.
 */
const LUMA_SIGMA = 12.0;

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

const LLR_LOOKUP_1BIT_LUMA: number[] = generateLLR1Bit(LUMA_SIGMA);

export { LLR_LOOKUP_1BIT_LUMA };
