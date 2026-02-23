// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { Command } from 'commander';
import { PxfDecoder } from '@pixel-exchange-format/codec';
import type { BinaryDecodeDebugCapture } from '@pixel-exchange-format/codec';
import { readFileBuffer, isImageFile, getImageFormat } from '../utils/fileUtils.js';
import { decodeImage, toCodecImageData } from '../utils/imageUtils.js';

async function handleCheck(
    sources: string[]
): Promise<void> {
    try {
        console.log('🎨 Pixel Exchange Format - Check\n');

        if (sources.length === 0) {
            throw new Error('At least one source image is required');
        }

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

                return toCodecImageData(decoded);
            })
        );

        console.log('\n🔍 Reading metadata...\n');

        const preparedSources = imageData.map(img =>
            PxfDecoder.load(img)
        );

        const metadataResult = await PxfDecoder.decodeMetadataOnly(preparedSources);

        console.log(`📊 Format Version: ${metadataResult.visualizationMetadata.version}`);
        console.log(`📝 Metadata:`);
        for (const [key, value] of Object.entries(metadataResult.metadata)) {
            console.log(`   ${key}: ${value}`);
        }

        if (metadataResult.type !== 'binary') {
            console.log('\nℹ️  Check is currently supported for binary data only.\n');
            return;
        }

        console.log('\n🔎 Checking binary data...\n');

        const debugCapture: BinaryDecodeDebugCapture = { rowHealth: [], overallHealth: 0 };
        const fullResult = await PxfDecoder.decode(preparedSources, debugCapture) as any;

        console.log(`📦 Type: Binary Data`);
        console.log(`   Size: ${fullResult.data.length} bytes`);
        console.log(`   Checksum: ${fullResult.validChecksum ? '✅ Valid' : '⚠️  Invalid'}`);

        if (!fullResult.validChecksum) {
            console.warn('\n⚠️  Warning: Data checksum validation failed!');
            console.warn('   The decoded data may be corrupted.\n');
        }

        if (debugCapture.rowHealth && debugCapture.rowHealth.length > 0) {
            console.log('\n📈 Data Health (per row):');
            debugCapture.rowHealth.forEach((health, idx) => {
                const pct = Number.isFinite(health) ? health : 0;
                console.log(`   Row ${idx + 1}: ${pct.toFixed(2)}%`);
            });
            if (typeof debugCapture.overallHealth === 'number') {
                console.log(`\n📊 Overall Data Health: ${debugCapture.overallHealth.toFixed(2)}%`);
            }
        }

        console.log('\n✨ Check complete!\n');
    } catch (error) {
        console.error('\n❌ Check failed:');
        console.error(`   ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

export const checkCommand = new Command('check')
    .description('Validate PXF images and report data health (binary only)')
    .argument('<sources...>', 'Source PXF image(s) - supports PNG, JPEG, GIF, BMP, WebP, TIFF')
    .action(handleCheck);
