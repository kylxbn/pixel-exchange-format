---
order: 5
title: IEEE 754 Binary16 Conversion
---

The format uses IEEE 754 half-precision floating point (binary16) for efficient storage of floating-point coefficients. This provides 16-bit representation with 1 sign bit, 5 exponent bits, and 10 mantissa bits, offering a balance between precision and storage efficiency.

## Float32 to Binary16 Conversion

### Input Processing
- Convert input to IEEE 754 binary32 format
- Extract sign bit, 8-bit exponent, and 23-bit mantissa

### Special Cases
- NaN: Preserve sign, set exponent to 31, use upper 10 bits of mantissa (ensure non-zero)
- Infinity: Preserve sign, set exponent to 31, mantissa to 0
- Zero/Subnormal: For float32 subnormals (too small for half-precision), return signed zero

### Normalized Numbers
- Rebias exponent: float32 bias 127 -> half-precision bias 15 (subtract 112)
- If result exponent <= 0: treat as subnormal
- Round 23-bit mantissa to 10 bits using round-to-nearest-ties-to-even
- Handle rounding overflow by incrementing exponent

### Subnormal Numbers
- For exponents that would be < 1 in half-precision
- Add implicit leading 1 to mantissa
- Shift right by (14 - new_exponent) bits
- Apply rounding to the shifted value
- Return sign + rounded mantissa (exponent implicitly 0)

### Overflow Handling
- Exponents > 30 result in infinity
- Mantissa rounding overflow increments exponent

## Binary16 to Float32 Conversion

### Component Extraction
- Sign: bit 15
- Exponent: bits 10-14 (5 bits)
- Mantissa: bits 0-9 (10 bits)

### Value Calculation
- Zero (exp=0): (-1)^sign * 2^-14 * (mantissa/1024)
- Infinity (exp=31): +-inf based on sign bit
- NaN (exp=31, mantissa != 0): NaN
- Normalized: (-1)^sign * 2^(exp-15) * (1 + mantissa/1024)

## Rounding Mode

All conversions use round-to-nearest-ties-to-even, ensuring unbiased rounding and compliance with IEEE 754-2008 standards.

## Usage in Format

Half-precision conversion enables efficient storage of audio transform coefficients while maintaining acceptable reconstruction quality for perceptual coding applications.
