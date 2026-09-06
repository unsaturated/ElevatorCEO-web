// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import da from "./locales/da.json";
import de from "./locales/de.json";
import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import it from "./locales/it.json";
import nl from "./locales/nl.json";
import zhHans from "./locales/zh-Hans.json";

export const SUPPORTED_LOCALES = ["en", "fr", "de", "es", "it", "nl", "da", "zh-Hans"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const PACKS: Record<Locale, Record<string, string>> = {
    en,
    fr,
    de,
    es,
    it,
    nl,
    da,
    "zh-Hans": zhHans,
};

const LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);

let _locale: Locale = "en";
let _strings: Record<string, string> = PACKS.en;

function resolveChinese(tag: string): Locale | null {
    const lower = tag.toLowerCase();
    if (lower === "zh" || lower.startsWith("zh-")) {
        return "zh-Hans";
    }
    return null;
}

function matchLocale(tag: string): Locale | null {
    if (LOCALE_SET.has(tag)) {
        return tag as Locale;
    }
    const chinese = resolveChinese(tag);
    if (chinese) {
        return chinese;
    }
    const base = tag.split("-")[0]!;
    if (LOCALE_SET.has(base)) {
        return base as Locale;
    }
    return resolveChinese(base);
}

/** Pick the best supported locale from the browser preference list. */
export function detectLocale(preferred?: readonly string[]): Locale {
    const tags =
        preferred ??
        (typeof navigator !== "undefined"
            ? navigator.languages?.length
                ? navigator.languages
                : [navigator.language]
            : ["en"]);

    for (const tag of tags) {
        if (!tag) {
            continue;
        }
        const match = matchLocale(tag);
        if (match) {
            return match;
        }
    }
    return "en";
}

/** Select the active locale pack from the bundled set. Call before any UI is constructed. */
export function initLocale(preferred?: readonly string[]): void {
    _locale = detectLocale(preferred);
    _strings = PACKS[_locale] ?? PACKS.en;
    if (typeof document !== "undefined") {
        document.documentElement.lang = _locale;
    }
}

export function getLocale(): Locale {
    return _locale;
}

/** Look up a localized string by iOS Localizable.strings key. */
export function t(key: string): string {
    return _strings[key] ?? key;
}

/** Format integers using the active locale (pension, floor ranges, etc.). */
export function formatNumber(n: number): string {
    return Math.round(n).toLocaleString(_locale);
}

/** GameScore.m:109-110 — short date and time in the active locale (high-score rows). */
export function formatDateTime(ms: number): string {
    return new Date(ms).toLocaleString(_locale, { dateStyle: "short", timeStyle: "short" });
}
