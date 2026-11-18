# Replaying the word alignment

This directory contains the studio edition’s analysis scripts. The finished [timing table](../timing.json), [acoustic checks](../acoustic-audit.json), [video checks](../video-audit.json) and [MP4](../lights-burn-dimmer.mp4) are available directly in the repository.

The two recordings are the [official studio upload](https://www.youtube.com/watch?v=_jGOd3pTtaA) and the [candidate instrumental](https://www.youtube.com/watch?v=3BJIAAIv8AM). The latter contains a promotional voice. It supplied a useful reference where its instrumental matched the studio master. The released karaoke backing comes from the MDX separation of the studio upload.

Start from the repository root with `mise run python`, FFmpeg and yt-dlp. Run the analysis inside a scratch directory. These commands request Opus audio, the format of the source files used for the demo. Provider re-encodes or different edits can change the inputs.

```sh
root="$PWD"
analysis="$root/demo/lights-burn-dimmer/analysis"
py="$root/.venv/bin/python"
mkdir -p build/replay
cd build/replay
"$py" "$root/scripts/models.py" .
curl --fail --location https://lrclib.net/api/get/29384656 -o lrc-ref.json
yt-dlp -f 'bestaudio[acodec=opus]' -o studio.webm 'https://www.youtube.com/watch?v=_jGOd3pTtaA'
yt-dlp -f 'bestaudio[acodec=opus]' -o backing.webm 'https://www.youtube.com/watch?v=3BJIAAIv8AM'
ffmpeg -v error -i studio.webm -ac 1 -ar 16000 -c:a pcm_f32le studio.wav
ffmpeg -v error -i backing.webm -ac 1 -ar 16000 -c:a pcm_f32le backing.wav
"$py" "$root/scripts/separate.py" studio.webm separator.onnx .
"$py" "$analysis/emissions.py"
"$py" "$analysis/clean_emit.py"
"$py" "$analysis/align.py"
"$py" "$analysis/finish_timing.py"
cmp timing.json "$root/demo/lights-burn-dimmer/timing.json"
```

The separation keeps both channels and the length of the decoded studio recording. The first alignment pass uses the difference between the master and the candidate instrumental. The second uses the MDX vocal estimate. Each pass computes 50 acoustic frames per second. The forced alignment searches for a monotonic path through the supplied letters, allows blanks and repeated letters, and applies a soft line-start prior to keep repeated phrases in their proper place. Four manually bounded sections span this edition’s vocals.

`finish_timing.py` blends agreeing estimates, selects the cleaner stem for one section and applies the reviewed corrections to echoes and the chopped sample. Its row and word indexes refer to LRCLIB edition 29384656. `matches.py` contains the normalized cross-correlation used to inspect copies of the same vocal fragment.

For the repeat and backing-clock audit, encode the backing with the three-second artwork hold, then run the audit in the same scratch directory.

```sh
ffmpeg -v error -i instrumental.wav -af apad=pad_dur=3 -c:a libmp3lame -b:a 192k sing.mp3
"$py" "$analysis/local-audio-audit.py"
```

The audit compares the decoded backing against the master in 16 windows. It independently locates recurring vocal snippets and compares the matched positions to the target cues. These checks catch global shifts and jumps into an adjacent repetition. Listen against the reference vocal to judge words at overlapping onsets and ad-libs.

For the final video, run `mise run verify-demo` from the repository root. `reference.mjs` seeks a real browser player to each test time. `verify.py` decodes the published MP4, checks all frame timestamps, compares the independently rendered images and measures audio lag.
