---
order: 16
title: Header Format
---

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
