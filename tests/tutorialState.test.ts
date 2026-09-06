// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { beforeEach, describe, expect, it } from "vitest";

import { isTutorialViewed, setTutorialViewed } from "../src/core/tutorialState";

function installStorage(): void {
    const entries = new Map<string, string>();
    const storage = {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => {
            entries.set(key, value);
        },
        removeItem: (key: string) => {
            entries.delete(key);
        },
        clear: () => {
            entries.clear();
        },
        key: (index: number) => [...entries.keys()][index] ?? null,
        get length() {
            return entries.size;
        },
    };
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
}

describe("tutorialState", () => {
    beforeEach(() => {
        installStorage();
    });

    it("defaults to false when no value is stored", () => {
        expect(isTutorialViewed()).toBe(false);
    });

    it("persists true to localStorage", () => {
        setTutorialViewed(true);
        expect(localStorage.getItem("ceo:tutorialViewed")).toBe("1");
        expect(isTutorialViewed()).toBe(true);
    });

    it("persists false to localStorage", () => {
        setTutorialViewed(true);
        expect(isTutorialViewed()).toBe(true);
        setTutorialViewed(false);
        expect(localStorage.getItem("ceo:tutorialViewed")).toBe("0");
        expect(isTutorialViewed()).toBe(false);
    });

    it("handles storage access exceptions safely", () => {
        Object.defineProperty(globalThis, "localStorage", {
            value: {
                getItem: () => {
                    throw new Error("SecurityError: Access is denied");
                },
                setItem: () => {
                    throw new Error("QuotaExceededError");
                },
            },
            configurable: true,
        });

        expect(isTutorialViewed()).toBe(false);
        expect(() => setTutorialViewed(true)).not.toThrow();
    });
});
