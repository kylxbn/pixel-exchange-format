// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { Command } from 'commander';
import { PxfDecoder } from '@pixel-exchange-format/codec';
import type { BinaryDecodeDebugCapture } from '@pixel-exchange-format/codec';
import { writeFileBuffer, generateOutputFilename, assertOutputsWritable, sanitizeFilename } from '../utils/fileUtils.js';
import { encodeWav } from '../utils/audioUtils.js';
import { loadSources, printSourceInfo, printBinaryReport } from '../utils/pxfUtils.js';

/**
 * Main decode handler
 */
async function handleDecode(
    sources: string[],
    options: {
        output?: string;
        info?: boolean;
        verbose?: boolean;
        force?: boolean;
    }
): Promise<void> {
    try {
        console.log('🎨 Pixel Exchange Format - Decoder\n');

        const preparedSources = await loadSources(sources);

        printSourceInfo(preparedSources[0]);

        if (options.info) {
            console.log('\nℹ️  Info-only mode, skipping decode\n');
            return;
        }

        console.log('\n🔄 Decoding...\n');

        const debugCapture: BinaryDecodeDebugCapture | null = options.verbose ? { rowHealth: [], overallHealth: 0 } : null;
        const result = await PxfDecoder.decode(preparedSources, debugCapture);

        if (result.type === 'audio') {
            console.log(`🎵 Type: Audio`);
            console.log(`   Sample Rate: ${result.sampleRate} Hz`);
            console.log(`   Channels: ${result.channels.length}`);
            console.log(`   Samples: ${result.channels[0].length}`);
            console.log(`   Duration: ${(result.channels[0].length / result.sampleRate).toFixed(2)}s`);

            const outputPath = options.output ||
                generateOutputFilename(sources[0], undefined, '_decoded', 'wav');

            assertOutputsWritable([outputPath], options.force);

            console.log('\n💾 Encoding WAV file...');
            const wavData = encodeWav(result.channels, result.sampleRate);

            await writeFileBuffer(outputPath, Buffer.from(wavData));

            console.log(`   ✅ ${outputPath}`);
            console.log(`   Size: ${(wavData.byteLength / 1024).toFixed(2)} KB`);
        } else {
            printBinaryReport(result, debugCapture);

            // The embedded filename is untrusted: keep only its basename
            const outputPath = options.output ||
                sanitizeFilename(result.metadata.filename) ||
                generateOutputFilename(sources[0], undefined, '_decoded', 'bin');

            assertOutputsWritable([outputPath], options.force);

            await writeFileBuffer(outputPath, Buffer.from(result.data));

            console.log(`\n💾 Saved: ${outputPath}`);
            console.log(`   Size: ${(result.data.length / 1024).toFixed(2)} KB`);
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
    .option('-o, --output <path>', 'Output file path (default: ./<basename>_decoded.wav for audio, embedded filename for binary)')
    .option('-i, --info', 'Display metadata information only, without decoding')
    .option('-v, --verbose', 'Show per-row and overall health statistics (binary only)')
    .option('-f, --force', 'Overwrite existing output files')
    .action(handleDecode);
