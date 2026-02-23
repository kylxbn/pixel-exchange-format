# Pixel Exchange Format (PXF) Specification

Version 300 - Normative Technical Specification

This document provides a complete technical specification for the Pixel Exchange Format (PXF) version 300, enabling clean-room implementation of encoders and decoders.

---

## Format Constants

PXF v300 uses fixed constants shared by encoder and decoder implementations.

## Image and Row Layout

- `IMAGE_WIDTH = 1024`
- `BLOCK_SIZE = 8`
- `BLOCKS_PER_ROW = 128`
- `DATA_BLOCKS_PER_ROW = 124`
- `META_BLOCKS_PER_ROW = 4`
- `BYTES_PER_BLOCK = 8` for 1-bit block streams (header + metadata)

Rows are laid out as:
- Row 0: LDPC-protected header stream
- Row 1: text/info row (plus header checksums in last 4 blocks)
- Rows 2+: audio or binary data rows

## Header Constants

- `HEADER_TOTAL_BYTES = 1024`
- `HEADER_PAYLOAD_BYTES = 768`
- `HEADER_FIXED_BYTES = 21`
- `MAX_STRING_DATA_BYTES = 747`

Header LDPC uses:
- `N = 8192`
- `K = 6144`

## Audio Constants

- `MDCT_HOP_SIZE = 128`
- `MDCT_WINDOW_SIZE = 256`
- Stored coefficients per block: 96 (64 luma + 32 chroma-interleaved)
- SBR reconstructs bins `96..127`

Row metadata:
- `ROW_META_TOTAL_BYTES = 32`
- `ROW_META_PAYLOAD_BYTES = 28`
- `ROW_META_SBR_BYTES = 8`
- `ROW_META_AUDIO_BYTES = 20`

Subgroup constants:
- `SUBGROUP_A_SIZE = 62` (A/B split per row)
- `SUBGROUP_X_SIZE = 31` (X/Y split inside each half)

Band mapping for bins `0..63`:
- Band 0: bins `0..2`
- Band 1: bins `3..8`
- Band 2: bins `9..24`
- Band 3: bins `25..63`

## Binary Constants

Binary blocks are 4:2:0 YCbCr-mapped:
- `BINARY_BYTES_PER_BLOCK = 20`
- Per block: 16 bytes Y (2-bit symbols) + 2 bytes Cb (1-bit) + 2 bytes Cr (1-bit)

Per row:
- `BINARY_ROW_DATA_CAPACITY = 2480`
- `BINARY_ROW_META_BYTES = 32`
- `BINARY_ROW_PARITY_BYTES = 28`
- `BINARY_ROW_CRC_BYTES = 4`

Binary LDPC:
- `LDPC_BINARY_K = 19840`
- `LDPC_BINARY_N = 20064`

## Protocol and Seeds

- `FORMAT_VERSION = 300`

Channel modes:
- `0`: mono
- `1`: stereo mid
- `2`: stereo side
- `3`: binary

Whitening/permutation seeds:
- `HEADER_XOR_MASK_SEED = 0xe5b4d3bd`
- `ROW_META_XOR_SEED_BASE = 0xc4396125`
- `BINARY_PERMUTATION_SEED = 0xbf4d0153`

## Coefficient Orders and Mu-Law

Implemented scan orders:
- `ZIGZAG_8X8_FLAT`
- `ZIGZAG_4X4_FLAT`
- `RASTER_8X8_FLAT`
- `RASTER_4X4_FLAT`

Band-map assignment and active pixel scan selection are configured in `psychoacoustics.ts`:
- `AUDIO_PSYCHOACOUSTICS.bandMap`
- `AUDIO_PSYCHOACOUSTICS.blockMap.luma8x8`
- `AUDIO_PSYCHOACOUSTICS.blockMap.chroma4x4`

Mu-law values and audio stage toggles are configured in `psychoacoustics.ts`:
- `AUDIO_PSYCHOACOUSTICS.muLaw.luma`
- `AUDIO_PSYCHOACOUSTICS.muLaw.chromaCb`
- `AUDIO_PSYCHOACOUSTICS.muLaw.chromaCr`

## Misc

- `SILENCE_THRESHOLD = 1e-9`
- Default max image area in chunking path is `1024 * 4096 = 4,194,304` pixels

---

## Format Overview

The Pixel Exchange Format (PXF) v300 encodes audio or arbitrary binary data into fixed-width images. It combines deterministic transforms, forward error correction, and integrity checks so data can be reconstructed after common image degradation.

## Encoding Modes

### Audio Mode
Audio is encoded with:
- 256-sample MDCT windows (`hop = 128`)
- 96 stored bins per block (64 luma + 32 chroma-interleaved)
- 8-byte per-row SBR side data (for bins 96-127 reconstruction)
- Per-row LDPC-protected metadata for scaling and band factors

Stereo is represented as mid/side image pairs, not left/right image channels.

### Binary Mode
Binary mode stores 2480 bytes per data row. Payload symbols are mapped into YCbCr/RGB blocks (2-bit Y + 1-bit Cb + 1-bit Cr), then protected with row LDPC parity and CRC32C.

## Decoding Capabilities

