"use strict";

const ASR_URL = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://localhost:7860"
  : "https://klangrickard-rymdplugg-asr.hf.space";
const STORE_KEY = "rymdplugg:v1";
const MAX_REC_SECONDS = 90;
const D = window.DATA;

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const btn = (label, cls, onclick, extra = {}) => h("button", { type: "button", class: `btn ${cls || ""}`, onclick, ...extra }, label);

const MIC_ICON = '<svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/></svg>';
const SPEAK_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>';

/* ---------- Sparat framsteg (bara i den här telefonen) ---------- */
let progress = {};
try { progress = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { progress = {}; }
function saveResult(id, ok) {
  progress[id] = ok ? 1 : 0;
  try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch { /* privat läge */ }
}

/* ---------- Alla frågor som en lista ---------- */
const MODE = Object.fromEntries(D.modes.map((m) => [m.id, m]));
const ITEMS = [];
D.begrepp.forEach((b, i) => ITEMS.push({ id: `begrepp-${i}`, mode: "begrepp", type: "open", stem: b.term, term: true, sub: "Förklara begreppet med egna ord.", answer: b.answer, points: b.points }));
D.fakta.forEach(([q, a, wrong, why], i) => ITEMS.push({ id: `fakta-${i}`, mode: "fakta", type: "mc", stem: q, answer: a, wrong, why }));
D.santfalskt.forEach(([q, v, why], i) => ITEMS.push({ id: `sf-${i}`, mode: "santfalskt", type: "tf", stem: q, answer: v ? "Sant" : "Falskt", why }));
D.vemarjag.forEach((r, i) => ITEMS.push({ id: `vem-${i}`, mode: "vemarjag", type: "who", stem: r.q, answer: r.answer, k: r.k }));
D.ordna.forEach((o, i) => ITEMS.push({ id: `ordna-${i}`, mode: "ordna", type: "order", stem: o.title, items: o.items, tip: o.tip }));
const YEARS = D.tidslinje.map((t) => t[1]);
D.tidslinje.forEach(([ev, y], i) => ITEMS.push({ id: `tid-${i}`, mode: "tidslinje", type: "year", stem: ev, sub: "Vilket år eller vilken tid?", answer: y, why: "" }));
D.resonera.forEach((r, i) => ITEMS.push({ id: `res-${i}`, mode: "resonera", type: "open", stem: r.q, level: r.level, sub: "Svara med hela meningar. Använd gärna eftersom och därför att.", answer: r.answer, points: r.points }));

const KEEP_ORDER = new Set(["ordna", "resonera"]);
const itemsFor = (mode) => ITEMS.filter((it) => it.mode === mode);
const missedItems = () => ITEMS.filter((it) => progress[it.id] === 0);

/* ---------- Skärmar ---------- */
function show(id) {
  for (const s of ["home", "play", "done"]) $("#" + s).hidden = s !== id;
  window.scrollTo(0, 0);
}

function renderHome() {
  stopEverything();
  const list = $("#modes");
  list.innerHTML = "";
  for (const m of D.modes) {
    const all = itemsFor(m.id), known = all.filter((it) => progress[it.id] === 1).length;
    const name = h("span", { class: "name" }, m.title);
    if (m.voice) {
      const tag = h("span", { class: "mic-tag", title: "Svara med rösten", "aria-label": "Svara med rösten" });
      tag.innerHTML = MIC_ICON.replace(/width="38" height="38"/, 'width="18" height="18"');
      name.append(tag);
    }
    const meter = h("span", { class: "meter" }, h("span", { style: `width:${Math.round((known / all.length) * 100)}%` }));
    list.append(h("li", {}, h("button", { type: "button", class: "mode", onclick: () => (location.hash = m.id) },
      name, h("span", { class: "desc" }, m.desc),
      h("span", { class: "prog" }, `${known} av ${all.length}`, meter))));
  }
  const missed = missedItems().length, mb = $("#missed");
  mb.hidden = !missed;
  mb.innerHTML = "";
  mb.append(`Öva på det du missat (${missed})`, h("small", {}, "Blandar frågorna du svarat fel på eller ville öva mer på."));
  show("home");
}
$("#missed").onclick = () => (location.hash = "missade");
$("#reset-progress").onclick = () => { $("#reset-confirm").hidden = false; };
$("#reset-no").onclick = () => { $("#reset-confirm").hidden = true; };
$("#reset-yes").onclick = () => {
  progress = {};
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignoreras */ }
  $("#reset-confirm").hidden = true;
  renderHome();
};

