// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { describe, expect, it } from "vitest";

import { TouchDispatcher, type TouchHandler } from "../src/render/input";

function recordingHandler(overrides: Partial<TouchHandler> = {}): TouchHandler & {
    began: number[];
    moved: number[];
    ended: number[];
    canceled: number[];
} {
    const began: number[] = [];
    const moved: number[] = [];
    const ended: number[] = [];
    const canceled: number[] = [];
    return {
        priority: 0,
        swallowsTouches: false,
        onBegan: (touch) => {
            began.push(touch.pointerId);
            return true;
        },
        onMoved: (touch) => {
            moved.push(touch.pointerId);
        },
        onEnded: (touch) => {
            ended.push(touch.pointerId);
        },
        onCanceled: (touch) => {
            canceled.push(touch.pointerId);
        },
        began,
        moved,
        ended,
        canceled,
        ...overrides,
    };
}

describe("TouchDispatcher", () => {
    it("routes move and end to the handler that claimed began", () => {
        const dispatcher = new TouchDispatcher();
        const handler = recordingHandler();
        dispatcher.add(handler);

        dispatcher.handleBegan({ x: 10, y: 10, pointerId: 1 });
        dispatcher.handleMoved({ x: 12, y: 10, pointerId: 1 });
        dispatcher.handleEnded({ x: 12, y: 10, pointerId: 1 });

        expect(handler.began).toEqual([1]);
        expect(handler.moved).toEqual([1]);
        expect(handler.ended).toEqual([1]);
        expect(handler.canceled).toEqual([]);
    });

    it("treats cancel as interrupt, not a tap", () => {
        const dispatcher = new TouchDispatcher();
        const handler = recordingHandler();
        dispatcher.add(handler);

        dispatcher.handleBegan({ x: 10, y: 10, pointerId: 1 });
        dispatcher.handleCanceled({ x: 10, y: 10, pointerId: 1 });

        expect(handler.ended).toEqual([]);
        expect(handler.canceled).toEqual([1]);
    });

    it("cancelAll uses onCanceled so a backgrounded hold does not fire", () => {
        const dispatcher = new TouchDispatcher();
        const handler = recordingHandler();
        dispatcher.add(handler);

        dispatcher.handleBegan({ x: 10, y: 10, pointerId: 1 });
        dispatcher.cancelAll();

        expect(handler.ended).toEqual([]);
        expect(handler.canceled).toEqual([1]);

        dispatcher.handleMoved({ x: 11, y: 10, pointerId: 1 });
        dispatcher.handleEnded({ x: 11, y: 10, pointerId: 1 });
        expect(handler.moved).toEqual([]);
        expect(handler.ended).toEqual([]);
    });

    it("falls back to onEnded when a handler has no onCanceled", () => {
        const dispatcher = new TouchDispatcher();
        const ended: number[] = [];
        dispatcher.add({
            priority: 0,
            swallowsTouches: false,
            onBegan: () => true,
            onEnded: (touch) => {
                ended.push(touch.pointerId);
            },
        });

        dispatcher.handleBegan({ x: 0, y: 0, pointerId: 7 });
        dispatcher.cancelAll();
        expect(ended).toEqual([7]);
    });

    it("ignores a second pointer while the first is down", () => {
        const dispatcher = new TouchDispatcher();
        const first = recordingHandler();
        const second = recordingHandler({
            priority: 1,
            onBegan: (touch) => {
                second.began.push(touch.pointerId);
                return true;
            },
        });
        dispatcher.add(first);
        dispatcher.add(second);

        dispatcher.handleBegan({ x: 10, y: 10, pointerId: 1 });
        dispatcher.handleBegan({ x: 20, y: 20, pointerId: 2 });
        dispatcher.handleMoved({ x: 21, y: 20, pointerId: 2 });
        dispatcher.handleEnded({ x: 21, y: 20, pointerId: 2 });
        dispatcher.handleEnded({ x: 10, y: 10, pointerId: 1 });

        expect(first.began).toEqual([1]);
        expect(first.ended).toEqual([1]);
        expect(second.began).toEqual([]);
        expect(second.ended).toEqual([]);
    });

    it("blocks passthrough when an overlay swallows an unclaimed touch", () => {
        const dispatcher = new TouchDispatcher();
        const overlayBegan: number[] = [];
        const worldBegan: number[] = [];
        dispatcher.add({
            priority: -2,
            swallowsTouches: true,
            onBegan: (touch) => {
                overlayBegan.push(touch.pointerId);
                return false;
            },
        });
        dispatcher.add({
            priority: 0,
            swallowsTouches: false,
            onBegan: (touch) => {
                worldBegan.push(touch.pointerId);
                return true;
            },
        });

        dispatcher.handleBegan({ x: 5, y: 5, pointerId: 1 });
        expect(overlayBegan).toEqual([1]);
        expect(worldBegan).toEqual([]);
    });
});
