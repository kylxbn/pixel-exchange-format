// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import type { HuffmanTable } from './parser';

export class HuffmanDecoder {
  private minCode: Int32Array = new Int32Array(16).fill(0);
  private maxCode: Int32Array = new Int32Array(16).fill(-1);
  private valPtr: Int32Array = new Int32Array(16).fill(0);
  private values: Uint8Array;

  constructor(table: HuffmanTable) {
    this.values = table.values;
    this.buildTables(table.codeCounts);
  }

  private buildTables(counts: Uint8Array): void {
    let huffCode = 0;
    let accumulatedValueIndex = 0;

    for (let i = 0; i < 16; i++) {
      const count = counts[i];

      if (count === 0) {
        this.maxCode[i] = -1;
      } else {
        this.valPtr[i] = accumulatedValueIndex;
        this.minCode[i] = huffCode;
        this.maxCode[i] = huffCode + count - 1;

        accumulatedValueIndex += count;
        huffCode += count;
      }

      huffCode <<= 1;
    }
  }

  decode(bitStream: BitStream): number {
    let i = 0;
    let code = bitStream.readBit();

    while (code > this.maxCode[i]) {
      i++;
      if (i >= 16) {
        throw new Error('Huffman decode error: code not found in table');
      }
      code = (code << 1) | bitStream.readBit();
    }

    const j = this.valPtr[i] + (code - this.minCode[i]);
    return this.values[j];
  }
}

export class BitStream {
  private data: Uint8Array;
  private byteOffset: number = 0;
  private bitOffset: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readBits(n: number): number {
    if (n === 0) return 0;
    let result = 0;
    for (let i = 0; i < n; i++) {
      result = (result << 1) | this.readBit();
    }
    return result;
  }

  readBit(): number {
    if (this.byteOffset >= this.data.length) {
      return 1;
    }

    const byte = this.data[this.byteOffset];
    const bit = (byte >> (7 - this.bitOffset)) & 1;

    this.bitOffset++;
    if (this.bitOffset === 8) {
      this.bitOffset = 0;
      this.byteOffset++;

      // Handle Byte Stuffing (0xFF 00)
      if (byte === 0xFF) {
        if (this.byteOffset < this.data.length) {
          const nextByte = this.data[this.byteOffset];
          if (nextByte === 0x00) {
            this.byteOffset++;
          } else if (nextByte >= 0xD0 && nextByte <= 0xD7) {
            // should be handled by decoder
          }
        }
      }
    }

    return bit;
  }

  alignToByte(): void {
    if (this.bitOffset > 0) {
      const byte = this.data[this.byteOffset];
      this.bitOffset = 0;
      this.byteOffset++;

      if (byte === 0xFF) {
        if (this.byteOffset < this.data.length && this.data[this.byteOffset] === 0x00) {
          this.byteOffset++;
        }
      }
    }
  }

  peekByte(): number | null {
    if (this.byteOffset >= this.data.length) return null;
    return this.data[this.byteOffset];
  }

  skipByte(): void {
    if (this.byteOffset < this.data.length) {
      this.byteOffset++;
    }
  }

  get isEOF(): boolean {
    return this.byteOffset >= this.data.length;
  }
}