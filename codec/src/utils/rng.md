---
order: 7
title: Pseudorandom Number Generation
---

The format uses deterministic pseudorandom number generation for seeded randomization operations, ensuring reproducible results across different implementations.

## Seeding

Initial seeding uses SplitMix64 to generate two 64-bit seeds from a single 32-bit input:

1. Convert 32-bit seed to 64-bit
2. Apply SplitMix64: z = (seed + 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF
3. Mix: z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9 & 0xFFFFFFFFFFFFFFFF
4. Mix: z = (z ^ (z >> 27)) * 0x94D049BB133111EB & 0xFFFFFFFFFFFFFFFF
5. Final: z ^ (z >> 31)
6. Generate second seed by applying SplitMix64 again to the first result

## XorShift128+ Generator

The main PRNG uses XorShift128+ algorithm with 128-bit state:

- State: two 64-bit values (s0, s1)
- For each output:
  - x = s0, y = s1
  - s0 = y
  - x ^= x << 23
  - s1 = x ^ y ^ (x >> 17) ^ (y >> 26)
  - Return (s1 + y) & 0xFFFFFFFFFFFFFFFF

## Output Functions

- next64(): Full 64-bit random value
- next32(): Upper 32 bits of 64-bit value
- nextByte(): Upper 8 bits of 64-bit value

## Usage in Format

Deterministic RNG is used for:
- Header whitening masks
- Audio row-metadata whitening masks
- Binary-row permutation shuffles
- Header random-byte group identifiers

Using fixed seeds keeps encoder/decoder behavior reproducible.
