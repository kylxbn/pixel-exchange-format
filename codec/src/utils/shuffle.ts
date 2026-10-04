// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { BINARY_PERMUTATION_SEED } from "../constants";
import { LDPC_BINARY_N } from "./binaryModulation";
import { createRNG } from "./rng";

let binaryPermutation: Uint32Array | null = null;

/** Position in the codeword of each transmitted bit of a binary strip. The same for every strip. */
export function getBinaryPermutation(): Uint32Array {
    if (binaryPermutation) return binaryPermutation;

    const rng = createRNG(BINARY_PERMUTATION_SEED);
    const perm = new Uint32Array(LDPC_BINARY_N);
    for (let i = 0; i < perm.length; i++) {
        perm[i] = i;
    }

    // Fisher-Yates shuffle
    for (let i = perm.length - 1; i > 0; i--) {
        const j = (rng.next32() >>> 0) % (i + 1);
        const temp = perm[i];
        perm[i] = perm[j];
        perm[j] = temp;
    }

    binaryPermutation = perm;
    return perm;
}
