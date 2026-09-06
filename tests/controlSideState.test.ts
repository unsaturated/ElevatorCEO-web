// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { beforeEach, describe, expect, it } from "vitest";

import { isControlOnLeft, setControlOnLeft } from "../src/core/controlSideState";

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

describe("controlSideState", () => {
    beforeEach(() => {
        installStorage();
    });

    it("defaults to right (false) when no value is stored", () => {
        expect(isControlOnLeft()).toBe(false);
    });

    it("persists true to localStorage", () => {
        setControlOnLeft(true);
        expect(localStorage.getItem("ceo:controlIsOnLeft")).toBe("1");
        expect(isControlOnLeft()).toBe(true);
    });

    it("persists false to localStorage", () => {
        setControlOnLeft(true);
        expect(isControlOnLeft()).toBe(true);
        setControlOnLeft(false);
        expect(localStorage.getItem("ceo:controlIsOnLeft")).toBe("0");
        expect(isControlOnLeft()).toBe(false);
    });

    it("recognizes 'true' string from storage", () => {
        localStorage.setItem("ceo:controlIsOnLeft", "true");
        expect(isControlOnLeft()).toBe(true);
    });

    it("returns false for unrecognized values", () => {
        localStorage.setItem("ceo:controlIsOnLeft", "invalid");
        expect(isControlOnLeft()).toBe(false);
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

        expect(isControlOnLeft()).toBe(false);
        expect(() => setControlOnLeft(true)).not.toThrow();
    });
});
