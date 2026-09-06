// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import type { App } from "../app";
import { audio } from "../audio/audioController";
import { wireEventAudio } from "../audio/eventAudio";
import { recordScore } from "../core/highScores";
import { TouchDispatcher } from "../render/input";
import { TweenRunner } from "../render/tween";
import { TextTextureCache } from "../render/textSprite";
import type { TextureCache } from "../render/textureCache";
import { Game } from "../sim/game";
import { ControlView } from "../view/controlView";
import { GameOverView } from "../view/gameOverView";
import { PauseView } from "../view/pauseView";
import { RadarView } from "../view/radarView";
import { WorldView } from "../view/worldView";

/**
 * Wires the simulation to the view and drives both from the render loop.
 *
 * The ordering here is the contract the whole port rests on: advance the
 * simulation, then let the view read it. Nothing in src/view writes back into
 * the rules — only into Game through the public action methods.
 */
export class GameScene {
    readonly game: Game;
    readonly world: WorldView;
    readonly control: ControlView;
    readonly pause: PauseView;
    readonly radar: RadarView;
    readonly gameOver: GameOverView;
    readonly tweens = new TweenRunner();
    readonly touch: TouchDispatcher;
    readonly text: TextTextureCache;

    private readonly _unsubscribes: Array<() => void> = [];
    private _musicStarted = false;
    private _musicOnBeforePause = false;
    private _disposed = false;

    constructor(
        private readonly _app: App,
        textures: TextureCache,
        private readonly _onExitToMainMenu: () => void
    ) {
        this.text = new TextTextureCache(_app.scene);
        this.touch = new TouchDispatcher(_app.scene, () => _app.letterbox);
        this.game = new Game();

        this.world = new WorldView(_app.scene, textures, this.text, this.tweens, _app, this.touch, this.game);
        this.pause = new PauseView(
            _app,
            _app.scene,
            textures,
            this.text,
            this.touch,
            this.game,
            () => this.setPaused(false),
            () => this._retire(),
            () => {
                this.world.tutorialTips.replayFromPause();
            }
        );
        this.pause.node.parent = this.world.node;
        this.control = new ControlView(
            _app,
            _app.scene,
            textures,
            this.text,
            this.tweens,
            this.touch,
            this.game,
            this.world.node,
            (paused) => this.setPaused(paused)
        );
        this.radar = new RadarView(_app, _app.scene, textures, this.text, this.game, this.control.node);
        this.gameOver = new GameOverView(_app.scene, textures, this.text, this.touch, this.tweens, () =>
            this._exitToMainMenu()
        );

        this._unsubscribes.push(wireEventAudio(this.game.events));

        this._unsubscribes.push(
            this.game.events.on((event) => {
                if (event.type === "levelStart") {
                    void this.world.startLevel();
                } else if (event.type === "gameOver") {
                    // GameOverLayer.m:29 — unlike the original, which deferred the
                    // write until the app backgrounded, persist straight away: a
                    // closed tab gives no later chance.
                    const topThree = recordScore(event.pension, event.level);
                    this.gameOver.show(event.pension, event.level, topThree);
                    this.control.sync();
                    this.radar.sync();
                }
            })
        );

        const layoutObserver = _app.onLayoutChanged.add(() => {
            this.world.node.position.x = this._app.worldOffsetX;
            this.world.applyPlayLayout();
        });
        this.world.node.position.x = this._app.worldOffsetX;
        this.world.applyPlayLayout();
        this._unsubscribes.push(() => _app.onLayoutChanged.remove(layoutObserver));

        this._bindKeyboard();
        this._unsubscribes.push(_app.onUpdate((dt) => this._frame(dt)));

        const pageObserver = _app.onPageHidden.add((hidden) => {
            if (hidden) {
                this._onPageHidden();
            }
        });
        this._unsubscribes.push(() => _app.onPageHidden.remove(pageObserver));
    }

