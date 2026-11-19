# Karaoke Is All You Need

I wondered if Astra could one-shot a karaoke track. It can! It got a working, singable version on the first try and my feedback was just aesthetics. Sharing the results in case helpful to all you vibe-coding KJ's out there.

**[Agent skill](.agents/skills/karaoke-is-all-you-need/SKILL.md)**

https://github.com/user-attachments/assets/6d8d11cf-5355-4610-8222-eae4f291820e

## Play the demo

With [Mise](https://mise.jdx.dev/), FFmpeg and FFprobe on your path, run these commands from a checkout.

```sh
mise run demo
```

Open `build/demo.html` in a browser. The build fetches the reviewed lyric edition once. The resulting file includes the audio, lyrics, font and graphics, and plays offline. **Save MP3+G** downloads a ZIP containing the backing MP3 and a same-named CD+G file for karaoke machines.

The title appears at the beginning. Two lyric lanes preview what comes next, and cue dots lead into delayed entrances. The last frame holds the dithered single artwork. The demo manifest uses the published MP4 as its backing source, so a rebuild can run from this checkout. To export your own playthrough, run the following after building.

```sh
mise run browser
node video/export.mjs build/demo.html build/karaoke.mp4
```

Export draws each frame at its presentation time, including the closing fade. Use `--jobs 1` for lower peak memory, or `--audio master.wav` to mux a sample-aligned master of the same length. The checked-in video was mastered from the original separation.

## Make another song

For a new recording, install Python 3.14 with pip, then run `mise run python`. The model downloader verifies each file by SHA-256. It downloads about 425 MB on the first run. The following example assumes a working folder named `song` containing a studio recording, cover image and line-timed LRC transcript of the same edition.

```sh
mise run setup
.venv/bin/python scripts/models.py build/models
.venv/bin/python scripts/separate.py song/studio.wav build/models/separator.onnx song
.venv/bin/python scripts/align.py song/clean-vocal.wav song/words.lrc build/models song/timing.json --raw-output song/word-scores.json
.venv/bin/python scripts/art.py "Your Song" song/cover.jpg song/assets.json
```

To draw the cover in color, pass three artwork-derived hex colors to the art command, for example `--cover-palette 222233 8899aa ffeeee`. These set the stage background, unsung lyrics and sweep. The builder checks contrast after rounding to native CD+G colors. On a long intro, the title gives way to the artwork and then the first lyric preview with a four-beat cue.

Listen through with the vocal, especially repeated lines, echoes and short pickups. The aligner follows the supplied English words and uses LRC line times as soft anchors. Write out sung numbers. `word-scores.json` gives each word’s start, end and mean model probability. Adjust `timing.json` against the vocal before building the final version. This file stores an array per LRC row, with one `[startMs,endMs]` pair per word and an empty array for a timestamped instrumental line.

For sung holds, run `.venv/bin/python scripts/refine_releases.py song/clean-vocal.wav song/timing.json song/releases.json --output song/proposed.json`. The tool follows groups of spectral peaks across small pitch changes on a 10 ms clock, stops at a sustained level drop, and never crosses the following word. The report gives estimates from several nearby seed frames and three decay thresholds. The optional output applies changes where the estimates agree and exhibit a release before the next cue. Compare candidates against the vocal, especially when other singers overlap, a consonant trails the note, or the singer takes a breath. Acoustic overlap can leave a release uncertain. Word starts are preserved.

Save this as `song/song.json`. Paths in a manifest are relative to that file. An optional `pickupRows` array identifies zero-based lyric rows that benefit from a one-beat, three-dot lead-in.

```json
{
  "title": "Your Song",
  "artist": "Your Artist",
  "audio": "instrumental.wav",
  "lyrics": "words.lrc",
  "timing": "timing.json",
  "art": "assets.json",
  "bpm": 120
}
```

```sh
node scripts/build-player.mjs song/song.json build/my-song.html
node video/export.mjs build/my-song.html build/my-song.mp4
```

The CD+G compiler checks packet deadlines against the backing duration. This arrangement uses a 2.2-second title and needs roughly four seconds after the final word for the artwork fade. For a recording that starts on the first beat, add matching pre-roll to the audio and lyric anchors before alignment. For a tight ending, append silence to the backing. For an LRCLIB edition, use `lrclibId` in place of `lyrics`; an optional `lyricsSha256` pins the tokenized text. An exact local edition can also be supplied as the build command’s third argument.

## How “Lights Burn Dimmer” was timed

The instrumental upload contained a promotional voice. We separated the official Fred again.. & Jamie T studio recording with UVR-MDX-NET-Inst_HQ_3, keeping the backing on the studio clock. The candidate instrumental still supplied a second vocal reference by subtraction. LRCLIB supplied a line-timed transcript. Wav2vec2 CTC alignment located the individual words in the two vocal estimates. Short ad-libs and the chopped ending needed hand corrections and waveform matches across repetitions. The complete procedure and recording-specific corrections are in the [demo analysis](demo/lights-burn-dimmer/analysis/README.md).

Across 58 recurring vocal landmarks, the median difference between a cue and its independently matched occurrence was 3 ms. That measures consistency in the sampled repetitions. The decoded MP4 also matched the reference audio at zero offset in nine windows across the song. [Acoustic measurements](demo/lights-burn-dimmer/acoustic-audit.json) · [Video measurements](demo/lights-burn-dimmer/video-audit.json)

## Agent skill

A Codex agent working in this checkout can use `$karaoke-is-all-you-need`. To make the skill available for other projects, link the skill directory from your checkout into your Codex skills directory.

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -s "$PWD/.agents/skills/karaoke-is-all-you-need" "${CODEX_HOME:-$HOME/.codex}/skills/karaoke-is-all-you-need"
```

Example request: *Use $karaoke-is-all-you-need to make a karaoke video from this recording. I want a word-by-word sweep and an artwork fade at the end.*

## Verification

Use a Linux runner with FFmpeg (H.264, AAC, libmp3lame and, for the model test, libflite), FFprobe, Python 3.14 with pip, and Mise. The browser task installs Playwright Chromium. To use an installed Chrome, set `KARAOKE_CHROME` to its executable path. Minimal Linux images may also need `npx playwright-core install-deps chromium`.

| Task | What it exercises |
| --- | --- |
| `mise run verify` | Offline player with 787 timed words, an independent CD+G packet decoder, injected drift and ±120 ms offsets, forward and backward seeks, playback-rate changes, descenders, mobile and desktop layout, invalid editions, and native export. Also renders a different song and decodes its MP4 to check the direction and midpoint of the sweep. |
| `mise run verify-demo` | Builds the real lyric edition, runs the player checks and compares the published video with 49 independently sought frames and nine decoded audio windows. |
| `mise run verify-models` | Fetches checksum-pinned weights, separates a synthesized voice and checks its known entrance through the actual aligner. |

The [GitHub Actions workflow](ci/verify.yml) defines push and pull request checks, plus scheduled and manual runs for the real lyric provider and models. To enable hosted runs, put the file at `.github/workflows/verify.yml` using a GitHub credential with workflow write permission. Local runs write reports to `artifacts/`. The workflow retains screenshots and intermediate media on failure.

## Building blocks and credits

The native decoder is [cdgraphics](https://github.com/bhj/cdgraphics). The ZIP uses [fflate](https://github.com/101arrowz/fflate). The HTML is bundled with [esbuild](https://esbuild.github.io/), rendered with [Playwright](https://playwright.dev/) and encoded with [FFmpeg](https://ffmpeg.org/). Python tools use NumPy, SciPy, Pillow and ONNX Runtime. The bundled Barlow Condensed font carries its [SIL Open Font License](assets/OFL.txt).

“Lights Burn Dimmer” is by Fred again.. & Jamie T. The demo uses the studio recording and single artwork; their respective owners retain their rights. [Recording](https://www.youtube.com/watch?v=_jGOd3pTtaA) · [Artwork](https://music.apple.com/us/album/lights-burn-dimmer/1874902788?i=1874902790) · [Lyric edition](https://lrclib.net/api/get/29384656) · [UVR model](https://github.com/TRvlvr/model_repo/releases/tag/all_public_uvr_models) · [Alignment model](https://huggingface.co/Xenova/wav2vec2-base-960h)
