// Klang Pianissimo (svensk FastConformer-TDT) direkt i webbläsaren.
// Bygger på https://huggingface.co/spaces/mrfakename/pianissimo-sv-webgpu (CC BY 4.0):
// encodern körs på WebGPU (eller WASM) med onnxruntime-web, mel-spektrogram och TDT-avkodning i JS.
// Tillagt här: Klangs ordförstärkning (phrase boosting) för kapitlets namn och begrepp, se boost.json.
import { logMel, N_MELS } from "./mel.js";

const ORT_VERSION = "1.30.0";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
// WebGPU-anpassad version av KlangAI/pianissimo-sv-onnx int4, låst till en viss version.
const REPO = "https://huggingface.co/mrfakename/pianissimo-sv-ONNX/resolve/db154f21068b4786392436f7d47aaa523ae331a6/";
const FILES = {
  enc: { url: REPO + "encoder-model.int4.onnx", size: 496237536 },
  dec: { url: REPO + "decoder_joint-model.fp16.onnx", size: 36267462 },
  vocab: { url: REPO + "vocab.txt", size: 93939 },
  melfb: { url: "melfb.bin", size: 131584 },
  boost: { url: "boost.json", size: 0, noCache: true },
};
const CACHE_NAME = "rymdplugg-pianissimo-v1";
const PART = 32 * 1024 * 1024;
const PARALLEL = 6;

const SR = 16000;
const BLANK = 8192;
const N_DUR = 5;
const MAX_SYMBOLS = 10;
const CHUNK_SEC = 30;
const BOOST_ALPHA = 1.0;

let ort = null;
let sessions = null;
let vocab = null;
let melFb = null;
let boost = null;
let backend = "wasm";

const post = (type, data = {}) => self.postMessage({ type, ...data });
const abs = (url) => new URL(url, self.location.href).href;

