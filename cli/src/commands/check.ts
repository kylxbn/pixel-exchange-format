// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { Command } from 'commander';
import { PxfDecoder } from '@pixel-exchange-format/codec';
import type { BinaryDecodeDebugCapture } from '@pixel-exchange-format/codec';
import { loadSources, printSourceInfo, printBinaryReport, isBinarySource } from '../utils/pxfUtils.js';

async function handleCheck(
    sources: string[]
): Promise<void> {
    try {
        console.log('🎨 Pixel Exchange Format - Check\n');

        const preparedSources = await loadSources(sources);

        printSourceInfo(preparedSources[0]);

        if (!isBinarySource(preparedSources[0])) {
            console.log('\nℹ️  Check is currently supported for binary data only.\n');
            return;
        }

        console.log('\n🔎 Checking binary data...\n');

        const debugCapture: BinaryDecodeDebugCapture = { rowHealth: [], overallHealth: 0 };
        const result = await PxfDecoder.decode(preparedSources, debugCapture);

        if (result.type !== 'binary') {
            throw new Error('Decoder returned non-binary data for a binary source');
        }

        printBinaryReport(result, debugCapture);

        if (!result.validChecksum) {
            process.exitCode = 1;
        }

        console.log('\n✨ Check complete!\n');
    } catch (error) {
        console.error('\n❌ Check failed:');
        console.error(`   ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

export const checkCommand = new Command('check')
    .description('Validate PXF images and report data health (binary only); exits 1 if the checksum fails')
    .argument('<sources...>', 'Source PXF image(s) - supports PNG, JPEG, GIF, BMP, WebP, TIFF')
    .action(handleCheck);
