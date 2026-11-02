"""Taligenkänning för Rymdplugg: tar emot en kort WAV-inspelning och svarar med texten.

Kör Klang Pianissimo (ONNX int8) på CPU. Inget ljud sparas.
"""
import io
import os
import sys
import threading
import wave

import numpy as np
import onnx_asr
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from huggingface_hub import snapshot_download

MODEL = "KlangAI/pianissimo-sv-onnx"
MAX_SECONDS = 90
ALLOWED_ORIGINS = [
    "https://cronholmrickard.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

# Ord från kapitlet som modellen ska vara extra uppmärksam på.
VOCABULARY = [
    "Merkurius", "Venus", "Mars", "Jupiter", "Saturnus", "Uranus", "Neptunus", "Pluto", "Tellus",
    "Johannes Kepler", "Kepler", "Galileo Galilei", "Galilei", "Edmund Halley", "Halleys komet",
    "Vintergatan", "Andromeda", "Andromedagalaxen", "Magellanska molnen", "Big Bang",
    "ljusår", "galaxår", "dvärgplanet", "dvärgplaneter", "stenplanet", "stenplaneter",
    "gasplanet", "gasplaneter", "jätteplanet", "jätteplaneter", "asteroid", "asteroider",
    "meteor", "meteorer", "meteorit", "meteoriter", "komet", "kometer", "stjärnfall",
    "spiralgalax", "rymdsond", "rymdsonder", "universum", "tyngdkraften", "atmosfären",
]

path = snapshot_download(MODEL, allow_patterns=[
    "*int8.onnx", "nemo128.onnx", "vocab.txt", "config.json", "tokenizer.model", "*.py",
])
sys.path.append(path)
import pianissimo_onnx  # noqa: E402

model = onnx_asr.load_model("nemo-conformer-tdt", path, quantization="int8")
pianissimo_onnx.boost(model, VOCABULARY, tokenizer_path=os.path.join(path, "tokenizer.model"))
lock = threading.Lock()

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_methods=["GET", "POST"], allow_headers=["*"])


def read_wav(data: bytes) -> np.ndarray:
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getframerate() != 16000:
                raise HTTPException(400, "Ljudet måste vara WAV, 16 kHz, mono, 16 bitar.")
            if w.getnframes() > MAX_SECONDS * 16000:
                raise HTTPException(413, f"Inspelningen är längre än {MAX_SECONDS} sekunder.")
            pcm = w.readframes(w.getnframes())
    except wave.Error:
        raise HTTPException(400, "Kunde inte läsa ljudet som WAV.")
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


@app.get("/")
def health():
    return {"status": "ok", "model": MODEL}


@app.post("/transcribe")
async def transcribe(request: Request):
    audio = read_wav(await request.body())
    if audio.size < 1600:
        return {"text": ""}
    return {"text": (await run_in_threadpool(recognize, audio)).strip()}


def recognize(audio: np.ndarray) -> str:
    with lock:
        return model.recognize(audio, sample_rate=16000)
