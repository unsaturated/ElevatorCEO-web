// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

const STORAGE_KEY = "ceo:tutorialViewed";

/** GameController.m:111-121 — persisted tutorial completion flag. */
export function isTutorialViewed(): boolean {
    try {
        return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function setTutorialViewed(viewed: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, viewed ? "1" : "0");
    } catch {
        // A full quota or a privacy-restricted store must not break tutorial display.
    }
}
