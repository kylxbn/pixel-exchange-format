// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

export type MidiFileType = 0 | 1 | 2;

export type MidiStandard =
    | "GM"
    | "GS"
    | "XG"
    | "GM?";

export interface MidiInfo {
    fileType: MidiFileType;
    standard: MidiStandard;
    channelsUsed: number; // count of distinct channels (0-16)
    channelMask: number; // bitmask, bit n = channel n used
}

const SYSEX_GM_RESET = [0x7E, 0x7F, 0x09, 0x01];
const SYSEX_GS_RESET = [0x41, 0x10, 0x42, 0x12];
const SYSEX_XG_RESET = [0x43, 0x10, 0x4C, 0x00];

function matchesSysex(data: Uint8Array, sig: number[]): boolean {
    if (data.length < sig.length) return false;
    for (let i = 0; i < sig.length; i++) {
        if (data[i] !== sig[i]) return false;
    }
    return true;
}

function popcount(x: number): number {
    let c = 0;
    while (x) {
        x &= x - 1;
        c++;
    }
    return c;
}

export function extractMidiInfo(buffer: ArrayBuffer): MidiInfo {
    const view = new DataView(buffer);
    let offset = 0;

    const readU8 = () => view.getUint8(offset++);
    const readU16 = () => (offset += 2, view.getUint16(offset - 2));
    const readU32 = () => (offset += 4, view.getUint32(offset - 4));

    const readStr = (n: number) => {
        let s = "";
        for (let i = 0; i < n; i++) s += String.fromCharCode(readU8());
        return s;
    };

    // ---- HEADER ----
    if (readStr(4) !== "MThd") {
        throw new Error("Not a MIDI file");
    }

    const headerLen = readU32(); // 00 00 00 06

    const fileType = readU16() as MidiFileType; // 00 00
    const numTracks = readU16();                // 00 01
    const division = readU16();                 // 01 E0

    // If headerLen is ever > 6, skip the extra bytes (rare but valid)
    if (headerLen > 6) offset += (headerLen - 6);

    let channelMask = 0;
    let detectedStandard: MidiStandard = "GM?";

    // ---- TRACKS ----
    for (let t = 0; t < numTracks; t++) {
        const trackStart = offset;

        if (readStr(4) !== "MTrk") {
            throw new Error(`Invalid MTrk at offset 0x${trackStart.toString(16)}`);
        }

        const length = readU32();
        const trackEnd = offset + length;

        let runningStatus = 0;

        while (offset < trackEnd) {
            // delta-time VLQ
            let b;
            do {
                b = readU8();
            } while (b & 0x80);

            let status = readU8();

            // running status
            if (status < 0x80) {
                if (!runningStatus) {
                    throw new Error("Running status without previous status");
                }

                status = runningStatus;

                const type = status & 0xF0;
                const channel = status & 0x0F;
                channelMask |= (1 << channel);

                if (type !== 0xC0 && type !== 0xD0) {
                    readU8();
                }
                continue;
            }

            runningStatus = status;

            if ((status & 0xF0) !== 0xF0) {
                const type = status & 0xF0;
                const channel = status & 0x0F;
                channelMask |= (1 << channel);

                if (type === 0xC0 || type === 0xD0) {
                    readU8();
                } else {
                    readU8();
                    readU8();
                }
            }
            else if (status === 0xFF) {
                readU8(); // meta type
                let len = 0;
                do {
                    b = readU8();
                    len = (len << 7) | (b & 0x7F);
                } while (b & 0x80);
                offset += len;
            }
            else if (status === 0xF0 || status === 0xF7) {
                let len = 0;
                do {
                    b = readU8();
                    len = (len << 7) | (b & 0x7F);
                } while (b & 0x80);

                const start = offset;
                offset += len;

                const sysex = new Uint8Array(buffer, start, len);

                if (matchesSysex(sysex, SYSEX_GM_RESET)) detectedStandard = "GM";
                if (matchesSysex(sysex, SYSEX_GS_RESET)) detectedStandard = "GS";
                if (matchesSysex(sysex, SYSEX_XG_RESET)) detectedStandard = "XG";
            }
        }

        // snap exactly to end
        offset = trackEnd;
    }

    return {
        fileType,
        standard: detectedStandard,
        channelsUsed: popcount(channelMask),
        channelMask
    };
}
