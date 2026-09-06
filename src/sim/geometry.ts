// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { FLOORS_PER_SCREEN, FLOOR_HEIGHT } from "../core/constants";

/**
 * Closed-form replacement for GamePlayFloorLayer's sprite-tag lookups.
 *
 * The original stored each floor's number in a CCSprite `tag` and searched the
 * sprite list linearly (`floorFromPosition:`, `distanceToFloorBtm:`). The sprite
 * ring is regular, so the same answers fall out of arithmetic:
 *
 * At reset the sprites start at y = NUM_LEVEL_SPRITES_PER_SCREEN * 60 + 60 and
 * step down by 60, while their floor numbers start at floorMin + 11 and step
 * down by 1 (GamePlayFloorLayer.m:148-191). Eliminating the sprite index gives
 *
 *     bottomY(F) = layerY + FLOOR_HEIGHT * (F - floorMin)
 *
 * which inverts to the floor containing a given y. The view still wraps real
 * sprites for display, but no game rule depends on them any more.
 */
export class FloorGeometry {
    floorMin = 0;
    floorMax = 0;

    /** Scroll offset of the floor layer. 0 at the bottom, negative going up. */
    layerY = 0;

    /** Lowest layerY, i.e. the scroll limit at the top of the building. */
    minLayerY = 0;

    reset(floorMin: number, floorMax: number): void {
        this.floorMin = floorMin;
        this.floorMax = floorMax;
        this.layerY = 0;
        // GamePlayFloorLayer.m:193
        this.minLayerY = -(FLOOR_HEIGHT * (floorMax - floorMin - FLOORS_PER_SCREEN + 2));
    }

    /** World-space y of the bottom edge of a floor. */
    floorBottomY(floor: number): number {
        return this.layerY + FLOOR_HEIGHT * (floor - this.floorMin);
    }

    /**
     * Floor containing a world-space y, or 0 if it falls outside the level.
     *
     * The original searched the fourteen wrapped floor sprites, whose tags
     * track the visible band as the layer scrolls. The closed form below is
     * equivalent for any in-bounds floor; clamping to the initial sprite ring
     * (floorMin + 11 .. floorMin - 2) was wrong once layerY != 0 and made
     * OwnGameElevator bail out of update during scroll.
     */
    floorFromPosition(y: number): number {
        const index = Math.floor((y - this.layerY) / FLOOR_HEIGHT);
        const floor = this.floorMin + index;

        if (floor < this.floorMin || floor > this.floorMax) {
            return 0;
        }
        return floor;
    }

    /** GamePlayFloorLayer.m:375-389. Signed: positive means the floor is above y. */
    distanceToFloorBottom(floor: number, y: number): number {
        return this.floorBottomY(floor) - y;
    }

    get canElevatorMoveUp(): boolean {
        return this.layerY > this.minLayerY;
    }

    get canElevatorMoveDown(): boolean {
        return this.layerY < 0;
    }

    /**
     * Advances the scroll by dy, clamping at both ends.
     * Mirrors GamePlayFloorLayer.m:232-254, where the clamp also decides
     * whether the elevator is allowed to keep climbing.
     */
    scrollBy(dy: number): void {
        const next = this.layerY + dy;
        if (next > 0) {
            this.layerY = 0;
        } else if (next < this.minLayerY) {
            this.layerY = this.minLayerY;
        } else {
            this.layerY = next;
        }
    }
}

/** Y of a transfer elevator's center when parked at a floor, in floor-layer space. */
export function transferRestY(floor: number, floorMin: number, halfCarHeight: number): number {
    // BaseTransferElevator.m:64-77 places the node at (floor - floorMin) * 60,
    // and the bounce settles it at floorGoingToY + FLOOR_HEIGHT/2.
    void halfCarHeight;
    return FLOOR_HEIGHT * (floor - floorMin);
}
