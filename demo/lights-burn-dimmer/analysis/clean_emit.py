import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.special import log_softmax
import onnxruntime as ort
from align import gettimes

sr, v = wavfile.read("clean-vocal.wav")
v = signal.resample_poly(v, 160, 441)
wavfile.write("true-vocal16.wav", 16000, v)
opt = ort.SessionOptions()
opt.intra_op_num_threads = 5
opt.inter_op_num_threads = 1
model = ort.InferenceSession("align.onnx", opt, providers=["CPUExecutionProvider"])
chunks = []
for start in range(0, len(v), 160000):
    lo = max(0, start - 32000)
    hi = min(len(v), start + 192000)
    x = v[lo:hi]
    x = (x - x.mean()) / (x.std() + 1e-6)
    y = model.run(None, {"input_values": x[None].astype("float32")})[0][0]
    a = (start - lo) // 320
    chunks.append(y[a : a + 500])
p = log_softmax(np.concatenate(chunks), 1)
np.save("clean-emit", p)
gettimes(p, "cleantimes.json")