/* ---------- Övningspass ---------- */
let session = null;

function startSession(items, title) {
  if (!items.length) { location.hash = ""; return; }
  session = { items, title, idx: 0, results: [] };
  show("play");
  renderItem();
}

function routeFromHash() {
  const id = location.hash.slice(1);
  if (MODE[id]) {
    const items = itemsFor(id);
    startSession(KEEP_ORDER.has(id) ? items : shuffle(items), MODE[id].title);
  } else if (id === "missade") {
    startSession(shuffle(missedItems()), "Det du missat");
  } else {
    renderHome();
  }
}
window.addEventListener("hashchange", routeFromHash);
$("#quit").onclick = () => { location.hash = ""; };

function renderItem() {
  stopEverything();
  const { items, idx } = session, it = items[idx];
  $("#count").textContent = `${idx + 1} / ${items.length}`;
  $("#bar-fill").style.width = `${(idx / items.length) * 100}%`;
  const stage = $("#stage"), actions = $("#actions");
  stage.innerHTML = ""; actions.innerHTML = "";

  const kicker = h("div", { class: "kicker" }, MODE[it.mode].title);
  if (it.level) kicker.append(h("span", { class: `level l${it.level}` }, ["", "Grund", "Fördjupning", "Utmaning"][it.level]));
  const speakText = it.type === "mc" ? `${it.stem}` : it.term ? `Förklara ${it.stem}` : it.stem;
  stage.append(kicker, h("div", { class: "stem-row" },
    h(it.type === "order" ? "h2" : "p", { class: `stem${it.term ? " term" : ""}` }, it.stem),
    speakButton(speakText)));
  if (it.sub) stage.append(h("p", { class: "sub" }, it.sub));

  ({ mc: renderChoice, year: renderChoice, tf: renderChoice, order: renderOrder, open: renderOpen, who: renderWho })[it.type](it, stage, actions);
  window.scrollTo(0, 0);
}

function finish(it, ok, { advance = false } = {}) {
  saveResult(it.id, ok);
  session.results[session.idx] = ok;
  if (advance) return next();
  const actions = $("#actions");
  actions.innerHTML = "";
  actions.append(btn(session.idx + 1 < session.items.length ? "Nästa" : "Se resultatet", "primary", next));
}

function next() {
  session.idx++;
  if (session.idx < session.items.length) renderItem();
  else renderDone();
}

function renderDone() {
  stopEverything();
  const { items, results, title } = session;
  const right = results.filter(Boolean).length;
  const missed = items.filter((_, i) => !results[i]);
  const body = $("#done-body");
  body.innerHTML = "";
  const msg = right === items.length ? "Alla rätt, snyggt jobbat!" : right / items.length >= 0.7 ? "Bra jobbat!" : "Bra att du övar. Kör en gång till!";
  body.append(
    h("p", { class: "eyebrow" }, title),
    h("p", { class: "big" }, `${right} / ${items.length}`),
    h("h2", {}, msg),
    h("div", { class: "stack" },
      missed.length ? btn(`Öva på de ${missed.length} du missade`, "primary", () => startSession(shuffle(missed), `${title}: missade`)) : null,
      btn("Kör hela avsnittet igen", missed.length ? "" : "primary", () => startSession(KEEP_ORDER.has(items[0].mode) ? items : shuffle(items), title)),
      btn("Till start", "", () => { location.hash = ""; if (!location.hash) renderHome(); })));
  show("done");
}