    /** Starts a fresh game at level 1. */
    start(): void {
        this.game.newGame();
        // GameLayer.m:70-71 — start BGM with the Play tap. That pointerup is a
        // user gesture, so play() is allowed here; waiting for another click
        // leaves the music-on icon lying until the player toggles it.
        this._tryStartMusic();
        if (!this._musicStarted) {
            this._armMusicOnFirstGesture();
        }
    }

    private _tryStartMusic(): void {
        if (this._disposed || !this.control.musicDesired) {
            return;
        }
        void audio.unlock();
        audio.musicOn();
        this._musicStarted = audio.isMusicOn;
    }

    /** Fallback when Play's musicOn was blocked (no prior unlock, console start). */
    private _armMusicOnFirstGesture(): void {
        if (this._musicStarted) {
            return;
        }
        const start = (): void => {
            window.removeEventListener("pointerdown", start);
            window.removeEventListener("keydown", start);
            // Call play() in this turn, not after unlockAsync: the browser
            // only treats the current gesture as autoplay consent.
            this._tryStartMusic();
            this._musicStarted = true;
        };
        window.addEventListener("pointerdown", start, { once: true });
        window.addEventListener("keydown", start, { once: true });
        this._unsubscribes.push(() => {
            window.removeEventListener("pointerdown", start);
            window.removeEventListener("keydown", start);
        });
    }

    /**
     * ElevatorCEOAppDelegate.m:120-125 — resign-active pauses the game.
     * Become-active leaves a playing game paused so the player decides
     * (m:127-135). A backgrounded tab or PWA is that same moment: cancel
     * in-flight holds and show the pause menu rather than keep simulating.
     */
    private _onPageHidden(): void {
        if (this.game.gameOver || this.game.paused) {
            return;
        }
        this.setPaused(true);
    }

    /** GameOverLayer.m:249-256 — return to the title screen. */
    private _exitToMainMenu(): void {
        this.pause.hide();
        this.setPaused(false);
        this.gameOver.hide();
        this._onExitToMainMenu();
    }

    get paused(): boolean {
        return this.game.paused;
    }

    setPaused(value: boolean): void {
        if (value === this.game.paused) {
            this.control.sync();
            return;
        }
        this.game.paused = value;
        this.tweens.paused = value;
        if (value) {
            this._musicOnBeforePause = audio.isMusicOn;
            this.touch.cancelAll();
            audio.pause();
            this.pause.show();
        } else {
            this.pause.hide();
            audio.resume(this._musicOnBeforePause);
        }
        this.control.sync();
    }

    /** GamePauseLayer.m:157-172 — confirm retire and show the game-over screen. */
    private _retire(): void {
        audio.musicOff();
        this.pause.hide();
        this.tweens.paused = false;
        this.game.retire();
        this.control.sync();
    }

    private _bindKeyboard(): void {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (this.game.gameOver) {
                return;
            }
            if (this.game.paused) {
                if (event.code === "KeyP" || event.code === "Escape") {
                    this.setPaused(false);
                    event.preventDefault();
                }
                return;
            }
            if (event.code === "ArrowUp" || event.code === "KeyW") {
                this.game.moveOwnElevator(true, 2, false);
                event.preventDefault();
            } else if (event.code === "ArrowDown" || event.code === "KeyS") {
                this.game.moveOwnElevator(true, 2, true);
                event.preventDefault();
            } else if (event.code === "KeyP" || event.code === "Escape") {
                this.setPaused(true);
                event.preventDefault();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        this._unsubscribes.push(() => window.removeEventListener("keydown", onKeyDown));
    }

    private _frame(dt: number): void {
        this.tweens.update(dt);
        this.control.update(dt);
        this.game.update(dt);
        this.world.sync();
        this.control.sync();
        this.radar.sync();
    }

    dispose(): void {
        this._disposed = true;
        for (const unsubscribe of this._unsubscribes) {
            unsubscribe();
        }
        this._unsubscribes.length = 0;
        this.gameOver.dispose();
        this.pause.dispose();
        this.radar.dispose();
        this.control.dispose();
        this.world.dispose();
        this.tweens.stopEverything();
        this.text.dispose();
        this.touch.dispose();
    }
}