Decoding supports:
- Full reconstruction from complete images
- Streaming/progressive audio decode via `StreamingAudioDecoder`
- Multi-image reassembly using header random bytes + image indices
- Source grouping by shared 4-byte random header salt; when multiple groups are present, the decoder uses the largest group

## Image Structure

All images are 1024 pixels wide:
- Row 0: LDPC-protected header stream
- Row 1: human-readable text row
- Rows 2+: audio or binary payload rows with per-row metadata in the final 4 blocks

## Channel Configurations

Audio mode supports:
- Mono: single channel audio
- Stereo mid (`channelMode=1`) and side (`channelMode=2`) images

Stereo decoding behavior:
- Side-only inputs are rejected
- Missing side images during mid/side decode fall back to mono (mid duplicated to both channels)

## Versioning and Compatibility

The implementation uses `FORMAT_VERSION = 300` with deterministic seeded whitening/permutation and precomputed LDPC graphs so encoder and decoder remain bit-compatible.

---

## MurmurHash3 x64 128-bit

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

---

## CRC32C Integrity Check

The format uses CRC32C (Castagnoli) for data integrity verification. This 32-bit cyclic redundancy check provides strong error detection capabilities, particularly effective against common data corruption patterns.

## Polynomial

CRC32C uses the polynomial 0x82F63B78 (Castagnoli polynomial), which provides better error detection than the traditional CRC32 polynomial, especially for short burst errors and some types of random errors.

## Table Generation

The lookup table is precomputed for each possible byte value (0-255):
1. For each byte i:
- Initialize c = i
- Perform 8 iterations of bit shifting and XOR with the polynomial
- Store the result in the table

## Computation

CRC computation follows standard CRC32C procedure:
1. Initialize CRC = 0xFFFFFFFF
2. For each byte in the data:
- Extract the lower 8 bits of CRC
- XOR with the current data byte
- Use result as table index to get new CRC value
- Right shift CRC by 8 bits and XOR with table value
3. Finalize by XOR with 0xFFFFFFFF

## Usage in Format

CRC32C is used in binary mode for row-level integrity checking, providing a 32-bit checksum to detect data corruption during storage or transmission.

---

## IEEE 754 Binary16 Conversion

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

---

## Mu-Law Companding

The format employs mu-law companding for efficient quantization of floating-point audio coefficients. This non-linear compression expands small values and compresses large values, improving signal-to-noise ratio for low-amplitude signals.

## Encoding Formula

For a normalized coefficient x (-1 <= x <= 1):

y = sign(x) * ln(1 + mu * |x|) / ln(1 + mu)

Where mu is the companding parameter.

## Decoding Formula

For a companded value y:

x = sign(y) * (exp(|y| * ln(1 + mu)) - 1) / mu

## Parameter Selection

- mu = 0: Linear encoding (no companding)
- mu > 0: Non-linear companding strength increases with mu
- Lower mu values stay closer to linear; higher mu values compress large magnitudes more aggressively

## Usage in Format

In the current OBB mapping path, per-axis values are:
- Luma (`Y`): `mu = 6`
- Chroma (`Cb`): `mu = 2`
- Chroma (`Cr`): `mu = 3`

Binary mode disables mu-law in the OBB mapping (`enableMuLaw = false`).

---

## Pseudorandom Number Generation

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

---

## Data Permutation

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

---

## Audio Processing Utilities

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

---

## Spectral Band Replication (SBR)

PXF SBR reconstructs high-frequency bins `96..127` from lower bins, using 8 bytes of row metadata (2 subgroups x 32-bit words).

## Row Layout

- `SBR_SUBGROUPS_PER_ROW = 2`
- `SBR_BYTES_PER_ROW = 8`
- Each subgroup carries one 32-bit SBR word.

## Dual Modes

Each 32-bit word uses `bit0` as mode flag:
- `0`: Normal mode (single parameter set)
- `1`: Temporal mode (shared slow params + A/B fast params)

### Normal Mode Bit Layout

- `[31:26]` hf gain (6 bits, 1 dB steps, -48..+15)
- `[25:14]` band envelope (4 bands x 3 bits)
- `[13:10]` noise floor ratio (4 bits)
- `[9:7]` tonality (3 bits)
- `[6:5]` patch mode (2 bits)
- `[4:3]` processing mode (2 bits)
- `[2:1]` transient shape (2 bits)
- `[0]` mode flag = 0

### Temporal Mode Bit Layout

- `[31:30]` patch mode (shared)
- `[29:28]` processing mode (shared)
- `[27:26]` tonality (shared, reduced precision)
- `[25:18]` band envelope (4 bands x 2 bits)
- `[17:13]` hf gain A (first half)
- `[12:11]` noise floor A
- `[10]` transient A
- `[9:5]` hf gain B (second half)
- `[4:3]` noise floor B
- `[2]` transient B
- `[1]` reserved
- `[0]` mode flag = 1

## Patch and Processing Modes

Patch mode source tiles:
- `0`: Adjacent (`64..95`)
- `1`: Lower (`48..79`)
- `2`: Bass (`32..63`)
- `3`: Mirror (parity-preserving mirror mapping)

Processing mode:
- `0`: Normal mix
- `1`: Transient/noise-aware
- `2`: Harmonic cubic shaping
- `3`: Inverse odd-bin polarity

