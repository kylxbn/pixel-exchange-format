// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { BINARY_PERMUTATION_SEED, BINARY_ROW_DATA_CAPACITY } from "../constants";
import { createRNG } from "./rng";

export function generateBinaryPermutation(rowIndex: number): Uint16Array {
    const rng = createRNG(BINARY_PERMUTATION_SEED + rowIndex);

    // Permute at 2-bit pair level: 1984 bytes = 7936 pairs
    const numPairs = BINARY_ROW_DATA_CAPACITY * 4; // 7936
    const perm = new Uint16Array(numPairs);
    for (let i = 0; i < numPairs; i++) {
        perm[i] = i;
    }

    // Fisher-Yates shuffle on bit pairs
    for (let i = numPairs - 1; i > 0; i--) {
        const j = (rng.next32() >>> 0) % (i + 1);
        const temp = perm[i];
        perm[i] = perm[j];
        perm[j] = temp;
    }

    return perm;
}