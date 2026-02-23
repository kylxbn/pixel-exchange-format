---
order: 22
title: Header Decoding
---

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