Current encoder behavior:
- The analyzer currently emits `processing mode = 0` (normal) in both normal and temporal packets.
- Decoder synthesis supports all four processing modes.

## Synthesis

For each HF bin:
1. Pick source bin via patch mode.
2. Compute interpolated gain (junction-aware in dB).
3. Apply processing mode transform.
4. Mix tonal + deterministic noise components.
5. Write scaled value to bins `96..127`.

Noise is deterministic from a content-derived or external seed, so behavior is reproducible.

## Encoder Analysis

Row analysis computes subgroup parameters from source/target energy:
- Chooses patch mode with minimal energy mismatch.
- Derives hf gain, band envelope, tonality, and noise ratio.
- Switches to temporal mode when intra-subgroup variation is high (`|hfGainA-hfGainB| > 4 dB` or energy-variation ratio `> 0.5`).

## Usage in Format

SBR keeps payload at 96 stored bins per block while reconstructing full 128-bin IMDCT input.

---

## Oriented Bounding Box Mapping

The format uses an optimized oriented bounding box (OBB) mapping to encode three-dimensional audio coefficient data into RGB pixel values, maximizing the utilization of the RGB color space for quantization.

## OBB Parameters

Precomputed optimal bounding box for RGB color space utilization:
- **Center**: [127.426, 128.000, 128.000] in YCbCr space
- **Extents**: [41.159, 61.527, 48.638] (half-widths in YCbCr)
- **Rotation Matrix**: X axis fixed, Y/Z plane rotated by ~90.005deg for fit
- **Inverse Rotation**: Transpose for decoding

## Encoding Process

For a 3D point p = [x, y, z] in normalized coefficient space (-1 to 1):

1. Apply mu-law compression per axis:
- x' = sign(x) * ln(1 + mu_luma * |x|) / ln(1 + mu_luma)
- y' = sign(y) * ln(1 + mu_cb * |y|) / ln(1 + mu_cb)
- z' = sign(z) * ln(1 + mu_cr * |z|) / ln(1 + mu_cr)

