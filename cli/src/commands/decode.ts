// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { Command } from 'commander';
import { PxfDecoder } from '@pixel-exchange-format/codec';
import type { BinaryDecodeDebugCapture } from '@pixel-exchange-format/codec';
import { readFileBuffer, writeFileBuffer, isImageFile, getImageFormat, generateOutputFilename } from '../utils/fileUtils.js';
import { decodeImage, toCodecImageData } from '../utils/imageUtils.js';
import { encodeWav } from '../utils/audioUtils.js';

/**
 * Main decode handler
 */
async function handleDecode(
    sources: string[],
    options: {
        output?: string;
        info?: boolean;
        verbose?: boolean;
    }
): Promise<void> {
    try {
        console.log('🎨 Pixel Exchange Format - Decoder\n');

        // Validate input files
        if (sources.length === 0) {
            throw new Error('At least one source image is required');
        }

        console.log(`📁 Source(s): ${sources.length} image(s)`);
        sources.forEach((source, index) => {
            console.log(`   ${index + 1}. ${source}`);
        });

        // Read and decode images
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

        // Prepare sources for decoder
        console.log('\n🔍 Reading metadata...\n');

        const preparedSources = imageData.map(img =>
            PxfDecoder.load(img)
        );

        // Decode metadata first
        const result = await PxfDecoder.decodeMetadataOnly(preparedSources);

        // Display metadata information
        console.log(`📊 Format Version: ${result.visualizationMetadata.version}`);
        console.log(`📝 Metadata:`);
        for (const [key, value] of Object.entries(result.metadata)) {
            console.log(`   ${key}: ${value}`);
        }

        // Get filename from metadata for later use
        const filename = result.metadata.filename || 'unknown.bin';

        // If info-only mode, stop here
        if (options.info) {
            console.log('\nℹ️  Info-only mode, skipping decode\n');
            return;
        }

        // Decode based on type
        if (result.type === 'audio') {
            console.log(`\n🎵 Type: Audio`);
            console.log(`   Sample Rate: ${result.sampleRate} Hz`);
            console.log(`   Channels: ${preparedSources.length === 2 ? 'Stereo' : 'Mono'}`);
            console.log(`   Duration: ${(result.decoder.totalSamples / result.sampleRate).toFixed(2)}s`);

            console.log('\n🔄 Decoding audio...\n');

            // Decode all audio data
            const decoded = result.decoder.decodeAll();

            console.log(`   ✅ Decoded ${decoded.channels.length} channel(s)`);
            console.log(`   Samples: ${decoded.channels[0].length}`);

            // Encode as WAV
            console.log('\n💾 Encoding WAV file...');
            const wavData = encodeWav(decoded.channels, decoded.sampleRate);

            // Determine output path
            const outputPath = options.output ||
                generateOutputFilename(sources[0], undefined, '_decoded', 'wav');

            // Write WAV file
            await writeFileBuffer(outputPath, Buffer.from(wavData));

            console.log(`   ✅ ${outputPath}`);
            console.log(`   Size: ${(wavData.byteLength / 1024).toFixed(2)} KB`);

        } else if (result.type === 'binary') {
            // Decode full binary data
            const debugCapture: BinaryDecodeDebugCapture | null = options.verbose ? { rowHealth: [], overallHealth: 0 } : null;
            const fullResult = await PxfDecoder.decode(preparedSources, debugCapture) as any; // Type assertion since BinaryResult still has old format

            console.log(`\n📦 Type: Binary Data`);
            console.log(`   Size: ${fullResult.data.length} bytes`);
            console.log(`   Checksum: ${fullResult.validChecksum ? '✅ Valid' : '⚠️  Invalid'}`);

            if (!fullResult.validChecksum) {
                console.warn('\n⚠️  Warning: Data checksum validation failed!');
                console.warn('   The decoded data may be corrupted.\n');
            }

            if (options.verbose && debugCapture?.rowHealth && debugCapture.rowHealth.length > 0) {
                console.log('\n📈 Data Health (per row):');
                debugCapture.rowHealth.forEach((health, idx) => {
                    const pct = Number.isFinite(health) ? health : 0;
                    console.log(`   Row ${idx + 1}: ${pct.toFixed(2)}%`);
                });
                if (typeof debugCapture.overallHealth === 'number') {
                    console.log(`\n📊 Overall Data Health: ${debugCapture.overallHealth.toFixed(2)}%`);
                }
            }

            // Determine output path
            let outputPath = options.output || preparedSources[0].metadata.filename;

            if (!outputPath) {
                outputPath = generateOutputFilename(sources[0], undefined, '_decoded', 'bin');
            }

            // Write binary file
            await writeFileBuffer(outputPath, Buffer.from(fullResult.data));

            console.log(`\n💾 Saved: ${outputPath}`);
            console.log(`   Size: ${(fullResult.data.length / 1024).toFixed(2)} KB`);
        }

        console.log('\n✨ Decoding complete!\n');

    } catch (error) {
        console.error('\n❌ Decoding failed:');
        console.error(`   ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

/**
 * Configure and export the decode command
 */
export const decodeCommand = new Command('decode')
    .description('Decode PXF images back to audio or binary data')
    .argument('<sources...>', 'Source PXF image(s) - supports PNG, JPEG, GIF, BMP, WebP, TIFF - automatically recombines multiple images')
    .option('-o, --output <path>', 'Output file path (default: auto-generated)')
    .option('-i, --info', 'Display metadata information only, without decoding')
    .option('-v, --verbose', 'Show per-row and overall health statistics (binary only)')
    .action(handleDecode);
