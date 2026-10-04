---
order: 8
title: Data Permutation
---

The format uses a deterministic permutation of binary data so that damage concentrated in one image block is scattered across the LDPC codeword.

## Binary Mode Permutation

A binary strip carries one codeword of `LDPC_BINARY_N = 64896` bits. The permutation is over single bits and is the same for every strip:

- Generate the index array `0..64895`
- Fisher-Yates shuffle it with the RNG seeded by `BINARY_PERMUTATION_SEED`

Transmitted bit `i` of the strip is bit `perm[i]` of the whitened codeword.

## Fisher-Yates Algorithm

1. Initialize array with sequential indices [0, 1, 2, ..., n-1]
2. For i from n-1 downto 1:
   - Generate random j in [0, i] using seeded RNG (`next32() mod (i + 1)`)
   - Swap array[i] and array[j]

## Usage in Format

The permutation is applied after LDPC encoding and whitening. The decoder writes the LLR of transmitted bit `i` to codeword position `perm[i]`, undoes the whitening by flipping signs, and then runs the LDPC decoder.
