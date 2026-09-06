// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import { CreateSoundAsync } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import { SoundState } from "@babylonjs/core/AudioV2/soundState";
import type { AudioEngineV2 } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import type { StaticSound } from "@babylonjs/core/AudioV2/abstractAudio/staticSound";

import { audioUrl } from "../assets/urls";
import { INTRO_LOOP_FADE_SEC, MUSIC_FILE, MUSIC_VOLUME, SOUND_FILES, SoundEffect } from "./soundEffect";

/**
 * Port of ElevatorCEO/Classes/AudioController.{h,m}.
 *
 * The original split responsibilities between SimpleAudioEngine (effects, mute)
 * and CDAudioManager (background music transport). Babylon's Audio V2 covers
 * both, so this collapses into one class with the same public shape:
 * playSound / stopSound / musicOn / musicOff / soundOn / soundOff / pause / resume.
 */
export class AudioController {
    private _engine: AudioEngineV2 | null = null;
    private _effects = new Map<SoundEffect, StaticSound>();
    private _music: StaticSound | null = null;

    private _soundMuted = false;
    private _musicWasPaused = false;
    private _ready = false;

    get isReady(): boolean {
        return this._ready;
    }

    /** Master output level, above the per-sound gains. */
    get masterVolume(): number {
        return this._engine?.volume ?? 1;
    }

    set masterVolume(value: number) {
        if (this._engine) {
            this._engine.volume = value;
        }
    }

    /**
     * Forces the audio context to start. Not normally needed since Babylon
     * defaults `resumeOnInteraction` to true, but useful to call from an
     * explicit "tap to start" affordance.
     */
    async unlock(): Promise<void> {
        await this._engine?.unlockAsync();
    }

    /**
     * Loads every clip. Babylon defaults `resumeOnInteraction` to true, so the
     * audio context unlocks itself on the first user gesture and no manual
     * unlock plumbing is needed.
     */
    async init(): Promise<void> {
        if (this._ready) {
            return;
        }

        this._engine = await CreateAudioEngineAsync({ volume: 1.0 });

        const loads: Array<Promise<void>> = [];

        for (const key of Object.keys(SOUND_FILES) as SoundEffect[]) {
            const def = SOUND_FILES[key];
            loads.push(
                CreateSoundAsync(key, audioUrl(def.file), {
                    loop: def.loop ?? false,
                    volume: def.gain ?? 1.0,
                    // Rapid taps should overlap rather than cut each other off,
                    // matching how CocosDenshion allocated separate sources.
                    maxInstances: def.loop ? 1 : 4,
                })
                    .then((sound) => {
                        this._effects.set(key, sound);
                    })
                    .catch((error: unknown) => {
                        console.warn(`[audio] failed to load ${def.file}`, error);
                    })
            );
        }

        loads.push(
            CreateSoundAsync("music", audioUrl(MUSIC_FILE), {
                loop: true,
                volume: MUSIC_VOLUME,
                maxInstances: 1,
            })
                .then((sound) => {
                    this._music = sound;
                })
                .catch((error: unknown) => {
                    console.warn(`[audio] failed to load ${MUSIC_FILE}`, error);
                })
        );

        await Promise.all(loads);
        this._ready = true;
    }

    // -- Effects -----------------------------------------------------------

    /** AudioController.m:80-159. Silently ignores unknown or unloaded clips. */
    playSound(effect: SoundEffect): void {
        if (this._soundMuted) {
            return;
        }
        const sound = this._effects.get(effect);
        if (!sound) {
            return;
        }

        const def = SOUND_FILES[effect];

        if (def.loop) {
            // Looping clips are singletons; restarting one that is already
            // running would stack instances of the hum.
            if (sound.state === SoundState.Started || sound.state === SoundState.Starting) {
                return;
            }
            // A fade may have left the volume at zero (see stopSound).
            sound.volume = def.gain ?? 1.0;
        }

        sound.play();
    }

    /** AudioController.m:166-179. */
    stopSound(effect: SoundEffect): void {
        const sound = this._effects.get(effect);
        if (!sound) {
            return;
        }

        if (effect === SoundEffect.IntroLoop) {
            // The original faded this out over 1s with an S-curve before stopping.
            sound.setVolume(0, { duration: INTRO_LOOP_FADE_SEC });
            window.setTimeout(() => sound.stop(), INTRO_LOOP_FADE_SEC * 1000);
            return;
        }

        sound.stop();
    }

    /**
     * Pauses a looping effect in place. Used when the page is backgrounded so
     * the clip can continue from the same point on return.
     */
    pauseSound(effect: SoundEffect): void {
        const sound = this._effects.get(effect);
        if (!sound) {
            return;
        }
        if (sound.state === SoundState.Started || sound.state === SoundState.Starting) {
            sound.pause();
        }
    }

    /** Opposite of pauseSound; no-op unless the clip is currently paused. */
    resumeSound(effect: SoundEffect): void {
        const sound = this._effects.get(effect);
        if (!sound) {
            return;
        }
        if (sound.state === SoundState.Paused) {
            sound.resume();
        }
    }

    stopAllEffects(): void {
        for (const sound of this._effects.values()) {
            sound.stop();
        }
    }

    // -- Sound on/off (SimpleAudioEngine.mute in the original) --------------

    soundOn(): void {
        this._soundMuted = false;
    }

    soundOff(): void {
        this._soundMuted = true;
        this.stopAllEffects();
    }

    get isSoundOn(): boolean {
        return !this._soundMuted;
    }

    // -- Music -------------------------------------------------------------

    /** AudioController.m:56-65. Rewinds before starting, as the original did. */
    musicOn(): void {
        if (!this._music || this.isMusicOn) {
            return;
        }
        this._music.currentTime = 0;
        this._music.play();
    }

    /** AudioController.m:67-73. */
    musicOff(): void {
        if (!this._music) {
            return;
        }
        this._music.stop();
    }

    get isMusicOn(): boolean {
        if (!this._music) {
            return false;
        }
        return this._music.state === SoundState.Started || this._music.state === SoundState.Starting;
    }

    // -- App lifecycle -----------------------------------------------------

    /** AudioController.m:17-20. */
    pause(): void {
        this._music?.pause();
    }

    /**
     * AudioController.m:22-27. Only resumes music the player did not
     * deliberately switch off.
     */
    resume(isPlaying: boolean): void {
        if (!this._musicWasPaused && isPlaying) {
            this._music?.resume();
        }
    }

    /** AudioController.m:29-33. */
    pauseMusic(): void {
        this._musicWasPaused = true;
        this._music?.pause();
    }

    /** AudioController.m:35-39. */
    resumeMusic(): void {
        this._musicWasPaused = false;
        this._music?.resume();
    }

    /**
     * Suspends the Web Audio context while the tab or PWA is backgrounded.
     * Must go through pauseAsync rather than AudioContext.suspend: Babylon
     * defaults resumeOnPause to true and will otherwise resume the context
     * a second later, which is why the menu loop kept playing off-screen.
     */
    suspendContext(): void {
        void this._engine?.pauseAsync();
    }

    /** Opposite of suspendContext; also covers Safari auto-suspending on hide. */
    resumeContext(): void {
        void this._engine?.resumeAsync();
    }

    dispose(): void {
        this.stopAllEffects();
        this._music?.stop();
        this._effects.clear();
        this._music = null;
        this._engine = null;
        this._ready = false;
    }
}

/** Singleton, mirroring `[AudioController sharedInstance]`. */
export const audio = new AudioController();
