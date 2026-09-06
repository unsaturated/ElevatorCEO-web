// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

/**
 * Content-hashed URLs for sprites, audio, and frames.json.
 *
 * import.meta.glob with `?url` keeps filenames stable in source while Vite
 * emits hashed paths, so media is not served from guessable /assets/audio/*.m4a
 * URLs.
 */

const spriteModules = import.meta.glob("./sprites/*.png", {
    eager: true,
    query: "?url",
    import: "default",
}) as Record<string, string>;

const audioModules = import.meta.glob("./audio/*.m4a", {
    eager: true,
    query: "?url",
    import: "default",
}) as Record<string, string>;

const framesModules = import.meta.glob("./frames.json", {
    eager: true,
    query: "?url",
    import: "default",
}) as Record<string, string>;

function byBasename(modules: Record<string, string>): Map<string, string> {
    const map = new Map<string, string>();
    for (const [modulePath, url] of Object.entries(modules)) {
        const name = modulePath.split("/").pop();
        if (name) {
            map.set(name, url);
        }
    }
    return map;
}

const spriteUrls = byBasename(spriteModules);
const audioUrls = byBasename(audioModules);

const framesEntry = Object.values(framesModules)[0];
if (!framesEntry) {
    throw new Error('frames.json is missing from src/assets/. Run "npm run placeholders".');
}

export const FRAMES_URL = framesEntry;

export function spriteUrl(name: string): string {
    const url = spriteUrls.get(name);
    if (!url) {
        throw new Error(`Unknown sprite: ${name}. Add it under src/assets/sprites/.`);
    }
    return url;
}

/** `basename` is the cue name without extension, matching SOUND_FILES.file. */
export function audioUrl(basename: string): string {
    const file = basename.endsWith(".m4a") ? basename : `${basename}.m4a`;
    const url = audioUrls.get(file);
    if (!url) {
        throw new Error(`Unknown audio: ${file}. Add it under src/assets/audio/.`);
    }
    return url;
}
