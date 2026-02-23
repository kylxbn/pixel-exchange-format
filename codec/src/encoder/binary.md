---
order: 15
title: Binary Mode Format
---

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
