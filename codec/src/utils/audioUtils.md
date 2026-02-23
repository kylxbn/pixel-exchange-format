---
order: 9
title: Audio Processing Utilities
---

The format uses several mathematical transforms and encoding utilities for audio compression and image data handling.

## Modified Discrete Cosine Transform (MDCT)

### Forward MDCT (128-point from 256 samples)
For input signal x[n] (n = 0 to 255), output coefficients X[k] (k = 0 to 127):

X[k] = sum(n=0 to 255) x[n] * cos(pi * (k + 0.5) * (n + 64.5) / 128)

### Inverse MDCT (256 samples from 128 coefficients)
For coefficients X[k], output signal x[n]:

x[n] = (2/128) * sum(k=0 to 127) X[k] * cos(pi * (k + 0.5) * (n + 64.5) / 128)

## Windowing

Time-domain windowing uses sine window for TDAC:

w[n] = sin(pi * (n + 0.5) / 256) for n = 0 to 255

## 2D Discrete Cosine Transform (8*8)

### Forward DCT
Separable transform applied as row DCT then column DCT:

For 8*8 block, coefficients F[u,v]:
- Row transform: temp[u,v] = sum(x=0 to 7) f[u,x] * C(u) * cos(pi * u * (2x+1)/16)
- Column transform: F[u,v] = sum(y=0 to 7) temp[y,v] * C(v) * cos(pi * v * (2y+1)/16)

Where C(w) = 1/sqrt(2) for w=0, 1 otherwise, and overall scale sqrt(2/8)

### Inverse DCT
Similar separable application in reverse order.

## 2D Discrete Cosine Transform (4*4)

### Forward DCT
For 4*4 chroma blocks:

F[u,v] = sum(x=0 to 3) sum(y=0 to 3) f[x,y] * C(u) * C(v) * cos(pi * u * (2x+1)/8) * cos(pi * v * (2y+1)/8)

With C(w) = 1/sqrt(2) for w=0, 1 otherwise, scale sqrt(2/4)

### Inverse DCT
Symmetric inverse transform.

## Pixel Data Encoding

Header and metadata bitstreams are encoded into image pixels at block level:
- Each 8*8 block stores 64 bits (64 pixels)
- Bit-to-pixel mapping: MSB first within bytes
- White pixel (255) = 1, black pixel (0) = 0

## Logarithmic Gain Encoding

Band gains use logarithmic encoding for compression:

### Encoding
For gain value g (0 <= g <= 2.0):

code = round(255 * ln(1 + g) / ln(1 + 2.0))

### Decoding
For encoded value c:

g = (1 + 2.0)^(c / 255) - 1

Implementation detail:
- `logEncode` clamps input gain to `BAND_MAX_GAIN = 2.0` before encoding.

## Usage in Format

These transforms provide the mathematical foundation for audio frequency domain processing, spatial image compression, and data encoding into visual formats.