/* ---------- Flerval, sant/falskt och årtal ---------- */
function renderChoice(it, stage) {
  let opts;
  if (it.type === "tf") opts = ["Sant", "Falskt"];
  else if (it.type === "year") opts = shuffle([it.answer, ...shuffle(YEARS.filter((y) => y !== it.answer)).slice(0, 3)]);
  else opts = shuffle([it.answer, ...it.wrong]);
  const box = h("div", { class: `options${it.type === "tf" ? " tf" : ""}` });
  const verdict = h("div", { class: "verdict", hidden: true });
  for (const o of opts) {
    box.append(h("button", { type: "button", class: "opt", onclick: (e) => {
      const ok = o === it.answer;
      box.querySelectorAll(".opt").forEach((b) => { b.disabled = true; if (b.textContent === it.answer) b.classList.add("right"); });
      if (!ok) e.currentTarget.classList.add("wrong");
      verdict.className = `verdict ${ok ? "ok" : "no"}`;
      verdict.append(h("b", {}, ok ? "Rätt!" : `Rätt svar: ${it.answer}`));
      if (it.why) verdict.append(h("p", {}, it.why));
      verdict.hidden = false;
      finish(it, ok);
    } }, o));
  }
  stage.append(box, verdict);
}

/* ---------- Ordna ---------- */
function renderOrder(it, stage, actions) {
  const picked = h("div", { class: "picked" }), pool = h("div", { class: "pool" });
  const result = h("div", { class: "verdict", hidden: true });
  const check = btn("Kontrollera", "primary", doCheck, { disabled: true });
  const update = () => { check.disabled = pool.children.length > 0; };
  for (const name of shuffle(it.items)) {
    pool.append(h("button", { type: "button", class: "chip", onclick: (e) => {
      const c = e.currentTarget;
      if (c.disabled) return;
      (c.parentNode === pool ? picked : pool).append(c);
      update();
    } }, name));
  }
  function doCheck() {
    const chips = [...picked.children];
    let ok = 0;
    chips.forEach((c, i) => { const r = c.textContent === it.items[i]; c.classList.add(r ? "right" : "wrong"); c.disabled = true; if (r) ok++; });
    const all = ok === it.items.length;
    result.className = `verdict ${all ? "ok" : "no"}`;
    result.append(h("b", {}, all ? "Helt rätt!" : `${ok} av ${it.items.length} på rätt plats`));
    if (!all) result.append(h("p", {}, "Rätt ordning:"), h("ol", { class: "solution" }, it.items.map((x) => h("li", {}, x))));
    if (it.tip) result.append(h("p", {}, it.tip));
    result.hidden = false;
    finish(it, all);
  }
  stage.append(h("p", { class: "sub" }, "Din ordning (tryck på ett ord för att ta bort det):"), picked, h("p", { class: "sub" }, "Ord att välja bland:"), pool, result);
  actions.append(check);
}

/* ---------- Röstsvar ---------- */
const norm = (s) => " " + s.toLowerCase().normalize("NFC").replace(/[^a-z0-9åäöéüæø]+/g, " ").trim() + " ";
const mentions = (said, keys) => keys.some((k) => said.includes(" " + k.toLowerCase()));

// Mikrofonknapp med inspelning och transkribering. Anropar onText med det hon sa.
function voiceInput(onText, label = "Tryck och svara") {
  const mic = h("button", { type: "button", class: "mic", "aria-label": "Spela in ditt svar" });
  mic.innerHTML = MIC_ICON;
  const lbl = h("p", { class: "mic-label" }, label);
  const hint = h("p", { class: "mic-hint" }, asrState === "ready" ? "Tryck igen när du är klar." : asrHintText());
  const box = h("div", { class: "voice" }, mic, lbl, hint);
  mic.onclick = async () => {
    if (Rec.active) { mic.disabled = true; return Rec.stop(); }
    try {
      await Rec.start((secs) => { lbl.textContent = `Spelar in … ${secs} s`; });
    } catch (err) {
      hint.textContent = "Mikrofonen gick inte att starta. Tillåt mikrofonen för sidan i Safari och försök igen.";
      return;
    }
    mic.classList.add("rec"); mic.innerHTML = STOP_ICON; mic.setAttribute("aria-label", "Sluta spela in");
    lbl.textContent = "Spelar in … 0 s"; hint.textContent = "Tryck när du är klar.";
    let blob;
    try { blob = await Rec.done; } finally {
      mic.classList.remove("rec"); mic.innerHTML = MIC_ICON; mic.setAttribute("aria-label", "Spela in ditt svar");
    }
    mic.hidden = true;
    lbl.textContent = ""; lbl.append(h("span", { class: "spinner", role: "status", "aria-label": "Lyssnar" }));
    hint.textContent = "Pianissimo lyssnar på ditt svar …";
    try {
      const text = await transcribe(blob);
      box.remove();
      onText(text);
    } catch (err) {
      mic.hidden = false; mic.disabled = false;
      lbl.textContent = "Försök igen";
      hint.textContent = err.message || "Något gick fel med taligenkänningen.";
    }
  };
  return box;
}

