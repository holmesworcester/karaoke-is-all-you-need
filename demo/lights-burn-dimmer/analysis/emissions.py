import json, itertools
import numpy as np
from scipy.io import wavfile
from scipy.special import log_softmax
import onnxruntime as ort

sr, mix = wavfile.read("studio.wav")
_, inst = wavfile.read("backing.wav")
vocal = mix - inst[: len(mix)]
wavfile.write("vocal.wav", sr, vocal)
opt = ort.SessionOptions()
opt.intra_op_num_threads = 5
opt.inter_op_num_threads = 1
sess = ort.InferenceSession("align.onnx", opt, providers=["CPUExecutionProvider"])
vocab = json.load(open("vocab.json"))
inv = {v: k for k, v in vocab.items()}
for name, signal in [("vocal", vocal), ("mix", mix)]:
    chunks = []
    hop = 320
    for start in range(0, len(signal), sr * 10):
        lo = max(0, start - sr * 2)
        hi = min(len(signal), start + sr * 12)
        clip = signal[lo:hi]
        clip = ((clip - clip.mean()) / np.sqrt(clip.var() + 1e-7)).astype("float32")
        out = sess.run(None, {"input_values": clip[None]})[0][0]
        a = (start - lo) // hop
        chunks.append(out[a : a + sr * 10 // hop])
    probs = log_softmax(np.concatenate(chunks), axis=1)
    np.save(name + "-emit", probs)
    if name == "vocal":
        for j in range(0, len(probs), 500):
            s = "".join(
                inv[k] for k, g in itertools.groupby(probs.argmax(1)[j : j + 500]) if k
            ).replace("|", " ")
            print(j / 50, s, flush=True)
