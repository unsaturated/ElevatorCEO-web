#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

/**
 * Writes license-clean placeholder sprites, silent audio cues, PWA icons,
 * and tab favicons so a public clone can `npm run dev` without private art.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRAMES_PATH = join(ROOT, "src", "assets", "frames.json");
const SPRITES_DIR = join(ROOT, "src", "assets", "sprites");
const AUDIO_DIR = join(ROOT, "src", "assets", "audio");
const ICONS_DIR = join(ROOT, "public", "icons");
const FAVICONS_DIR = join(ROOT, "public", "favicons");
const FAVICON_PNGS = [
    ["favicon-16x16.png", 16],
    ["favicon-32x32.png", 32],
    ["favicon-96x96.png", 96],
    ["favicon-128.png", 128],
    ["favicon-196x196.png", 196],
];

const AUDIO_CUES = [
    "buzzer",
    "coins",
    "dingdong",
    "elevator-button",
    "elevator-crash",
    "elevator-hum",
    "elevator-shutdown",
    "elevator-startup",
    "glockenspiel",
    "happyelevator",
    "livemusic",
    "menubutton",
    "powerdown",
    "recharge-big",
    "recharge-small",
    "rocket",
    "staticdischarge",
    "stinger",
    "successful",
    "swap",
    "warning",
];

const ICON_SIZES = [180, 192, 512];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const typeBuf = Buffer.from(type, "ascii");
    const body = Buffer.concat([typeBuf, data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
}

/** Minimal filter-0 RGBA PNG. */
function writeRgbaPng(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
        PNG_SIGNATURE,
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw, { level: 9 })),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

/** Tiny valid silent AAC-LC .m4a (a few frames). Used if ffmpeg is unavailable. */
const SILENT_M4A_B64 =
    "AAAAHGZ0eXBNNEEgAAACAE00QSBpc29taXNvMgAAAwttb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAASgABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACNXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAASgAAAAAAAAAAAAAAAQEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAADIAAAQAAAEAAAAAAa1tZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAKxEAAAMnVXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAFYbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAEcc3RibAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAAKxEAAAAAAA2ZXNkcwAAAAADgICAJQABAASAgIAXQBUAAAAAAD6AAAAOFQWAgIAFEghW5QAGgICAAQIAAAAgc3R0cwAAAAAAAAACAAAAAwAABAAAAAABAAAAnQAAABxzdHNjAAAAAAAAAAEAAAABAAAABAAAAAEAAAAkc3RzegAAAAAAAAAAAAAABAAAABUAAAAEAAAABAAAAAQAAAAUc3RjbwAAAAAAAAABAAADNwAAABpzZ3BkAQAAAHJvbGwAAAACAAAAAf//AAAAHHNiZ3AAAAAAcm9sbAAAAAEAAAAEAAAAAQAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTguNDUuMTAwAAAACGZyZWUAAAApbWRhdN4CAExhdmM1OC45MS4xMDAAAjBADgEYIAcBGCAHARggBw==";

function hashName(name) {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) {
        h ^= name.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function colorForName(name) {
    const h = hashName(name);
    const hue = (h % 360) / 360;
    const sat = 0.55;
    const val = 0.72;
    const i = Math.floor(hue * 6);
    const f = hue * 6 - i;
    const p = val * (1 - sat);
    const q = val * (1 - f * sat);
    const t = val * (1 - (1 - f) * sat);
    const [r, g, b] = [
        [val, t, p],
        [q, val, p],
        [p, val, t],
        [p, q, val],
        [t, p, val],
        [val, p, q],
    ][i % 6];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255];
}

function solidPng(width, height, rgba) {
    const buf = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        buf[i * 4] = rgba[0];
        buf[i * 4 + 1] = rgba[1];
        buf[i * 4 + 2] = rgba[2];
        buf[i * 4 + 3] = rgba[3];
    }
    return writeRgbaPng(width, height, buf);
}

async function silentM4aBytes() {
    const dest = join(tmpdir(), `elevator-ceo-silent-${process.pid}.m4a`);
    const workspaceDest = join(ROOT, "scripts", ".silent.m4a");
    const args = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=mono:sample_rate=44100",
        "-t",
        "0.05",
        "-c:a",
        "aac",
        "-b:a",
        "16k",
        "-movflags",
        "+faststart",
        workspaceDest,
    ];
    try {
        mkdirSync(dirname(workspaceDest), { recursive: true });
        await execFileAsync("ffmpeg", args, { timeout: 30000 });
        const bytes = readFileSync(workspaceDest);
        if (bytes.length > 32) {
            return bytes;
        }
    } catch {
        try {
            await execFileAsync("ffmpeg", [...args.slice(0, -1), dest], { timeout: 30000 });
            const bytes = readFileSync(dest);
            if (bytes.length > 32) {
                return bytes;
            }
        } catch {
            // fall through to embedded bytes
        }
    }
    return Buffer.from(SILENT_M4A_B64, "base64");
}

function writeSprites() {
    mkdirSync(SPRITES_DIR, { recursive: true });
    const frames = JSON.parse(readFileSync(FRAMES_PATH, "utf8"));
    let count = 0;
    for (const [name, size] of Object.entries(frames)) {
        const width = size.width;
        const height = size.height;
        const png = solidPng(width, height, colorForName(name));
        writeFileSync(join(SPRITES_DIR, name), png);
        count++;
    }
    console.log(`sprites: ${count} PNGs in ${SPRITES_DIR}`);
}

function pngInIco(png) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(16, 0);
    entry.writeUInt8(16, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(22, 12);
    return Buffer.concat([header, entry, png]);
}

function writeIcons() {
    mkdirSync(ICONS_DIR, { recursive: true });
    const color = [26, 54, 93, 255];
    for (const size of ICON_SIZES) {
        writeFileSync(join(ICONS_DIR, `icon-${size}.png`), solidPng(size, size, color));
    }
    console.log(`icons: ${ICON_SIZES.join(", ")} in ${ICONS_DIR}`);
}

function writeFavicons() {
    mkdirSync(FAVICONS_DIR, { recursive: true });
    const color = [26, 54, 93, 255];
    for (const [name, size] of FAVICON_PNGS) {
        writeFileSync(join(FAVICONS_DIR, name), solidPng(size, size, color));
    }
    writeFileSync(join(FAVICONS_DIR, "favicon.ico"), pngInIco(solidPng(16, 16, color)));
    console.log(`favicons: placeholders in ${FAVICONS_DIR}`);
}

async function writeAudio() {
    mkdirSync(AUDIO_DIR, { recursive: true });
    const bytes = await silentM4aBytes();
    for (const cue of AUDIO_CUES) {
        writeFileSync(join(AUDIO_DIR, `${cue}.m4a`), bytes);
    }
    console.log(`audio: ${AUDIO_CUES.length} silent m4a (${bytes.length} bytes each) in ${AUDIO_DIR}`);
}

const sprites = writeSprites();
writeIcons();
writeFavicons();
await writeAudio();
void sprites;
