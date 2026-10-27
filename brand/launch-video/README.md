# Launch video

danwo's 48-second launch film, 1920×1080 at 30 fps, made with [Remotion](https://remotion.dev).
It opens with the problem, lands the mark on the music's drop, shows the five features (drive,
emulate, fault matrix, flight record, agents) and closes on `npx @danwo/cli init`. It is cut in
English (`Launch`) and in Simplified Chinese (`LaunchZh`): the same scenes, timing and music, with
the words from `src/copy.ts`.

This folder is a project of its own, outside the workspaces, so Remotion stays out of the
repository's install.

## Render

```sh
cd brand/launch-video
bun install
bun run render     # writes out/danwo-launch.mp4 (about a minute)
bun run render:zh  # writes out/danwo-launch-zh.mp4, the Chinese cut
bun run studio     # opens Remotion Studio to scrub and edit the scenes
```

## How it is put together

| Path              | What it is                                                                      |
| ----------------- | ------------------------------------------------------------------------------- |
| `src/launch.tsx`  | The scenes in order, by start frame, over the music                             |
| `src/copy.ts`     | Every word on screen, in English and Chinese                                    |
| `src/scenes/`     | One file per scene; `feature.tsx` is the title column the features share        |
| `src/kit.tsx`     | The backdrop, word-by-word text, cards, chips, cursor and sound effects         |
| `src/theme.ts`    | Size, frame rate, the dashboard's dark palette, Inter, Geist Mono, Noto Sans SC |
| `public/tiles/`   | Dark screenshots of danwo's UI from `bun run readme-hero`, for the wall         |
| `public/replay/`  | A danwo recording of Impulse's onboarding, played in the flight record's player |
| `public/audio/`   | The music and sound effects, generated with ElevenLabs                          |
| `music-plan.json` | The composition plan the music was generated from                               |

The music builds quietly for 16 seconds and drops at frame 480; `Reveal` lands the mark on that
frame. Moving a scene means keeping that cut on the drop.

## Regenerating the audio

With the ElevenLabs CLI signed in:

```sh
elevenlabs music compose --json - --output public/audio/music.mp3 < music-plan.json
```

The sound effects (`whoosh`, `click`, `typing`, `pop`, `error`, `impact`, `riser`, `tick`) came
from `elevenlabs text-to-sound-effects convert`, each a short prompt such as "soft airy cinematic
UI whoosh". A new take of the music will not drop at the same moment, so check where it does
(the loudness jumps) and move `DROP` and the scene starts to match.

The tiles come from the README hero's capture; refresh them with `bun run readme-hero` and copy
the dark ones from its tiles folder.

## The Chinese cut

The Chinese words live beside the English in `src/copy.ts`. A line that arrives word by word is
written as short phrases with a space between them; `Words` draws them without the gap. What danwo
prints (the fault names, the failed trial, `danwo init`'s files) stays in English, as a developer
in China sees it.

Chinese characters come from `public/fonts/NotoSansSC-subset.woff2`: Noto Sans SC (SIL OFL, see
`NotoSansSC-OFL.txt`) cut to the characters the copy uses. After changing the Chinese copy, cut it
again from the variable font on Google Fonts, with fontTools installed (`pip install fonttools
brotli`):

```sh
bun run font:zh -- "NotoSansSC[wght].ttf"
```