// Rutan som visar vad hon sa, med knappar för att spela in igen eller lägga till mer.
function saidBox(text, { onRedo, onMore, extra } = {}) {
  const t = h("p", { class: `text${text ? "" : " empty"}` });
  t.textContent = text || "Jag hörde inget. Prova att prata lite högre och närmare telefonen.";
  const row = h("div", { class: "row" },
    onRedo ? btn("Spela in igen", "small", onRedo) : null,
    onMore && text ? btn("Lägg till mer", "small", onMore) : null,
    extra || null);
  return h("div", { class: "said" }, h("span", { class: "lbl" }, "Du sa"), t, row);
}

function renderOpen(it, stage, actions) {
  let said = "";
  const area = h("div", { class: "answer-area" });
  const wrapper = h("div", { style: "display:grid;gap:14px" }, area);
  stage.append(wrapper);

  const record = (append) => {
    area.innerHTML = "";
    actions.innerHTML = "";
    area.append(voiceInput((text) => { said = append && said ? `${said} ${text}` : text; reveal(); }, append ? "Tryck och lägg till" : "Tryck och svara"));
    actions.append(btn("Visa svaret", "", () => { said = said || ""; reveal(true); }));
  };

  function reveal(skipped = false) {
    area.innerHTML = "";
    actions.innerHTML = "";
    const n = norm(said);
    const hits = it.points.map((p) => !!said && mentions(n, p.k));
    const count = hits.filter(Boolean).length;
    if (!skipped || said) area.append(saidBox(said, { onRedo: () => { said = ""; record(false); }, onMore: () => record(true) }));
    const head = said
      ? count === it.points.length ? "Du fick med allt det här:" : `Du fick med ${count} av ${it.points.length}:`
      : "Ett bra svar tar upp det här:";
    area.append(
      h("p", { class: "points-head" }, head),
      h("ul", { class: "points" }, it.points.map((p, i) =>
        h("li", { class: hits[i] ? "hit" : "" }, h("span", { class: "mark", "aria-label": hits[i] ? "Med" : "Saknas" }, hits[i] ? "✓" : ""), h("span", {}, p.t)))),
      h("div", { class: "model" }, h("span", { class: "lbl" }, "Exempel på svar"), h("p", {}, it.answer)),
      h("p", { class: "sub" }, "Jämför med ditt svar. Kunde du det?"));
    actions.append(
      btn("Öva mer", "bad", () => finish(it, false, { advance: true })),
      btn("Jag kunde det", "good", () => finish(it, true, { advance: true })));
  }

  record(false);
}

function renderWho(it, stage, actions) {
  const area = h("div", { style: "display:grid;gap:14px" });
  stage.append(area);
  const giveUp = () => {
    area.innerHTML = "";
    area.append(h("div", { class: "verdict info" }, h("b", {}, "Svaret är"), h("p", {}, it.answer)));
    finish(it, false);
  };
  const record = () => {
    area.innerHTML = ""; actions.innerHTML = "";
    area.append(voiceInput(check, "Tryck och säg vem jag är"));
    actions.append(btn("Visa svaret", "", giveUp));
  };
  function check(text) {
    area.innerHTML = ""; actions.innerHTML = "";
    if (text && mentions(norm(text), it.k)) {
      area.append(saidBox(text), h("div", { class: "verdict ok" }, h("b", {}, "Rätt!"), h("p", {}, it.answer)));
      finish(it, true);
      return;
    }
    area.append(
      saidBox(text, { extra: text ? btn("Jag sa rätt, den hörde fel", "small", () => {
        area.innerHTML = "";
        area.append(h("div", { class: "verdict ok" }, h("b", {}, "Okej, rätt!"), h("p", {}, it.answer)));
        finish(it, true);
      }) : null }),
      h("div", { class: "verdict no" }, h("b", {}, text ? "Inte riktigt" : "Jag hörde inget"), h("p", {}, "Läs ledtrådarna igen och försök en gång till.")));
    actions.append(btn("Visa svaret", "", giveUp), btn("Försök igen", "primary", record));
  }
  record();
}

