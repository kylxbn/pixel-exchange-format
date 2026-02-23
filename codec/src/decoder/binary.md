---
order: 23
title: Binary Mode Decoding
---

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
