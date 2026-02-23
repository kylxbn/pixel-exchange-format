---
order: 4
title: CRC32C Integrity Check
---

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