async function fetchRange(url, start, end, onPart) {
  for (let attempt = 0; ; attempt++) {
    onPart(0);
    try {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (res.status !== 206 && !(res.status === 200 && start === 0)) throw new Error(`HTTP ${res.status}`);
      const out = new Uint8Array(end - start);
      const reader = res.body.getReader();
      let off = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const n = Math.min(value.byteLength, out.length - off);
        out.set(value.subarray(0, n), off);
        off += n;
        onPart(off);
        if (off >= out.length) { reader.cancel().catch(() => {}); break; }
      }
      if (off !== out.length) throw new Error("avbruten nedladdning");
      return out;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function openCache() {
  try { return await caches.open(CACHE_NAME); } catch { return null; }
}

async function fetchFile(file, onBytes) {
  const url = abs(file.url);
  const cache = file.noCache ? null : await openCache();
  if (cache) {
    const hit = await cache.match(url);
    if (hit) {
      const buf = new Uint8Array(await hit.arrayBuffer());
      onBytes(buf.byteLength, buf.byteLength);
      return buf;
    }
  }
  let buf;
  if (file.size > PART) {
    buf = new Uint8Array(file.size);
    const parts = [];
    for (let s = 0; s < file.size; s += PART) parts.push([s, Math.min(file.size, s + PART)]);
    const partGot = new Float64Array(parts.length);
    let next = 0;
    const lane = async () => {
      while (next < parts.length) {
        const i = next++;
        const [a, b] = parts[i];
        const chunk = await fetchRange(url, a, b, (n) => {
          partGot[i] = n;
          let got = 0;
          for (const g of partGot) got += g;
          onBytes(got, file.size);
        });
        buf.set(chunk, a);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, lane));
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} för ${file.url}`);
    buf = new Uint8Array(await res.arrayBuffer());
    onBytes(buf.byteLength, buf.byteLength);
  }
  if (cache) {
    try {
      await cache.put(url, new Response(buf, { headers: { "content-type": "application/octet-stream" } }));
    } catch { /* fullt eller privat läge: laddas ner igen nästa gång */ }
  }
  return buf;
}

async function isCached() {
  const cache = await openCache();
  if (!cache) return false;
  for (const f of Object.values(FILES)) {
    if (!f.noCache && !(await cache.match(abs(f.url)))) return false;
  }
  return true;
}

// Klangs boosting-träd (numpy-porten av NeMos GPU-PB) med noderna förberäknade i Python.
class PhraseBoost {
  constructor(nodes) {
    this.nodes = nodes.map(([id, children, tokenScore, nodeScore, isEnd, fail]) => ({
      id, children: Object.entries(children).map(([t, c]) => [Number(t), c]), tokenScore, nodeScore, isEnd, fail,
    }));
    this.cache = new Map();
  }
  scores(state) {
    let hit = this.cache.get(state);
    if (hit) return hit;
    const bonus = new Float32Array(BLANK);
    const next = new Int32Array(BLANK).fill(-1);
    let node = this.nodes[state], takenBack = 0;
    for (;;) {
      for (const [token, child] of node.children) {
        if (next[token] < 0) { bonus[token] = takenBack + this.nodes[child].tokenScore; next[token] = child; }
      }
      if (node.id === 0) {
        for (let t = 0; t < BLANK; t++) if (next[t] < 0) { bonus[t] = takenBack; next[t] = 0; }
        break;
      }
      if (!node.isEnd) takenBack += this.nodes[node.fail].nodeScore - node.nodeScore;
      node = this.nodes[node.fail];
    }
    hit = { bonus, next };
    this.cache.set(state, hit);
    return hit;
  }
}

async function load(useWebGPU) {
  const t0 = performance.now();
  post("status", { text: "Laddar röstmotorn" });
  ort = await import(ORT_BASE + "ort.webgpu.bundle.min.mjs");
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

  const names = Object.keys(FILES);
  const progress = Object.fromEntries(names.map((k) => [k, { got: 0, total: FILES[k].size }]));
  const report = () => {
    let got = 0, total = 0;
    for (const k of names) { got += progress[k].got; total += progress[k].total; }
    post("progress", { got, total });
  };
  const b = {};
  await Promise.all(names.map(async (k) => {
    b[k] = await fetchFile(FILES[k], (got, total) => { progress[k] = { got, total: total || got }; report(); });
  }));

  vocab = [];
  for (const line of new TextDecoder().decode(b.vocab).split("\n")) {
    const i = line.lastIndexOf(" ");
    if (i > 0) vocab[Number(line.slice(i + 1))] = line.slice(0, i);
  }
  melFb = new Float32Array(b.melfb.buffer, b.melfb.byteOffset, b.melfb.byteLength / 4);
  boost = new PhraseBoost(JSON.parse(new TextDecoder().decode(b.boost)).nodes);

  post("status", { text: "Startar röstmotorn" });
  let enc = null;
  if (useWebGPU) {
    try {
      enc = await ort.InferenceSession.create(b.enc, { executionProviders: ["webgpu"], graphOptimizationLevel: "all", preferredOutputLocation: "cpu" });
      backend = "webgpu";
    } catch (e) {
      post("warn", { text: `WebGPU gick inte (${e.message || e}), använder WASM.` });
    }
  }
  const wasmOpts = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
  if (!enc) { enc = await ort.InferenceSession.create(b.enc, wasmOpts); backend = "wasm"; }
  b.enc = null; // släpp 500 MB så fort sessionen finns, viktigt på telefoner
  const dec = await ort.InferenceSession.create(b.dec, wasmOpts);
  b.dec = null;
  sessions = { enc, dec };

  post("status", { text: "Värmer upp" });
  await transcribeChunk(new Float32Array(SR));
  post("ready", { backend, loadSecs: (performance.now() - t0) / 1000 });
}

function splitChunks(wav) {
  const max = CHUNK_SEC * SR;
  const out = [];
  let start = 0;
  const win = SR / 10;
  while (wav.length - start > max) {
    const lo = start + max - 6 * SR;
    let best = start + max, bestE = Infinity;
    for (let s = lo; s + win <= start + max; s += win / 2) {
      let e = 0;
      for (let i = s; i < s + win; i++) e += wav[i] * wav[i];
      if (e < bestE) { bestE = e; best = s + win / 2; }
    }
    out.push([start, best]);
    start = best;
  }
  out.push([start, wav.length]);
  return out;
}

function argmax(arr, from, to) {
  let bi = from, bv = arr[from];
  for (let i = from + 1; i < to; i++) if (arr[i] > bv) { bv = arr[i]; bi = i; }
  return bi - from;
}

async function transcribeChunk(wav) {
  const { enc, dec } = sessions;
  const T = ort.Tensor;
  const { features, T: nFrames, valid } = logMel(wav, melFb);
  const e = await enc.run({
    audio_signal: new T("float32", features, [1, N_MELS, nFrames]),
    length: new T("int64", BigInt64Array.from([BigInt(valid)]), [1]),
  });
  const encOut = e.outputs;
  const D = encOut.dims[1];
  const stride = encOut.dims[2];
  const Tp = Number(e.encoded_lengths.data[0]);
  const encData = encOut.data;

  const frame = new Float32Array(D);
  const frameT = new T("float32", frame, [1, D, 1]);
  const target = new Int32Array(1);
  const targetT = new T("int32", target, [1, 1]);
  const tl = new T("int32", Int32Array.from([1]), [1]);
  let s1 = new T("float32", new Float32Array(2 * 640), [2, 1, 640]);
  let s2 = new T("float32", new Float32Array(2 * 640), [2, 1, 640]);
  let prev = BLANK;
  let boostState = 0;
  const tokens = [];
  let t = 0, onFrame = 0;
  while (t < Tp) {
    for (let d = 0; d < D; d++) frame[d] = encData[d * stride + t];
    target[0] = prev;
    const out = await dec.run({ encoder_outputs: frameT, targets: targetT, target_length: tl, input_states_1: s1, input_states_2: s2 });
    const logits = out.outputs.data;
    let tok = argmax(logits, 0, BLANK + 1);
    const dur = argmax(logits, BLANK + 1, BLANK + 1 + N_DUR);
    if (tok !== BLANK) {
      if (boost) {
        const { bonus, next } = boost.scores(boostState);
        let bv = -Infinity;
        for (let i = 0; i < BLANK; i++) {
          const v = logits[i] + BOOST_ALPHA * bonus[i];
          if (v > bv) { bv = v; tok = i; }
        }
        boostState = next[tok];
      }
      tokens.push(tok);
      prev = tok;
      s1 = out.output_states_1;
      s2 = out.output_states_2;
      onFrame++;
    }
    if (dur > 0) { t += dur; onFrame = 0; }
    else if (tok === BLANK || onFrame >= MAX_SYMBOLS) { t += 1; onFrame = 0; }
  }

  let text = "";
  for (const id of tokens) {
    const piece = vocab[id] || "";
    if (piece === "<unk>" || piece === "<pad>" || /^<\|.*\|>$/.test(piece)) continue;
    text += piece.replace(/▁/g, " ");
  }
  return text.trim();
}

async function transcribe(id, wav) {
  const texts = [];
  for (const [a, b] of splitChunks(wav)) {
    const text = await transcribeChunk(wav.subarray(a, b));
    if (text) texts.push(text);
  }
  post("result", { id, text: texts.join(" ") });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "check") post("cached", { cached: await isCached() });
    else if (data.type === "load") await load(data.webgpu);
    else if (data.type === "transcribe") await transcribe(data.id, data.audio);
  } catch (e) {
    post("error", { id: data.id, text: String((e && e.message) || e) });
  }
};
