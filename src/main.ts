// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2012-2026 Matthew Crumley

import { App } from "./app";
import { audio } from "./audio/audioController";
import { GameScene } from "./game/gameScene";
import { MainMenuScene } from "./game/mainMenuScene";
import { OptionsMenuScene } from "./game/optionsMenuScene";
import { ScoresMenuScene } from "./game/scoresMenuScene";
import { initLocale } from "./i18n/locale";
import { waitForFonts } from "./render/textSprite";
import { TextureCache } from "./render/textureCache";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
if (!canvas) {
    throw new Error("renderCanvas element not found");
}

const app = new App(canvas);
const cache = new TextureCache(app.scene);

let scene: GameScene | null = null;
let mainMenu: MainMenuScene | null = null;
let optionsMenu: OptionsMenuScene | null = null;
let scoresMenu: ScoresMenuScene | null = null;

function createMainMenu(): MainMenuScene {
    return new MainMenuScene(
        app,
        cache,
        () => startGame(),
        () => showScoresMenu(),
        () => showOptionsMenu()
    );
}

function showMainMenu(): void {
    optionsMenu?.hide();
    scoresMenu?.hide();
    if (!mainMenu) {
        mainMenu = createMainMenu();
    }
    mainMenu.show();
}

function showOptionsMenu(): void {
    mainMenu?.hide();
    if (!optionsMenu) {
        optionsMenu = new OptionsMenuScene(app, cache, showMainMenu);
    }
    optionsMenu.show();
}

function showScoresMenu(): void {
    mainMenu?.hide();
    if (!scoresMenu) {
        scoresMenu = new ScoresMenuScene(app, cache, showMainMenu);
    }
    scoresMenu.show();
}

function exitToMainMenu(): void {
    scene?.dispose();
    scene = null;
    showMainMenu();
}

async function boot(): Promise<void> {
    initLocale();
    await cache.load();

    // Text is rasterized into textures at construction time, so the
    // webfonts must have resolved first: anything drawn beforehand keeps
    // the fallback face's metrics for good.
    await waitForFonts();
    await audio.init();
    mainMenu = createMainMenu();
    mainMenu.show();

    app.start();

    // Two frames: one to compile materials, one to draw with them warm.
    app.scene.executeWhenReady(() => {
        app.scene.onAfterRenderObservable.addOnce(() => {
            canvas!.dataset.ready = "true";
        });
    });
}

function startGame(): void {
    optionsMenu?.dispose();
    optionsMenu = null;
    scoresMenu?.dispose();
    scoresMenu = null;
    mainMenu?.dispose();
    mainMenu = null;

    scene = new GameScene(app, cache, exitToMainMenu);
    scene.start();
}

void boot().catch((error: unknown) => {
    console.error(error);
});

if (import.meta.env.DEV) {
    // Console poking during development. Not shipped in production.
    Object.assign(window, {
        app,
        audio,
        cache,
        scene: () => scene,
        mainMenu: () => mainMenu,
        optionsMenu: () => optionsMenu,
        scoresMenu: () => scoresMenu,
        startGame,
        exitToMainMenu,
        showMainMenu,
        showOptionsMenu,
        showScoresMenu,
    });
}
