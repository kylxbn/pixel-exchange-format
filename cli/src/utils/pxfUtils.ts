// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { PxfDecoder } from '@pixel-exchange-format/codec';
import type { ImageSource, BinaryResult, BinaryDecodeDebugCapture } from '@pixel-exchange-format/codec';
import { readFileBuffer, isImageFile, getImageFormat } from './fileUtils.js';
import { decodeImage } from './imageUtils.js';

// Mirrors the codec's CHANNEL_MODE.BINARY (not exported by the codec)
const CHANNEL_MODE_BINARY = 3;

export function isBinarySource(source: ImageSource): boolean {
    return source.channelMode === CHANNEL_MODE_BINARY;
}

/**
 * Reads, decodes and parses the PXF header of each source image.
 */
export async function loadSources(sources: string[]): Promise<ImageSource[]> {
    console.log(`📁 Source(s): ${sources.length} image(s)`);
    sources.forEach((source, index) => {
        console.log(`   ${index + 1}. ${source}`);
    });

    console.log('\n🔄 Loading images...\n');

    const imageData = await Promise.all(
        sources.map(async (source, index) => {
            const buffer = await readFileBuffer(source);

            if (!isImageFile(buffer)) {
                throw new Error(`${source} is not a supported image file`);
            }

            const decoded = await decodeImage(buffer);
            const format = getImageFormat(buffer) || 'unknown';
            console.log(`   ✅ Image ${index + 1}: ${decoded.width}x${decoded.height} (${format.toUpperCase()})`);

            return decoded;
        })
    );

    console.log('\n🔍 Reading metadata...\n');

    return imageData.map(img => PxfDecoder.load(img));
}

export function printSourceInfo(source: ImageSource): void {
    console.log(`📊 Format Version: ${source.visualizationMetadata.version}`);
    console.log(`📝 Metadata:`);
    for (const [key, value] of Object.entries(source.metadata)) {
        console.log(`   ${key}: ${value}`);
    }
}

export function printBinaryReport(result: BinaryResult, debugCapture: BinaryDecodeDebugCapture | null): void {
    console.log(`📦 Type: Binary Data`);
    console.log(`   Size: ${result.data.length} bytes`);
    console.log(`   Checksum: ${result.validChecksum ? '✅ Valid' : '⚠️  Invalid'}`);

    if (!result.validChecksum) {
        console.warn('\n⚠️  Warning: Data checksum validation failed!');
        console.warn('   The decoded data may be corrupted.\n');
    }

    if (debugCapture && debugCapture.rowHealth.length > 0) {
        console.log('\n📈 Data Health (per row):');
        debugCapture.rowHealth.forEach((health, idx) => {
            const pct = Number.isFinite(health) ? health : 0;
            console.log(`   Row ${idx + 1}: ${pct.toFixed(2)}%`);
        });
        if (typeof debugCapture.overallHealth === 'number') {
            console.log(`\n📊 Overall Data Health: ${debugCapture.overallHealth.toFixed(2)}%`);
        }
    }
}