/* ---------- Inspelning ---------- */
const Rec = {
  active: false, stream: null, recorder: null, done: null, timer: null, _stop: null,
  async start(onTick) {
    getAudioContext(); // måste skapas direkt i användarens tryck, annars stoppar Safari ljudet
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    this.done = new Promise((resolve) => {
      this.recorder.onstop = () => {
        this._release();
        resolve(new Blob(chunks, { type: this.recorder.mimeType || mime || "audio/mp4" }));
      };
    });
    this.recorder.start(250);
    this.active = true;
    const t0 = Date.now();
    this.timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      onTick(s);
      if (s >= MAX_REC_SECONDS) this.stop();
    }, 250);
  },
  stop() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
  },
  cancel() {
    if (!this.active) return;
    if (this.recorder) { this.recorder.onstop = () => this._release(); this.stop(); }
    this._release();
  },
  _release() {
    clearInterval(this.timer);
    this.active = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  },
};

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function decode(buf) {
  const ctx = getAudioContext();
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

// Gör om inspelningen till WAV med 16 kHz mono, det format modellen vill ha.
async function toWav16k(blob) {
  const decoded = await decode(await blob.arrayBuffer());
  const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, frames, 16000);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start(0);
  const rendered = await off.startRendering();
  const pcm = rendered.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  const gain = peak > 0 && peak < 0.5 ? 0.9 / peak : 1;

  const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, "data"); out.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] * gain));
    out.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([out.buffer], { type: "audio/wav" });
}

async function transcribe(blob) {
  let wav;
  try { wav = await toWav16k(blob); } catch { throw new Error("Inspelningen gick inte att läsa. Försök igen."); }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(`${ASR_URL}/transcribe`, { method: "POST", body: wav, headers: { "Content-Type": "audio/wav" }, signal: ctrl.signal });
    if (!r.ok) throw new Error();
    setAsrState("ready");
    return ((await r.json()).text || "").trim();
  } catch {
    wakeAsr();
    throw new Error("Taligenkänningen svarade inte. Den kanske håller på att starta. Vänta en stund och försök igen, eller tryck Visa svaret.");
  } finally {
    clearTimeout(timeout);
  }
}

/* ---------- Status för taligenkänningen ---------- */
let asrState = "waking", waking = false;
function asrHintText() {
  return asrState === "down"
    ? "Röstsvaren svarar inte just nu. Du kan prova ändå eller trycka Visa svaret."
    : "Röstsvaren håller på att starta. Det kan ta en minut första gången.";
}
function setAsrState(state) {
  asrState = state;
  const el = $("#asr-status");
  el.dataset.state = state;
  $("#asr-text").textContent = { waking: "Röstsvaren startar, det kan ta någon minut …", ready: "Röstsvaren är redo", down: "Röstsvaren svarar inte just nu. Tryck här för att försöka igen." }[state];
}
async function wakeAsr() {
  if (waking) return;
  waking = true;
  if (asrState !== "ready") setAsrState("waking");
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    try {
      const r = await fetch(`${ASR_URL}/`, { cache: "no-store" });
      if (r.ok && (await r.json()).status === "ok") { setAsrState("ready"); waking = false; return; }
    } catch { /* sover fortfarande */ }
    await sleep(5000);
  }
  setAsrState("down");
  waking = false;
}
$("#asr-status").onclick = () => { if (asrState === "down") wakeAsr(); };

/* ---------- Uppläsning ---------- */
function speakButton(text) {
  if (!("speechSynthesis" in window)) return null;
  const b = h("button", { type: "button", class: "speak", "aria-label": "Läs upp frågan" });
  b.innerHTML = SPEAK_ICON;
  b.onclick = () => {
    if (b.classList.contains("on")) { speechSynthesis.cancel(); b.classList.remove("on"); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "sv-SE";
    const voice = speechSynthesis.getVoices().find((v) => v.lang.replace("_", "-").toLowerCase().startsWith("sv"));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = u.onerror = () => b.classList.remove("on");
    b.classList.add("on");
    speechSynthesis.speak(u);
  };
  return b;
}

function stopEverything() {
  Rec.cancel();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/* ---------- Start ---------- */
routeFromHash();
wakeAsr();
