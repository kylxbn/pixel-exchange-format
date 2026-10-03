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
import { version as CLI_VERSION } from '../package.json';

const program = new Command();

program
    .name('pxf')
    .description('Pixel Exchange Format - Encode audio/data into images and decode back')
    .version(`${CLI_VERSION} - using codec v${VERSION}`);

program.addCommand(encodeCommand);
program.addCommand(decodeCommand);
program.addCommand(checkCommand);

program.parse(process.argv);
