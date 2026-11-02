// Från https://huggingface.co/spaces/mrfakename/pianissimo-sv-webgpu (CC BY 4.0).
// NeMo AudioToMelSpectrogramPreprocessor (128 mel, as in nemo128.onnx) in plain JS.
// preemph 0.97 -> zero-pad 256 each side -> STFT(n_fft 512, hop 160, hann(400) centred in 512)
// -> power -> mel (slaney, 0-8 kHz) -> log(x + 2^-24) -> per-feature mean/std over valid frames.
const N_FFT = 512;
const HOP = 160;
const WIN = 400;
const N_BINS = N_FFT / 2 + 1;
export const N_MELS = 128;

const window512 = new Float32Array(N_FFT);
{
  const off = (N_FFT - WIN) / 2;
  for (let n = 0; n < WIN; n++) window512[off + n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (WIN - 1));
}

// radix-2 complex FFT tables for size 512
const LOG2 = 9;
const rev = new Uint16Array(N_FFT);
for (let i = 0; i < N_FFT; i++) {
  let r = 0;
  for (let b = 0; b < LOG2; b++) r |= ((i >> b) & 1) << (LOG2 - 1 - b);
  rev[i] = r;
}
const cosT = new Float64Array(N_FFT / 2);
const sinT = new Float64Array(N_FFT / 2);
for (let i = 0; i < N_FFT / 2; i++) {
  cosT[i] = Math.cos((2 * Math.PI * i) / N_FFT);
  sinT[i] = -Math.sin((2 * Math.PI * i) / N_FFT);
}

function fft(re, im) {
  for (let i = 0; i < N_FFT; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step], s = sinT[k * step];
        const a = start + k, b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// melFb: Float32Array [257 * 128] row-major (bin, mel), exactly the matrix from nemo128.onnx
export function logMel(wav, melFb) {
  const N = wav.length;
  const padded = new Float64Array(N + N_FFT);
  const pad = N_FFT / 2;
  if (N > 0) padded[pad] = wav[0];
  for (let i = 1; i < N; i++) padded[pad + i] = wav[i] - 0.97 * wav[i - 1];
  const T = Math.floor(N / HOP) + 1; // frames produced by the STFT
  const valid = Math.floor(N / HOP); // features_lens
  const out = new Float32Array(N_MELS * T); // [128, T]
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  const pow = new Float64Array(N_BINS);
  const guard = Math.pow(2, -24);
  const lo = new Int32Array(N_MELS), hi = new Int32Array(N_MELS);
  for (let m = 0; m < N_MELS; m++) {
    lo[m] = N_BINS; hi[m] = 0;
    for (let k = 0; k < N_BINS; k++) if (melFb[k * N_MELS + m] !== 0) { if (k < lo[m]) lo[m] = k; hi[m] = k + 1; }
  }
  for (let t = 0; t < T; t++) {
    const o = t * HOP;
    for (let i = 0; i < N_FFT; i++) { re[i] = padded[o + i] * window512[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N_BINS; k++) pow[k] = re[k] * re[k] + im[k] * im[k];
    for (let m = 0; m < N_MELS; m++) {
      let s = 0;
      for (let k = lo[m]; k < hi[m]; k++) s += pow[k] * melFb[k * N_MELS + m];
      out[m * T + t] = Math.log(s + guard);
    }
  }
  // per-feature normalisation over valid frames, frames >= valid set to 0
  for (let m = 0; m < N_MELS; m++) {
    const row = out.subarray(m * T, (m + 1) * T);
    let mean = 0;
    for (let t = 0; t < valid; t++) mean += row[t];
    mean /= valid;
    let v = 0;
    for (let t = 0; t < valid; t++) { const d = row[t] - mean; v += d * d; }
    const std = Math.sqrt(v / (valid - 1)) + 1e-5;
    for (let t = 0; t < T; t++) row[t] = t < valid ? (row[t] - mean) / std : 0;
  }
  return { features: out, T, valid };
}
