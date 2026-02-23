---
order: 8
title: Data Permutation
---

The format uses deterministic permutation of binary data to improve error correction performance by scattering correlated data across the image.

## Binary Mode Permutation

For binary mode rows, data is permuted at the 2-bit pair level:

- Row data capacity: 2480 bytes = 19840 bits = 9920 pairs of 2 bits each
- Generate permutation array of 9920 indices (`0..9919`)
- Use Fisher-Yates shuffle with seeded RNG

## Fisher-Yates Algorithm

1. Initialize array with sequential indices [0, 1, 2, ..., n-1]
2. For i from n-1 downto 1:
   - Generate random j in [0, i] using seeded RNG
   - Swap array[i] and array[j]

## Seeding

Permutation seed combines format constant with row index for per-row uniqueness:
seed = BINARY_PERMUTATION_SEED + rowIndex

`rowIndex` here is the data-row index within the current image chunk (`0..numDataRows-1`), not the absolute image Y row.

## Usage in Format

Permutation is applied after LDPC parity generation, so parity still protects the original sequential byte order. The decoder inverts the permutation before LDPC decode.
