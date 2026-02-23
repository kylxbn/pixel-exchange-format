// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { Command } from 'commander';
import { PxfEncoder } from '@pixel-exchange-format/codec';
import { readFileBuffer, writeFileBuffer, isWavFile, generateOutputFilename } from '../utils/fileUtils.js';
import { encodePNG } from '../utils/imageUtils.js';
import { decodeWav } from '../utils/audioUtils.js';
import { basename } from 'path';

/**
 * Progress bar display for encoding operations
 */
class ProgressBar {
    private lastProgress = 0;
    private barLength = 40;

    update(percent: number): void {
        // Only update if progress has changed by at least 1%
        if (Math.floor(percent) === Math.floor(this.lastProgress)) {
            return;
        }

        this.lastProgress = percent;

        const filled = Math.floor((percent / 100) * this.barLength);
        const empty = this.barLength - filled;
        const bar = '█'.repeat(filled) + '░'.repeat(empty);

        process.stdout.write(`\r  Progress: [${bar}] ${percent.toFixed(1)}%`);

        if (percent >= 100) {
            process.stdout.write('\n');
        }
    }

    finish(): void {
        if (this.lastProgress < 100) {
            this.update(100);
        }
    }
}

/**
 * Main encode handler
 */
async function handleEncode(
    source: string,
    options: {
        output?: string;
        name?: string;
        comment?: string;
        force?: boolean;
        metadata?: string[];
    }
): Promise<void> {
    try {
        console.log('🎨 Pixel Exchange Format - Encoder\n');
        console.log(`📁 Source: ${source}`);

        // Read source file
        const sourceBuffer = await readFileBuffer(source);
        console.log(`📊 Size: ${(sourceBuffer.length / 1024).toFixed(2)} KB`);

        // Determine if this is audio or binary data
        let audioData: { channels: Float32Array[], sampleRate: number } | undefined;
        let binaryData: Uint8Array | undefined;

        const isAudio = isWavFile(sourceBuffer);

        if (isAudio) {
            console.log('🎵 Detected: WAV Audio');

            try {
                // Decode WAV file
                const arrayBuffer = new ArrayBuffer(sourceBuffer.byteLength);
                new Uint8Array(arrayBuffer).set(new Uint8Array(sourceBuffer.buffer));
                const wav = decodeWav(arrayBuffer);

                audioData = {
                    channels: wav.channels,
                    sampleRate: wav.sampleRate
                };

                console.log(`   Channels: ${wav.numberOfChannels}`);
                console.log(`   Sample Rate: ${wav.sampleRate} Hz`);
                console.log(`   Duration: ${(wav.channels[0].length / wav.sampleRate).toFixed(2)}s`);
            } catch (err) {
                console.warn('⚠️  Audio decoding failed, falling back to binary mode');
                console.warn(`   Error: ${err instanceof Error ? err.message : String(err)}`);
                binaryData = new Uint8Array(sourceBuffer);
            }
        } else {
            console.log('📦 Detected: Binary Data');
            binaryData = new Uint8Array(sourceBuffer);
        }

        // Prepare metadata
        const metadata: Record<string, string> = {};
        metadata.filename = options.name || basename(source);
        if (options.comment) {
            metadata.comment = options.comment;
        }

        // Parse additional metadata from command line
        if (options.metadata) {
            for (const kv of options.metadata) {
                const [key, ...valueParts] = kv.split('=');
                const value = valueParts.join('=');
                if (key && value !== undefined) {
                    metadata[key] = value;
                }
            }
        }

        console.log(`\n💾 Metadata:`);
        for (const [key, value] of Object.entries(metadata)) {
            console.log(`   ${key}: ${value}`);
        }

        // Start encoding
        console.log('\n🔄 Encoding...\n');

        const progressBar = new ProgressBar();

        const results = await PxfEncoder.encode(
            { audio: audioData, binary: binaryData },
            metadata,
            {}, // options
            (percent: number) => progressBar.update(percent)
        );

        progressBar.finish();

        // Save output images
        console.log(`\n💾 Saving ${results.length} output image(s)...\n`);

        for (let i = 0; i < results.length; i++) {
            const result = results[i];

            // Generate output filename
            // For multi-image, append image index to distinguish files
            const outputPath = generateOutputFilename(
                source,
                options.output,
                results.length > 1 ? `_${i + 1}` : '',
                'png'
            );

            // Encode as PNG
            const pngBuffer = await encodePNG(result.data, result.width, result.height);

            // Write to file
            await writeFileBuffer(outputPath, pngBuffer);

            console.log(`   ✅ ${outputPath} (${result.width}x${result.height})`);
        }

        console.log('\n✨ Encoding complete!\n');

    } catch (error) {
        console.error('\n❌ Encoding failed:');
        console.error(`   ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

/**
 * Configure and export the encode command
 */
export const encodeCommand = new Command('encode')
    .description('Encode audio or binary data into PXF image format')
    .argument('<source>', 'Source file (WAV audio or any binary file)')
    .option('-o, --output <path>', 'Output image path (default: <source>.png)')
    .option('-n, --name <name>', 'Custom filename to embed in metadata')
    .option('-c, --comment <text>', 'Optional comment to embed in metadata')
    .option('-m, --metadata <key=value>', 'Additional metadata key-value pairs (can be used multiple times)')
    .option('-f, --force', 'Overwrite existing output files')
    .action(handleEncode);
