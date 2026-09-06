// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { afterEach, describe, expect, it } from "vitest";

import { detectLocale, formatNumber, getLocale, initLocale, t } from "../src/i18n/locale";

describe("detectLocale", () => {
    it("returns an exact supported tag", () => {
        expect(detectLocale(["fr-FR", "en-US"])).toBe("fr");
    });

    it("falls back from regional tag to language subtag", () => {
        expect(detectLocale(["fr-CA", "en-US"])).toBe("fr");
    });

    it("maps Chinese variants to zh-Hans", () => {
        expect(detectLocale(["zh-CN"])).toBe("zh-Hans");
        expect(detectLocale(["zh-TW", "en"])).toBe("zh-Hans");
        expect(detectLocale(["zh"])).toBe("zh-Hans");
    });

    it("falls back to en when nothing matches", () => {
        expect(detectLocale(["ja-JP", "ko-KR"])).toBe("en");
        expect(detectLocale([])).toBe("en");
    });
});

describe("initLocale and t", () => {
    afterEach(() => {
        initLocale(["en"]);
    });

    it("loads the selected pack", () => {
        initLocale(["fr"]);
        expect(getLocale()).toBe("fr");
        expect(t("PLAY_MENU")).toBe("JOUEZ");
        expect(t("LEVEL_LABEL")).toBe("NIVEAU");
    });

    it("returns the key when missing", () => {
        initLocale(["en"]);
        expect(t("NOT_A_REAL_KEY")).toBe("NOT_A_REAL_KEY");
    });
});

describe("formatNumber", () => {
    afterEach(() => {
        initLocale(["en"]);
    });

    it("formats using the active locale", () => {
        initLocale(["en"]);
        expect(formatNumber(1234567)).toBe("1,234,567");

        initLocale(["fr"]);
        expect(formatNumber(1234567)).toMatch(/1[\s\u202f\u00a0]?234[\s\u202f\u00a0]?567/);
    });
});
