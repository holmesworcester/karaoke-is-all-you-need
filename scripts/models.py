"""Fetch the exact ONNX weights and CTC vocabulary used for the demo."""

import argparse
import hashlib
import os
import shutil
import tempfile
import urllib.request
from pathlib import Path

HUB = "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/"
MODELS = {
    "align.onnx": (
        HUB + "onnx/model.onnx",
        "e46614273f03ff4b87923a965e417fa72004825522cb007c9c25633b8475490d",
    ),
    "vocab.json": (
        HUB + "vocab.json",
        "4178db26b3c7570f6a47f14ac6a1c7b32950b8c2800fb097287e53776934f1c5",
    ),
    "separator.onnx": (
        "https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx",
        "317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc",
    ),
}


def digest(path):
    with path.open("rb") as f:
        return hashlib.file_digest(f, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    folder = parser.parse_args().directory
    folder.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in MODELS.items():
        target = folder / name
        if target.is_file() and digest(target) == expected:
            continue
        with tempfile.NamedTemporaryFile(dir=folder, delete=False) as f:
            temp = Path(f.name)
        try:
            with urllib.request.urlopen(url, timeout=90) as response, temp.open("wb") as f:
                shutil.copyfileobj(response, f)
            if digest(temp) != expected:
                raise ValueError("Unexpected SHA-256 for " + name)
            os.replace(temp, target)
        finally:
            temp.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
