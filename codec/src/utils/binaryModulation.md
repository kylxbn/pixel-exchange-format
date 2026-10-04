---
order: 30
title: Binary Modulation
---

Binary mode writes its bits as PAM symbols on 8x8 DCT coefficients, placed on the block grid a 4:2:0 JPEG encoder uses. The pixels are what that DCT synthesizes, so a JPEG encoder finds the symbols again in its own coefficients and its quantizer moves each one by at most half a step.

## Strip

The unit is a strip: 16 pixel rows across the full 1024 px width, which is 64 MCUs of 16x16 px. An MCU holds:

- four 8x8 luma blocks, one DCT block each
- one 8x8 Cb block and one 8x8 Cr block, each spanning the whole 16x16 px (every chroma sample is written to a 2x2 pixel group)

The DCT is the orthonormal 8x8 DCT-II on values offset by 128, as in JPEG. Colour conversion is JFIF YCbCr (BT.601 full range).

## Bit Loading

Coefficient `k` (raster order inside the block) carries `bits[k]` bits as one of `2^bits[k]` levels spaced `step[k]` apart and centred on zero:

`amplitude = (index - (2^bits - 1) / 2) * step`

The steps follow the libjpeg quantization tables at quality 90: `step = 1.15 * q + 2` for luma and `step = 1.2 * q + 2` for chroma, where `q` is the quantizer step of that coefficient. The fixed 2 covers pixel rounding in the colour conversions on both sides of the transport.

Luma bits (211 per block):

```
5 5 5 5 4 3 3 3
5 5 5 4 4 3 3 3
5 5 5 4 3 3 3 3
5 5 4 4 3 3 3 3
4 4 4 3 3 2 2 3
4 4 3 3 3 2 2 2
3 3 3 3 2 2 2 2
3 2 2 2 2 2 2 2
```

Chroma bits (85 per block):

```
3 3 3 2 1 1 1 1
3 3 3 2 1 1 1 1
3 3 2 1 1 1 1 1
2 2 1 1 1 1 1 1
1 1 1 1 1 1 1 1
1 1 1 1 1 1 1 1
1 1 1 1 1 1 1 1
1 1 1 1 1 1 1 1
```

Luma quantizer steps at quality 90:

```
 3  2  2  3  5  8 10 12
 2  2  3  4  5 12 12 11
 3  3  3  5  8 11 14 11
 3  3  4  6 10 17 16 12
 4  4  7 11 14 22 21 15
 5  7 11 13 16 21 23 18
10 13 16 17 21 24 24 20
14 18 19 20 22 20 21 20
```

Chroma quantizer steps at quality 90:

```
 3  4  5  9 20 20 20 20
 4  4  5 13 20 20 20 20
 5  5 11 20 20 20 20 20
 9 13 20 20 20 20 20 20
20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20
20 20 20 20 20 20 20 20
```

The bit counts are the greedy loading that fills a pixel standard deviation of 38 (luma) and 14 (chroma) with these steps.

An MCU carries `4 * 211 + 2 * 85 = 1014` bits and a strip `64 * 1014 = 64896` bits, 3.96 bits per pixel before error correction.

## Bit Order

The coded bits of a strip are consumed MCU by MCU, left to right. Inside an MCU the blocks come in the order top-left, top-right, bottom-left, bottom-right luma, then Cb, then Cr. Inside a block the coefficients come in raster order. Each coefficient reads its bits most significant first as a Gray code `g`; the level index is the Gray decode of `g`, so neighbouring levels differ in one bit.

## Fitting the RGB Cube

A sum of 64 independent symbols occasionally leaves the range a pixel can hold, and a decoder only ever sees clamped RGB. The encoder therefore repeats eight times:

1. convert the strip to RGB with chroma replicated 2x2 and clamp to `0..255`
2. convert back, averaging chroma over each 2x2 group
3. take the DCT of every block and limit each coefficient's deviation from its symbol to `0.15 * step`; the lowest and highest level of a coefficient may move outward without limit
4. inverse DCT

The final pixels are the clamped, rounded RGB of the last result. Decoders do not need to know this step exists.

## Demodulation

The decoder converts RGB to YCbCr, averages chroma over 2x2 groups and takes the same DCTs. It never looks at a JPEG file's quantization tables or coefficients; the input is pixels.

Noise is estimated per coefficient position and plane (Y, Cb, Cr) over all strips of the image: the RMS distance between each received coefficient and its nearest level, plus 0.05.

Each bit's LLR is `ln(sum of likelihoods of levels whose Gray bit is 0 / sum for bit 1)`, clamped to +-25, with the level likelihood

`0.98 * exp(-z) + (0.02 / 3) * exp(-z / 9)`, `z = distance^2 / (2 * sigma^2)`

The second term is a three times wider Gaussian that keeps an outlier from being read as a certain wrong symbol.

## Whitening

The LDPC codeword of strip `s` is XORed with a byte mask taken from the RNG seeded with `BINARY_SCRAMBLE_SEED + s` (`nextByte()` per codeword byte). Without it, a run of equal payload bytes would put every coefficient on the same level.
