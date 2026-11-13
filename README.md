# Elevator CEO (web)
Ported from [Elevator CEO](https://github.com/unsaturated/ElevatorCEO) into a TypeScript / Babylon.js web game. This repository is the GPL-3.0-or-later game code plus placeholder assets. Production graphics and audio live in a private sibling repository and are not committed here.

## Clone and Run
The following commands will get you setup at `http://localhost:5173/` with solid-color placeholder sprites and silent `.m4a` cues. It's enough to check layout and input.

```bash
git clone https://github.com/unsaturated/ElevatorCEO-web.git
cd ElevatorCEO-web
npm ci
npm run placeholders
npm test
npm run typecheck
npm run dev
```

## Assets
The assets live under `src/assets/` and are resolved in `urls.ts` with `import.meta.glob`. Vite emits content-hashed URLs, so the built app does not serve a stable file tree.

```
src/assets/
  frames.json          # pixel width/height per sprite filename
  sprites/*.png        # one file per key in frames.json
  audio/*.m4a          # one file per cue (see src/audio/soundEffect.ts)
  urls.ts              # import.meta.glob ?url lookup
public/
  fonts/               # Droid Sans (Apache-2.0) and League Gothic (OFL-1.1)
  icons/               # gitignored; `npm run placeholders` or private overlay
  favicons/            # gitignored; `npm run placeholders` or private overlay
```

Replace placeholder PNGs and M4As with files of the same filenames. `npm run dev` picks them up through `import.meta.glob`. Do not add real Elevator CEO sprites or audio to a public fork; those files are separately licensed and are not redistributable.

### Art
Width and height in `frames.json` must match the pixel size of each PNG used in-game, otherwise HUD, elevators, and floors will be the wrong size. Remember to keep that file in sync when you replace sprites. `TextureCache` sizes quads from `frames.json` as opposed to decoding the image asset. The `width` / `height` are the actual pixel dimensions of the original artwork. The in-game positioning and sizing use half these values.

### Audio
Each cue is found in `src/assets/audio/<name>.m4a`. File names must match the `file` values and `MUSIC_FILE` in `src/audio/soundEffect.ts`. Loop flags and gains are set in that code, not in the audio files. Clip duration is not read and does not affect layout or sim timing.

### Fonts
Droid Sans (Apache-2.0) and League Gothic (OFL-1.1) ship in the `public/fonts/` folder. License text lives next to the `.woff2` files; see also the License section below.

## Production Host
A clone's `npm run build` uses a relative `base` and does not emit canonical or social-image tags. To host at a fixed path and set Open Graph URLs, set the following in your environment:

```bash
VITE_BASE=/your/play/path/ \
VITE_OG_URL=https://example-ceo-game.com/your/play/path/ \
VITE_OG_IMAGE=https://example-ceo-game.com/your-card.jpg \
npm run build
```

## License
- Game code: GPL-3.0-or-later (`LICENSE`).
- Droid Sans: Apache-2.0 (`public/fonts/LICENSE-2.0.txt`).
- League Gothic: OFL-1.1 (`public/fonts/OFL-1.1.txt`).
- Graphics and audio in a production build: see `NOTICE`; not GPL.
