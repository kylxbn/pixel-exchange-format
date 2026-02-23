#!/usr/bin/env node

// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * Pixel Exchange Format CLI
 * 
 * Main entry point for the PXF command-line tool.
 * Supports encoding and decoding operations for audio and binary data.
 */

import { Command } from 'commander';
import { encodeCommand } from './commands/encode.js';
import { decodeCommand } from './commands/decode.js';
import { checkCommand } from './commands/check.js';
import { VERSION } from '@pixel-exchange-format/codec';

const program = new Command();

// Configure main program information
program
    .name('pxf')
    .description('Pixel Exchange Format - Encode audio/data into images and decode back')
    .version(`1.0.0 - using codec v${VERSION}`);

// Add encode command
program.addCommand(encodeCommand);

// Add decode command
program.addCommand(decodeCommand);

// Add check command
program.addCommand(checkCommand);

// Parse command-line arguments
program.parse(process.argv);

// Show help if no command specified
if (!process.argv.slice(2).length) {
    program.outputHelp();
}
