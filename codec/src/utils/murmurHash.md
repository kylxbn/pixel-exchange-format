---
order: 3
title: MurmurHash3 x64 128-bit
---

The format uses MurmurHash3 x64 128-bit for deterministic hashing operations. This non-cryptographic hash function provides fast, high-quality hashing with good avalanche properties and low collision rates.

## Algorithm Overview

MurmurHash3 processes input data in 16-byte blocks, maintaining two 64-bit internal states (h1 and h2). The algorithm uses fixed constants:
- C1 = 0x87c37b91114253d5
- C2 = 0x4cf5ad432745937f

## Block Processing

For each 16-byte block:
1. Load 8 bytes into k1 and k2 as little-endian 64-bit integers
2. Mix k1: multiply by C1, rotate left by 31 bits, multiply by C2
3. XOR k1 into h1
4. Mix h1: rotate left by 27 bits, add h2, multiply by 5, add 0x52dce729
5. Mix k2: multiply by C2, rotate left by 33 bits, multiply by C1
6. XOR k2 into h2
7. Mix h2: rotate left by 31 bits, add h1, multiply by 5, add 0x38495ab5

## Tail Processing

For remaining bytes (0-15):
- If more than 8 bytes, process upper bytes into k2 with mixing
- Process remaining bytes into k1 with mixing
- XOR mixed values into h1/h2 as appropriate

## Finalization

1. XOR input length into both h1 and h2
2. Combine states: h1 += h2, h2 += h1
3. Apply final mixing (fmix64) to both states:
   - XOR with right shift by 33
   - Multiply by 0xff51afd7ed558ccd
   - XOR with right shift by 33
   - Multiply by 0xc4ceb9fe1a85ec53
   - XOR with right shift by 33
4. Final combination: h1 += h2, h2 += h1

## Output

The 128-bit result (h1 and h2) is written as 16 bytes in little-endian order.

## Usage in Format

Current codec usage:
- Header fixed-region checksum (first 21 payload bytes)
- Header variable-region checksum (bytes `21..767`)

These two 128-bit hashes are stored in row 1 (last 4 blocks) and validated by the decoder.