2. Scale by extents:
- s = [x' * hx, y' * hy, z' * hz]

3. Rotate into OBB orientation:
- r = R * s

4. Translate by center:
- ycbcr = r + center

5. Convert YCbCr to RGB using BT.601 matrix

## Decoding Process

Reverse the encoding:

1. Convert RGB to YCbCr using BT.601 inverse
2. Subtract center: shifted = ycbcr - center
3. Rotate back: rotated = R^T * shifted
4. Divide by extents: normed = rotated / extents
5. Apply mu-law expansion per axis (audio mode path)

## mu-Law Parameters

- Luma (Y): mu = 6
- Chroma Cb: mu = 2
- Chroma Cr: mu = 3

Binary mode bypasses mu-law in this mapping.

## BT.601 Color Conversion

Forward (YCbCr -> RGB):
- R = Y + 1.402 * (Cr - 128)
- G = Y - 0.34414 * (Cb - 128) - 0.71414 * (Cr - 128)
- B = Y + 1.772 * (Cb - 128)

Inverse (RGB -> YCbCr):
- Y = 0.299 * R + 0.587 * G + 0.114 * B
- Cb = -0.1687 * R - 0.3313 * G + 0.5 * B + 128
- Cr = 0.5 * R - 0.4187 * G - 0.0813 * B + 128

## Usage in Format

OBB mapping enables efficient storage of quantized audio coefficients in image pixels, optimizing for the perceptual characteristics of the RGB color space.

---

## Low Density Parity Check (LDPC) Codes

The format employs Low Density Parity Check (LDPC) codes for forward error correction, providing robust data recovery from corrupted or noisy image pixels. The implementation uses systematic construction with layered Sum-Product Algorithm decoding.

## Code Structure

LDPC codes are defined by sparse parity check matrices H of dimension m*n:
- n: Total codeword length (bits)
- k: Data length (information bits)
- m: Parity length (n - k)

The format uses systematic codes with a staircase parity structure (`H = [H_d | H_p]`, where `H_p` is dual-diagonal), enabling efficient parity accumulation during encoding.

## Graph Construction

### Progressive Edge Growth (PEG)

The data portion H_d is constructed using PEG algorithm to maximize code girth:

1. Initialize bipartite graph with m check nodes and n variable nodes
2. For each data variable (0 to k-1):
- Add 3 edges to check nodes using PEG selection
- PEG selects check nodes that maximize shortest cycle length

### Staircase Parity Structure

The parity portion uses a dual-diagonal staircase:
- For parity variable `p_i` at column `(k + i)`, connect to check `i` (diagonal).
- For `i < m-1`, also connect `p_i` to check `(i + 1)` (sub-diagonal).
- Equivalent check-node view:
- check `0` sees `p_0`
- check `i` (`1..m-1`) sees `p_{i-1}` and `p_i`

This allows parity accumulation during encoding and message propagation during decoding.

## Encoding Algorithm

Systematic encoding computes parity bits p such that H * [d | p]^T = 0:

1. Initialize parity bits to 0
2. For each data bit set to 1, XOR into connected parity positions
3. Apply staircase accumulation: p_i = p_{i-1} XOR p_i for i = 1 to m-1
4. Concatenate data and parity bits

## Decoding Algorithm

### Layered Sum-Product Algorithm (SPA)

Iterative belief propagation on the bipartite graph:

1. Initialize variable LLRs with channel observations
2. Initialize check-to-variable messages R to 0
3. For each iteration (up to 50):
- For each check node c:
- Compute variable-to-check messages: L_vc = Lq[v] - R_old[edge]
- Update check-to-variable messages: R_new = 2 * artanh(PRODUCT_{v != target} tanh(L_vc/2))
- Update posterior LLRs: Lq[v] += R_new - R_old
- Check syndrome: if H * hard_decision = 0, success

### Ordered Statistics Decoding (OSD)

Post-processing for failed SPA convergence:
1. Sort variable nodes by LLR magnitude (reliability)
2. Try flipping the 15 least reliable bits
3. Check syndrome after each flip
4. Return first valid codeword found

## Parameters

- **Header LDPC**: N=8192, K=6144 (rate 0.75)
- **Row Metadata LDPC**: N=256, K=224 (rate 0.875)
- **Binary LDPC**: N=20064, K=19840 (rate ~0.989)

## Usage in Format

LDPC provides error correction for:
- Header data (global metadata)
- Per-row audio metadata
- Binary payload data

Enabling reliable data recovery from image corruption or transmission errors.

---

## MDCT Bin Whitening

The codec applies deterministic whitening to stored MDCT bins (`0..95`) to flatten average spectral energy before spatial mapping.

## What It Does

- A reference average-magnitude table (measured at 32 kHz) is used as the anchor.
- For arbitrary sample rates, per-bin averages are derived from bin-center frequency:
- interpolate inside the measured 32 kHz range
- use a fitted power-law tail for frequencies above that range
- For each stored bin `k`, encoder scales by:
- `gain[k] = 1 / max(avgAbs[k], 1e-12)`
- Decoder reverses the operation by multiplying by `max(avgAbs[k], 1e-12)`.

## Scope

- Applied only to bins `0..95` (the bins physically stored in blocks).
- Not applied to SBR-reconstructed bins `96..127`.
- In the encoder pipeline, whitening is applied after SBR analysis so SBR sees original MDCT coefficients.

## Determinism

Given a sample rate, whitening/de-whitening is deterministic and bit-reproducible across encoder and decoder.

---

## Audio Mode Format

Audio mode encodes PCM into 1024px-wide images using MDCT-domain compression, per-row metadata, and deterministic transforms.

## Channel Handling

- Mono uses `channelMode = 0`.
- Stereo is encoded as mid/side image pairs:
- Mid image: `channelMode = 1`
- Side image: `channelMode = 2`
- Pair indexing is deterministic per chunk:
- mid images use odd `imageIndex` values (`1, 3, 5, ...`)
- side images use the following even index (`2, 4, 6, ...`)
- `totalImages` is `2 * numChunks` for stereo
- Mid/side signals are:
- `mid = (L + R) * 0.5`
- `side = (L - R) * 0.5`

## Image Layout

- Row 0: header
- Row 1: text/info row
- Rows 2+: audio payload rows

Each payload row has:
- 124 data blocks (one audio block per data block)
- 4 metadata blocks (row metadata, 32 bytes after LDPC)

## Block Pipeline

For each audio block (`hop = 128`, `window = 256`):

1. Apply sine window and compute 128-bin MDCT.
2. Keep bins `0..95` as stored payload coefficients.
3. Keep full 128 bins temporarily for SBR analysis.

Per row, the encoder then:

1. Runs SBR analysis and encodes 8 bytes of row SBR metadata.
2. Applies static MDCT whitening to stored bins `0..95`.
3. Computes subgroup band factors (4 bands over bins `0..63`).
4. Applies subgroup band factors to bins `0..63`.
5. Maps coefficients to:
- 8x8 luma DCT coefficients (`bins 0..63`)
- 4x4 chroma DCT coefficients (`bins 64..95`, interleaved Cb/Cr)
6. Runs IDCT to spatial domain.
7. Computes row scaling factors to avoid clipping.
8. Writes pixels via OBB mapping (point space -> YCbCr -> RGB).

## Row Metadata Encoding

Row metadata payload is 28 bytes:

- Bytes `0..7`: SBR row bytes
- Bytes `8..19`: six half-floats (`scaleYA`, `scaleYB`, `scaleCAX`, `scaleCAY`, `scaleCBX`, `scaleCBY`)
- Bytes `20..27`: subgroup band factors (`A[4]`, `B[4]`) via log encoding

This 28-byte payload is LDPC-encoded to 32 bytes, whitened with a row-specific seed, and written to the final 4 blocks of the row.

## Multi-Image Chunking

- Audio is chunked by max image height (default 4096px).
- Split points are aligned to MDCT hop boundaries.
- Header fields carry image index and total image count for reassembly.

---

## Binary Mode Format

Binary mode stores arbitrary data in Pixel Exchange Format images. Large files are split across multiple images with error correction and integrity checking.

## Image Structure

### Row Layout
- Row 0: Header (format metadata)
- Row 1: Text information (human-readable)
- Rows 2+: Data rows with payload and metadata

### Data Row Format
Each data row contains:
- 124 data blocks: 2480 bytes of binary data
- 4 metadata blocks: 32 bytes of error correction and integrity data

## Data Encoding

### Pixel Mapping
Each 8x8 data block stores 20 bytes total using a 4:2:0-style split:
- 16 bytes for luma (`Y`): 64 samples, each 2-bit Gray-coded
- 2 bytes for `Cb`: 16 samples, each 1 bit
- 2 bytes for `Cr`: 16 samples, each 1 bit

Luma Gray symbols map to point values:
- `00 -> -1.0`
- `01 -> -1/3`
- `11 -> +1/3`
- `10 -> +1.0`

The `(Y, Cb, Cr)` point triplets are converted to RGB through the OBB mapping with mu-law disabled in binary mode.

### LDPC and Permutation Order
1. LDPC parity is computed on sequential row bytes (2480 bytes).
2. CRC32C is computed on the same sequential bytes.
3. Row payload is then permuted at the 2-bit-pair level using a deterministic row seed.
4. Permuted payload is written to data blocks; parity+CRC are written to the metadata blocks.

Implementation notes:
- Final partial rows are zero-padded to 2480 bytes before LDPC/CRC.
- Permutation row index is local to each image chunk (`0..numRows-1` per image), so decoder uses the same per-chunk indexing.

## Metadata and Error Correction

### Row Metadata (32 bytes)
- 28 bytes: LDPC error correction parity
- 4 bytes: CRC32 integrity checksum

Metadata is stored as 1 bit per pixel in the last 4 blocks of each row.

## Multi-Image Files

Large binary data is split across multiple images:
- Each image contains a sequential chunk of data
- Header indicates total images and current index
- Images are processed in order to reconstruct complete files

## Header Information

The global header provides:
- Per-image chunk size and data parameters
- Channel mode (binary = 3)
- Random seed for reproducible processing
- Multi-image sequencing metadata
- User-defined metadata dictionary

## Output Format

Images are 1024 pixels wide with height determined by data size. PNG format ensures lossless storage.

---

## Header Format

The header occupies the first row of every Pixel Exchange Format image, containing essential metadata and format parameters protected by error correction.

## Header Structure

### Fixed Fields (21 bytes)
- Bytes 0-1: format version (`300`, uint16 little-endian)
- Bytes 2-5: sample rate for audio (`uint32 LE`), `0` for binary mode
- Bytes 6-9: total samples for audio, or chunk byte size for binary (`uint32 LE`)
- Bytes 10-11: metadata byte length (`uint16 LE`)
- Byte 12: channel mode (`0=mono`, `1=stereo mid`, `2=stereo side`, `3=binary`)
- Bytes 13-16: random bytes used for grouping/seeded behavior
- Bytes 17-18: image index (`uint16 LE`, 1-based)
- Bytes 19-20: total images (`uint16 LE`)

### Variable Metadata
- Key/value map is sorted by key before serialization.
- Buffer format: `pairCount (1 byte)` then packed entries.
- Each entry starts with a 16-bit word (`big-endian` for this local field):
- upper 4 bits: key length (`0..15`)
- lower 12 bits: value length (`0..4095`)
- Then raw UTF-8 key bytes followed by UTF-8 value bytes.
- Total variable payload max is `747` bytes.

## Error Correction and Integrity

- Header payload is `768` bytes, LDPC encoded to `1024` bytes (`K=6144`, `N=8192`).
- The 1024-byte codeword is whitened with deterministic bytes from `HEADER_XOR_MASK_SEED`.
- Implementation detail: each codeword byte is XORed with `nextByte() ^ nextByte()` from the seeded PRNG.
- Header bits are written as 1-bit pixels across row 0.
- Two MurmurHash3 x64 128-bit checksums are written separately:
- hash of fixed 21-byte header region
- hash of the full 747-byte variable region (`payload[21..767]`, including zero padding)
- These 32 checksum bytes are stored in the last 4 blocks of row 1.

## Usage in Format

The header provides all information needed to decode images:
- Audio parameters (sample rate, channels, duration)
- Binary chunk size and metadata
- Multi-image sequencing information
- Random seeds for reproducible processing
- User-defined metadata

---

## Multi-Image Chunking

Chunking splits large audio or binary payloads into multiple images while preserving deterministic decoder reassembly.

## Defaults

- Default `maxHeight` is `4096` pixels.
- With fixed width `1024`, default max image area is `4,194,304` pixels.

## Audio Chunking

Audio chunking is hop-aligned:

1. Compute max usable audio capacity from `maxHeight`:
- total block rows = `floor(maxHeight / 8)`
- remove 2 rows for header/text
- remaining rows contribute `124` audio blocks per row
- each audio block = one MDCT hop (`128` samples)
2. Align per-image sample capacity to hop boundaries.
3. Slice each channel with the same sample boundaries.

This guarantees chunk boundaries do not break MDCT hop alignment.

## Binary Chunking

Binary chunking is byte-based:

1. Compute max data rows = `floor(maxHeight / 8) - 2`.
2. Per-row capacity is `2480` bytes.
3. Slice the payload into contiguous chunks of `maxDataRows * 2480` bytes.

## Reassembly Metadata

Each chunk/image header stores:
- `imageIndex` (1-based)
- `totalImages`
- shared `randomBytes` group identifier

Decoder sorts by `imageIndex` within matching `randomBytes` groups to rebuild the full payload.

---

## Encoder Entry Point

`PxfEncoder` is the high-level encoding API used by consumers of the codec package.

## Public API

`PxfEncoder.encode(data, metadata?, options?, onProgress?)`:
- Accepts either:
- `data.audio` (`channels: Float32Array[]`, `sampleRate`)
- `data.binary` (`Uint8Array`)
- Returns `Promise<EncodedImageResult[]>` where each result contains:
- `data` (RGBA pixel buffer)
- `width`, `height`
- `name` (default filename with optional chunk suffix)

If both `audio` and `binary` are present, current implementation takes the audio path first.

## Metadata Validation

Before encoding, metadata is validated as UTF-8:
- Maximum pairs: `255`
- Maximum key size: `15` bytes
- Maximum value size: `4095` bytes
- Serialized metadata budget: `MAX_STRING_DATA_BYTES` (`747` bytes), including the initial pair-count byte and per-pair 2-byte length words

Validation errors throw before any encoding work begins.

## Dispatch Behavior

- Audio input dispatches to `AudioEncoder.encodeAudio(...)`
- Binary input dispatches to `BinaryEncoder.encodeBinary(...)`
- Missing input throws `No data provided to encode.`

`options.maxHeight` is forwarded to chunking logic (default chunking target is 4096 px image height).

---

## Row Scaling Strategy

`ScalingUtils.calculateRowScalingFactors(...)` computes per-row gains that keep encoded spatial values inside safe range before OBB mapping.

## Subgroup Layout

Each audio data row is split as:
- A/B halves by block index (`SUBGROUP_A_SIZE = 62`)
- X/Y split inside each half (`SUBGROUP_X_SIZE = 31`)

This yields six scale factors:
- `scaleYA`, `scaleYB` (luma)
- `scaleCAX`, `scaleCAY`, `scaleCBX`, `scaleCBY` (chroma)

## Computation

For each subgroup, encoder scans absolute maxima:
- Luma: max over 64 spatial Y samples per block
- Chroma: max over 16 spatial Cb and 16 spatial Cr samples per block

Scale is then:
- `min(65504, 1 / maxAbs)` when signal is above `SILENCE_THRESHOLD`
- `65504` for silent groups

`65504` is used because it is the largest finite IEEE binary16 value and protects row-metadata half-float storage from overflow.

---

## Text Row Rendering

`TextRenderer.drawTextRow(...)` writes the human-readable info row (row 1) using a compact bitmap font.

## Rendering Rules

- Font: 3x5 glyphs (`FONT_GLYPHS`), 1-pixel horizontal spacing
- Start position:
- `x = 4` pixels left padding
- `y = rowIndex * 8 + 2` (vertical centering inside the 8-pixel row)
- Unknown characters use `UNKNOWN_GLYPH`
- Characters are uppercased at render time

## Safety Boundary

Renderer reserves the rightmost 4 blocks:
- max text x-limit is `width - BLOCK_SIZE * 4`
- this keeps space for header checksum bytes stored in row 1 tail blocks

## Pixel Writes

Only foreground white pixels are written (`RGB=255`); background pixels are left unchanged.

---

## Decoding Requirements

Decoders must support both audio and binary mode decoding from PXF images, including multi-image grouping, ordering, and row-level error correction.

## Input Processing

Decoders must:
- Parse the header from the first image row of each image
- Extract format metadata, parameters, and integrity checks
- Validate format version compatibility
- Reject mixed audio+binary source sets in one decode call
- Group multi-image sequences by random seed
- Sort images by index within each sequence
- If multiple groups are present, decode the largest group
- Tolerate incomplete sequences (implementation warns and decodes available images)

## Decoding Modes

### Audio Mode
Decoders must reconstruct PCM audio data with:
- Support for mono and stereo configurations
- Proper sample rate from header
- Mid/side pairing support (`mode 1 + mode 2`)
- Full reconstruction of bins `0..127` via stored bins + SBR synthesis
- Side-only input rejection

### Binary Mode
Decoders must extract arbitrary binary data with:
- Error correction and integrity validation
- Support for files split across multiple images
- Pair-level permutation reversal before LDPC decode

## Error Correction

Decoders must implement LDPC error correction for:
- Header data (6144 data bits, 8192 total bits)
- Row metadata (224 data bits, 256 total bits)
- Binary payload data (19840 data bits, 20064 total bits)

Various LDPC decoding algorithms may be used, with soft-decision decoding providing better performance but not strictly required.

## Output Requirements

### Audio Output
- Float32Array channels matching original sample rate
- Proper duration based on total samples from header
- Support for mono and stereo mid/side reconstruction

### Binary Output
- Concatenated byte data from multi-image sequences
- Integrity validation using included checksums
- Metadata extraction for filenames and user data

## Metadata-Only Path

`decodeMetadataOnly` returns:
- Full binary decode for binary mode (same as normal path)
- Audio metadata + initialized streaming decoder for audio mode, without decoding PCM up front

## Usage in Format

The format enables reliable data recovery with error correction, supporting both complete decoding and streaming applications.

---

## Header Decoding

The header decoder extracts format metadata and parameters from the first image row, performing error correction and validation to recover the original data.

## Header Row Processing

The first image row contains the header data encoded as 1 bit per pixel (1024 bytes total). Decoders must:

1. Extract 1024 bytes from the header row pixels
2. Unwhiten with the deterministic XOR stream (`HEADER_XOR_MASK_SEED`)
- Implementation detail: each byte uses `nextByte() ^ nextByte()`
3. Apply LDPC decoding to recover the 768-byte payload
4. Parse fixed + variable metadata
5. Validate MurmurHash checksums

## Header Payload Structure

### Fixed Fields (21 bytes)
- Bytes 0-1: format version (uint16, little-endian)
- Bytes 2-5: sample rate (uint32, little-endian); `0` for binary
- Bytes 6-9: total samples (audio) or chunk byte size (binary), uint32 little-endian
- Bytes 10-11: metadata length (uint16, little-endian)
- Byte 12: Channel mode
- Bytes 13-16: random bytes
- Bytes 17-18: image index (uint16, little-endian)
- Bytes 19-20: total images (uint16, little-endian)

### Variable Metadata
- Format: `pairCount (1 byte)` followed by entries.
- Each entry begins with a packed 16-bit length word:
- top 4 bits: key length (`<= 15`)
- low 12 bits: value length (`<= 4095`)
- Then UTF-8 key bytes and UTF-8 value bytes.

## Error Correction

Header uses systematic LDPC (`K=6144`, `N=8192`).

## Integrity Verification

Two MurmurHash3 x64 128-bit checksums are validated:
- hash of fixed 21-byte region
- hash of the full 747-byte variable region (`payload[21..767]`, including zero padding)

These 32 bytes are stored in the last 4 blocks of row 1.

## Usage in Format

The decoded header provides:
- Format version and compatibility information
- Audio parameters (sample rate, channel configuration)
- Binary chunk metadata and size
- Multi-image sequencing for large files
- Random seeds for deterministic processing
- User-defined metadata dictionary

---

## Binary Mode Decoding

Binary mode decoding reconstructs data from Pixel Exchange Format images. Multi-image files are processed in sequence to recover complete binary data.

## Multi-Image Processing

Images are sorted by index from the header and processed sequentially. Each image contains a chunk of the total data with its position indicated in the header.

## Row Processing

For each data row (rows 2+), decoders must:

1. Read 124 data blocks carrying 2480 bytes of payload symbols.
2. Decode block RGB through inverse OBB mapping (binary mode path).
3. Reconstruct:
- 64 luma samples per block (2-bit each, Gray-coded)
- 16 Cb + 16 Cr samples per block (1-bit each)
4. Build soft LLRs for the 19840 data bits.
5. Read metadata blocks (32 bytes total):
- 28 bytes parity (soft LLR extraction)
- 4 bytes stored CRC32C
6. Reverse the row permutation at 2-bit-pair level.
7. LDPC decode full codeword (`K=19840`, `N=20064`).
8. Validate row CRC32C on decoded sequential bytes.

## Data Reconstruction

### Pixel to Byte Mapping
Each 8x8 data block maps to 20 bytes:
- 16 bytes Y (2-bit symbols)
- 2 bytes Cb (1-bit symbols)
- 2 bytes Cr (1-bit symbols)

### Permutation Reversal
Permutation is defined over 2-bit pairs and must be inverted before LDPC decode, because parity was computed on sequential (pre-permuted) data.

### Error Correction
LDPC decoding (`19840 -> 20064` bits) corrects row errors. CRC32C verifies integrity.

## Output Assembly

Decoded chunk data from all images is concatenated in index order to reconstruct the full binary payload.

## Usage in Format

Binary mode enables reliable storage and transmission of arbitrary data through images, with error correction ensuring data integrity.

---

## Audio Mode Decoding

Audio mode decoding reconstructs PCM audio from Pixel Exchange Format images. The process reverses the encoding pipeline to recover time-domain audio samples.

## Multi-Image Processing

Images are grouped by random seed and sorted by index. If multiple groups are present, the decoder uses the largest group. Stereo mid/side pairs are identified and decoded together. Incomplete sequences are handled gracefully.

For stereo sources, implementation validation includes:
- Mid indices must be odd; side indices must be even
- `totalImages` must be even
- Mid/side partners must match on `randomBytes` and `totalSamples`

## Row Processing

For each data row, decoders must:

1. Decode row metadata (32 bytes) with LDPC + whitening
2. Process 124 data blocks containing quantized coefficients
3. Extract RGB pixel values from 8*8 blocks
4. Apply inverse OBB mapping to recover YCbCr coefficients
5. Apply mu-law expansion (audio mode path)
6. Perform 8\*8 IDCT on luma and 4\*4 IDCT on chroma
7. Reverse spatial scaling and band factors
8. Reverse static MDCT bin whitening (bins 0-95)
9. Synthesize bins 96-127 using SBR row data
10. Perform 128-point IMDCT, windowing, and overlap-add

If row metadata decode fails (or yields invalid values), decoder falls back to neutral defaults (unit scales, unit band factors, no SBR side data) for that row.

## Coefficient Processing

### Spatial to Frequency Domain
- RGB pixels are mapped back to YCbCr coefficients using inverse OBB transform
- Mu-law expansion restores linear point-space values
- IDCT converts spatial blocks to frequency domain coefficients
- Adaptive scaling compensates for quantization effects
- Chroma scaling includes a row scan compensation step in the implementation to counter chroma attenuation from RGB round-trip effects

### Frequency Domain Processing
- Band factors restore original coefficient magnitudes
- SBR synthesizes bins 96-127 from source tiles in lower bands
- Deterministic noise generation ensures reproducible high frequencies
- Stereo mid/side decoding uses channel-specific SBR seeds so synthesized noise is decorrelated between mid and side channels

## Time Domain Reconstruction

### IMDCT and Windowing
- 128-point IMDCT produces 256 samples per transform
- Sine windowing with 50% overlap (TDAC)
- Overlap-add combines adjacent windows

### Channel Reconstruction
- Mono: single channel output
- Stereo mid/side: L = M+S, R = M-S
- Side-only input is rejected unless paired with mid
- If a side image is missing for a mid image, decoder falls back to duplicated mid (mono in stereo container)

## Output Format

Decoded audio is provided as Float32Array channels matching the original sample rate and duration from the header.

## Usage in Format

Audio decoding recovers high-quality PCM audio with perceptual coding optimizations, supporting both batch processing and real-time streaming playback.

---

## LLR Lookup Models

This module precomputes pixel-to-LLR lookup tables used by soft-decision decoding.

## Tables

- `LLR_LOOKUP_1BIT_LUMA` (size 256)
- `LLR_LOOKUP_1BIT_CHROMA` (size 256)
- `LLR_LOOKUP_2BIT` (size 256 x 2)

All values are clamped to `[-20, +20]`.

## Noise Model

LLRs use a distance-based Laplacian-style model:
- luma sigma: `12.0`
- chroma sigma: `40.0`

Larger sigma gives softer confidence.

## Symbol Assumptions

### 1-bit paths
- Candidate centroids: `0` and `255`
- Positive LLR means bit `0` is more likely
- Negative LLR means bit `1` is more likely

### 2-bit path
- Candidate centroids: `[0, 85, 170, 255]`
- Bitwise grouping:
- MSB: `{0,85}` vs `{170,255}`
- LSB: `{0,255}` vs `{85,170}`

These tables are consumed by binary payload and metadata LDPC decode paths.

---

## Build Metadata

`buildInfo.ts` stores build-time version identifiers:

- `VERSION` (semantic release version)
- `BUILD_NUMBER` (incrementing build id)
- `BUILD_HASH` (short source hash)

In `codec/src/index.ts`, package-level `VERSION` is exported as:

`<VERSION>-<BUILD_HASH>`

This makes runtime version reporting deterministic for debugging and compatibility checks.

---

## Audio Row Math (Encoder)

`processRow(...)` is the core per-row audio DSP pipeline used by `AudioEncoder`.

## Responsibilities

For each audio row, it:
1. Builds MDCT blocks (128 bins) from windowed audio
2. Runs row-level SBR analysis and serializes 8 SBR bytes
3. Applies static whitening to stored bins `0..95`
4. Computes subgroup band maxima and quantized band factors (A/B)
5. Maps bins to luma/chroma coefficient planes and runs IDCT
6. Computes subgroup scaling factors via `ScalingUtils`
7. Scales, upsamples chroma (4x4 -> 8x8), and writes RGB pixels through OBB mapping
8. Emits row metadata through injected callback (`writeRowMetadata`)

## Storage Mapping

- Luma: bins `0..63` -> `8x8` coefficients (selected by `AUDIO_PSYCHOACOUSTICS.blockMap.luma8x8`)
- Chroma: bins `64..95` interleaved Cb/Cr -> `4x4` coefficients (selected by `AUDIO_PSYCHOACOUSTICS.blockMap.chroma4x4`)

Band factors are computed over bins `0..63` and quantization is mirrored in analysis by `logDecode(logEncode(...))`.

---

## Audio Block Math (Decoder)

`decodeBlock(...)` is the inverse DSP path for one audio block.

## Responsibilities

Given one 8x8 image block plus row metadata, it:
1. Reads RGB pixels and converts to point-space Y/Cb/Cr via inverse OBB
2. Averages chroma from 8x8 samples into 4x4 planes (4:2:0 style)
3. Reverses row scaling (divide by `maxY` / `maxC`)
4. Runs forward DCT (`8x8` luma, `4x4` chroma)
5. Rebuilds flattened coefficient vector (bins `0..95`)
6. Reverses subgroup band scaling (divide by band factors)
7. Reverses static MDCT whitening
8. Reconstructs bins `96..127` with SBR (or zero-fills if no SBR bytes)
9. Runs IMDCT and applies MDCT window

## Determinism Notes

- SBR synthesis accepts an optional external seed for reproducible/noise-controlled decode behavior.
- If scaling or band factors are invalid (`0`), function outputs silence for stability.

## Debug Capture

Optional capture buffers can snapshot:
- raw spatial planes
- flattened MDCT bins before and after reversal stages

---

## Bitmap Font

`font.ts` defines the fixed 3x5 bitmap glyph set used for row-1 info text rendering.

## Data Model

- `FONT_GLYPHS: Record<string, number[]>`
- 5 rows per glyph
- each row is a 3-bit mask (`0..7`)
- `UNKNOWN_GLYPH`
- fallback shape for unsupported characters

Example row encoding:
- `7` = `111`
- `5` = `101`
- `2` = `010`

Glyphs are consumed by `TextRenderer.drawTextRow(...)`.

---
