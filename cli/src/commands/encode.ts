// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { Command, InvalidArgumentError } from 'commander';
import { PxfEncoder } from '@pixel-exchange-format/codec';
import { readFileBuffer, writeFileBuffer, isWavFile, generateOutputFilename, assertOutputsWritable } from '../utils/fileUtils.js';
import { encodePNG } from '../utils/imageUtils.js';
import { decodeWav } from '../utils/audioUtils.js';
import { basename } from 'path';

/**
 * Progress bar display for encoding operations
 */
class ProgressBar {
    private lastProgress = 0;
    private barLength = 40;
    private open = false;

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
        this.open = true;

        if (percent >= 100) {
            this.close();
        }
    }

    finish(): void {
        if (this.lastProgress < 100) {
            this.update(100);
        }
    }

    /**
     * Terminates the in-progress line so subsequent output starts on a fresh line
     */
    close(): void {
        if (this.open) {
            process.stdout.write('\n');
            this.open = false;
        }
    }
}

function collectMetadata(value: string, previous: string[] = []): string[] {
    const eq = value.indexOf('=');
    if (eq < 1) {
        throw new InvalidArgumentError('Expected key=value with a non-empty key.');
    }
    return [...previous, value];
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
        binary?: boolean;
        metadata?: string[];
    }
): Promise<void> {
    const progressBar = new ProgressBar();

    try {
        console.log('🎨 Pixel Exchange Format - Encoder\n');
        console.log(`📁 Source: ${source}`);

        // Read source file
        const sourceBuffer = await readFileBuffer(source);
        console.log(`📊 Size: ${(sourceBuffer.length / 1024).toFixed(2)} KB`);

        // Determine if this is audio or binary data
        let audioData: { channels: Float32Array[], sampleRate: number } | undefined;
        let binaryData: Uint8Array | undefined;

        if (!options.binary && isWavFile(sourceBuffer)) {
            console.log('🎵 Detected: WAV Audio');

            let wav;
            try {
                const arrayBuffer = new ArrayBuffer(sourceBuffer.byteLength);
                new Uint8Array(arrayBuffer).set(sourceBuffer);
                wav = decodeWav(arrayBuffer);
            } catch (err) {
                throw new Error(
                    `Failed to parse WAV file: ${err instanceof Error ? err.message : String(err)}\n` +
                    '   Use --binary to encode it as raw data instead.'
                );
            }

            audioData = {
                channels: wav.channels,
                sampleRate: wav.sampleRate
            };

            console.log(`   Channels: ${wav.numberOfChannels}`);
            console.log(`   Sample Rate: ${wav.sampleRate} Hz`);
            console.log(`   Duration: ${(wav.channels[0].length / wav.sampleRate).toFixed(2)}s`);
        } else {
            console.log(options.binary ? '📦 Mode: Binary Data (forced)' : '📦 Detected: Binary Data');
            binaryData = new Uint8Array(sourceBuffer);
        }

        // Prepare metadata
        const metadata: Record<string, string> = {};
        metadata.filename = options.name || basename(source);
        if (options.comment) {
            metadata.comment = options.comment;
        }

        for (const kv of options.metadata ?? []) {
            const eq = kv.indexOf('=');
            metadata[kv.slice(0, eq)] = kv.slice(eq + 1);
        }

        console.log(`\n💾 Metadata:`);
        for (const [key, value] of Object.entries(metadata)) {
            console.log(`   ${key}: ${value}`);
        }

        // Start encoding
        console.log('\n🔄 Encoding...\n');

        const results = await PxfEncoder.encode(
            { audio: audioData, binary: binaryData },
            metadata,
            {}, // options
            (percent: number) => progressBar.update(percent)
        );

        progressBar.finish();

        // For multi-image, append image index to distinguish files
        const outputPaths = results.map((_, i) => generateOutputFilename(
            source,
            options.output,
            results.length > 1 ? `_${i + 1}` : '',
            'png'
        ));

        assertOutputsWritable(outputPaths, options.force);

        // Save output images
        console.log(`\n💾 Saving ${results.length} output image(s)...\n`);

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const outputPath = outputPaths[i];

            const pngBuffer = await encodePNG(result.data, result.width, result.height);
            await writeFileBuffer(outputPath, pngBuffer);

            console.log(`   ✅ ${outputPath} (${result.width}x${result.height})`);
        }

        console.log('\n✨ Encoding complete!\n');

    } catch (error) {
        progressBar.close();
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
    .option('-o, --output <path>', 'Output image path (default: ./<basename>.png; multi-image sets get _1, _2, ... appended)')
    .option('-n, --name <name>', 'Custom filename to embed in metadata (default: source basename)')
    .option('-c, --comment <text>', 'Optional comment to embed in metadata')
    .option('-m, --metadata <key=value>', 'Additional metadata entry (repeatable)', collectMetadata)
    .option('-b, --binary', 'Force binary mode (treat the source as raw data even if it is a WAV file)')
    .option('-f, --force', 'Overwrite existing output files')
    .action(handleEncode);
