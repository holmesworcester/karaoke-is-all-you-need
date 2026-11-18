"""Create a sample-aligned stereo backing and mono vocal estimate with UVR MDX."""

import argparse
import subprocess
from pathlib import Path

import numpy as np
import onnxruntime as ort
from scipy import signal
from scipy.io import wavfile


def separate(source, model_path, folder):
    folder.mkdir(parents=True, exist_ok=True)
    rate = 44100
    pcm = subprocess.check_output(
        [
            "ffmpeg",
            "-nostdin",
            "-v",
            "error",
            "-i",
            str(source),
            "-map",
            "0:a:0",
            "-ar",
            str(rate),
            "-ac",
            "2",
            "-f",
            "f32le",
            "-",
        ]
    )
    src = np.frombuffer(pcm, dtype="<f4").reshape(-1, 2)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 5
    options.inter_op_num_threads = 1
    model = ort.InferenceSession(str(model_path), options, providers=["CPUExecutionProvider"])
    nfft, hop, step = 6144, 1024, 192 * 1024
    size = 255 * hop
    overlap = size - step
    pad = overlap // 2
    mix = np.pad(src.T, ((0, 0), (pad, size)))
    out = np.zeros_like(mix)
    weights = np.zeros(mix.shape[1], np.float32)
    window = np.ones(size, np.float32)
    window[:overlap] = np.linspace(0, 1, overlap)
    window[-overlap:] = 1 - window[:overlap]
    for pos in range(0, len(src) + pad, step):
        clip = mix[:, pos : pos + size]
        _, _, spectrum = signal.stft(clip, nperseg=nfft, noverlap=nfft - hop, padded=False)
        spectrum = spectrum[:, :3072] * (nfft / 2)
        data = (
            np.stack((spectrum.real, spectrum.imag), axis=1)
            .reshape(1, 4, 3072, 256)
            .astype(np.float32)
        )
        data[:, :, :3] = 0
        estimate = (
            model.run(None, {"input": data})[0] - model.run(None, {"input": -data})[0]
        ) * 0.5
        estimate = estimate.reshape(2, 2, 3072, 256)
        spec = (estimate[:, 0] + 1j * estimate[:, 1]) / (nfft / 2)
        _, wave = signal.istft(
            np.pad(spec, ((0, 0), (0, 1), (0, 0))), nperseg=nfft, noverlap=nfft - hop
        )
        out[:, pos : pos + size] += wave * window
        weights[pos : pos + size] += window
    backing = (out[:, pad : pad + len(src)] / weights[None, pad : pad + len(src)]).T
    wavfile.write(folder / "instrumental.wav", rate, backing)
    wavfile.write(folder / "clean-vocal.wav", rate, (src - backing * 1.022).mean(axis=1))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recording", type=Path)
    parser.add_argument("model", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    separate(args.recording, args.model, args.output)
