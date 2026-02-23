// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { BINARY_ROW_DATA_CAPACITY, BLOCK_SIZE, BLOCKS_PER_ROW, CHANNEL_MODE, DATA_BLOCKS_PER_ROW, FORMAT_VERSION, HEADER_PAYLOAD_BYTES, HEADER_TOTAL_BYTES, HEADER_XOR_MASK_SEED, headerLdpc, IMAGE_WIDTH, MDCT_HOP_SIZE } from "../constants";
import { PxfDecoder } from ".";
import { bytesToNumber, decodeBytesFromBlocks } from "../utils/audioUtils";
import { MurmurHash3_x64_128 } from "../utils/murmurHash";
import { createRNG } from "../utils/rng";

export interface RawImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface VisualizationMetadata {
    hopSize: number;
    firstAudioBlockIndex: number;
    sampleRate: number;
    blocksPerRow: number;
    totalAudioBlocks: number;
    version: number;
}

export interface ImageSource {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    channelMode: number;
    visualizationMetadata: VisualizationMetadata;
    totalSamples: number;
    sampleRate: number;
    metadata: Record<string, string>;
    randomBytes: Uint8Array;
    imageIndex: number;
    totalImages: number;
}

export class HeaderDecoder {
    public static parseHeader(imgData: RawImageData): ImageSource {
        const { data, width, height } = imgData;

        // Validate image width
        if (width !== IMAGE_WIDTH) {
            throw new Error(`Invalid image width: ${width}. Expected ${IMAGE_WIDTH}px.`);
        }

        // Read LLRs from pixels using existing function
        const llrs = PxfDecoder.computeLdpcInputFromBlocks(HEADER_TOTAL_BYTES, data, width, 0);

        // Apply whitening by flipping LLR signs (equivalent to XOR on bits)
        // This unwhitens the data before LDPC decoding
        // Match encoder: each byte is XORed with TWO PRNG bytes
        const headerMaskGen = createRNG(HEADER_XOR_MASK_SEED);
        for (let byteIdx = 0; byteIdx < HEADER_TOTAL_BYTES; byteIdx++) {
            // Get two mask bytes and XOR them together (matching encoder)
            const mask1 = headerMaskGen.nextByte();
            const mask2 = headerMaskGen.nextByte();
            const combinedMask = mask1 ^ mask2;

            // For each bit in this byte, flip LLR sign if mask bit is 1
            for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
                const maskBit = (combinedMask >>> (7 - bitIdx)) & 1;
                if (maskBit === 1) {
                    llrs[byteIdx * 8 + bitIdx] = -llrs[byteIdx * 8 + bitIdx];
                }
            }
        }

        // LDPC Decode
        const decoded = headerLdpc.decode(llrs);
        const fullPayload = decoded.data; // 768 bytes

        // Check header checksum
        const headerChecksum = MurmurHash3_x64_128.hash(fullPayload.slice(0, 21))
        const stringChecksum = MurmurHash3_x64_128.hash(fullPayload.slice(21));

        const retrievedHeaderChecksum = decodeBytesFromBlocks(32, data, IMAGE_WIDTH, 128 * 2 - 4);

        const isEqualBytes = (bytes1: Uint8Array, bytes2: Uint8Array): boolean => {
            if (bytes1.length !== bytes2.length) {
                return false;
            }

            for (let i = 0; i < bytes1.length; i++) {
                if (bytes1[i] !== bytes2[i]) {
                    return false;
                }
            }

            return true;
        }

        if (!isEqualBytes(headerChecksum, retrievedHeaderChecksum.slice(0, 16))) {
            throw new Error("Header Checksum incorrect.");
        } else if (!isEqualBytes(stringChecksum, retrievedHeaderChecksum.slice(16, 32))) {
            throw new Error("Header String Payload Checksum incorrect.");
        }

        let offset = 0;
        const version = bytesToNumber(fullPayload.slice(offset, offset + 2)); offset += 2;

        if (version !== FORMAT_VERSION) throw new Error(`Unsupported version: ${version}. This decoder expects ${FORMAT_VERSION}.`);

        const sampleRate = bytesToNumber(fullPayload.slice(offset, offset + 4)); offset += 4;
        const totalSamples = bytesToNumber(fullPayload.slice(offset, offset + 4)); offset += 4;

        const stringDataLength = bytesToNumber(fullPayload.slice(offset, offset + 2)); offset += 2;
        const channelMode = fullPayload[offset]; offset += 1;
        const randomBytes = fullPayload.slice(offset, offset + 4); offset += 4;
        const imageIndex = bytesToNumber(fullPayload.slice(offset, offset + 2)); offset += 2;
        const totalImages = bytesToNumber(fullPayload.slice(offset, offset + 2)); offset += 2;

        const maxLen = Math.min(stringDataLength, HEADER_PAYLOAD_BYTES - offset);
        const metadataData = fullPayload.slice(offset, offset + maxLen);

        // Parse metadata
        let metadata: Record<string, string> = {};
        let ptr = 0;
        if (metadataData.length > 0) {
            const numPairs = metadataData[ptr++];
            const textDecoder = new TextDecoder();
            for (let i = 0; i < numPairs; i++) {
                if (ptr + 2 > metadataData.length) {
                    throw new Error("Malformed metadata: insufficient data for pair");
                }
                const lenWord = (metadataData[ptr] << 8) | metadataData[ptr + 1];
                ptr += 2;
                const keyLen = lenWord >> 12;
                const valueLen = lenWord & 0xfff;
                if (keyLen > 15 || valueLen > 4095) {
                    throw new Error("Malformed metadata: invalid key/value length");
                }
                if (ptr + keyLen + valueLen > metadataData.length) {
                    throw new Error("Malformed metadata: insufficient data for key/value");
                }
                const key = textDecoder.decode(metadataData.slice(ptr, ptr + keyLen));
                ptr += keyLen;
                const value = textDecoder.decode(metadataData.slice(ptr, ptr + valueLen));
                ptr += valueLen;
                metadata[key] = value;
            }
        }

        const hopSize = MDCT_HOP_SIZE; // 128 with SBR
        const totalAudioBlocks = Math.ceil(totalSamples / hopSize);

        // Validate minimum height based on content
        const minRows = channelMode === CHANNEL_MODE.BINARY
            ? 2 + Math.ceil(totalSamples / BINARY_ROW_DATA_CAPACITY)
            : 2 + Math.ceil(totalAudioBlocks / DATA_BLOCKS_PER_ROW);
        const expectedMinHeight = minRows * BLOCK_SIZE;

        if (height < expectedMinHeight) {
            console.warn(`Image height ${height}px is insufficient for content. Expected at least ${expectedMinHeight}px. Output may be corrupted.`);
        }

        return {
            data,
            width,
            height,
            channelMode,
            totalSamples,
            sampleRate,
            metadata,
            randomBytes,
            imageIndex,
            totalImages,
            visualizationMetadata: {
                hopSize,
                firstAudioBlockIndex: 2 * BLOCKS_PER_ROW,
                sampleRate,
                blocksPerRow: BLOCKS_PER_ROW,
                totalAudioBlocks, version
            }
        };
    }
}
