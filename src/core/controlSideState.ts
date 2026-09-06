// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

const STORAGE_KEY = "ceo:controlIsOnLeft";

/** GameController.m:100-120 — persisted control side (left vs right). */
export function isControlOnLeft(): boolean {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === "1" || value === "true";
    } catch {
        return false;
    }
}

export function setControlOnLeft(onLeft: boolean): void {
    try {
        localStorage.setItem(STORAGE_KEY, onLeft ? "1" : "0");
    } catch {
        // A full quota or a privacy-restricted store must not break layout.
    }
}
