// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { GAME_MAX_PENSION, GAME_MIN_PENSION, MAX_GAME_HIGH_SCORES } from "./constants";

const STORAGE_KEY = "ceo:highScores";

/** GameScore.m — one entry of the local leaderboard. Date is epoch milliseconds. */
export interface GameScore {
    readonly date: number;
    readonly level: number;
    readonly pension: number;
}

/**
 * Stored scores are editable by anyone with a devtools console, so a loaded
 * entry is only believed if it falls in the range the simulation can actually
 * produce — GameStatus.m:217 clamps pension to [GAME_MIN_PENSION,
 * GAME_MAX_PENSION]. Out-of-range values are dropped rather than clamped: a
 * tampered score pinned to the maximum would still sit at the top of the board.
 */
function isGameScore(value: unknown): value is GameScore {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const { date, level, pension } = value as Record<keyof GameScore, unknown>;
    return (
        typeof date === "number" &&
        Number.isFinite(date) &&
        typeof level === "number" &&
        Number.isFinite(level) &&
        level >= 0 &&
        typeof pension === "number" &&
        pension >= GAME_MIN_PENSION &&
        pension <= GAME_MAX_PENSION
    );
}

/** GameScore.m:47-79 — the top scores, best pension first. */
export function loadHighScores(): GameScore[] {
    let raw: string | null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        return [];
    }
    if (!raw) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed
        .filter(isGameScore)
        .sort((a, b) => b.pension - a.pension)
        .slice(0, MAX_GAME_HIGH_SCORES);
}

/** GameScore.m:18-45 — persist the leaderboard. */
export function saveHighScores(scores: readonly GameScore[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    } catch {
        // A full quota or a privacy-restricted store must not break the
        // game-over transition; the score is simply not kept.
    }
}

/**
 * GameController.m:32-89 — records a finished game if it places in the top three.
 *
 * Ranking is by pension alone; level is carried along for display. A tie ranks
 * the new score above the existing one, as the original's `<=` comparison did.
 *
 * @return Whether the score placed.
 */
export function recordScore(pension: number, level: number, now = Date.now()): boolean {
    if (!Number.isFinite(pension) || pension <= GAME_MIN_PENSION || pension > GAME_MAX_PENSION) {
        return false;
    }

    const scores = loadHighScores();
    const index = scores.findIndex((existing) => existing.pension <= pension);
    if (index < 0 && scores.length >= MAX_GAME_HIGH_SCORES) {
        return false;
    }

    const score: GameScore = { date: now, level, pension };
    scores.splice(index < 0 ? scores.length : index, 0, score);
    scores.length = Math.min(scores.length, MAX_GAME_HIGH_SCORES);
    saveHighScores(scores);
    return true;
}
