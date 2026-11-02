"use strict";

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
  // Fördela platsen för rätt svar jämnt över passet (1, 2, 3, 4 i blandad ordning, om och om igen),
  // så att rätt svar aldrig råkar hamna på samma plats många gånger i rad.
  let deck = [];
  const slots = items.map(() => { if (!deck.length) deck = shuffle([0, 1, 2, 3]); return deck.pop(); });
  session = { items, title, idx: 0, results: [], slots };
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
  else {
    opts = it.type === "year" ? shuffle(YEARS.filter((y) => y !== it.answer)).slice(0, 3) : shuffle(it.wrong);
    opts.splice(session.slots[session.idx] % (opts.length + 1), 0, it.answer);
  }
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

// Mikrofonknapp med inspelning, ljudnivåmätare och transkribering.
// Anropar onText(text, ljud) med det hon sa och inspelningen i 16 kHz.
function voiceInput(onText, label = "Tryck och svara") {
  const mic = h("button", { type: "button", class: "mic", "aria-label": "Spela in ditt svar" });
  mic.innerHTML = MIC_ICON;
  const meter = h("div", { class: "rec-meter", hidden: true, "aria-hidden": "true" }, h("span"));
  const lbl = h("p", { class: "mic-label" }, label);
  const hint = h("p", { class: "mic-hint" });
  const box = h("div", { class: "voice" }, mic, meter, lbl, hint);
  let busy = false;
  const update = () => {
    if (busy || Rec.active) return;
    const ready = Engine.state === "ready";
    mic.disabled = !ready;
    hint.textContent = ready ? "Tryck igen när du är klar." : engineHint();
  };
  // Följ röstmotorns läge så länge knappen visas, till exempel när den blir klar.
  const listener = () => { if (box.isConnected) update(); else Engine.listeners.delete(listener); };
  update();
  Engine.listeners.add(listener);

  const fail = (text) => {
    mic.hidden = false; mic.disabled = false; meter.hidden = true;
    lbl.textContent = "Försök igen";
    hint.textContent = text;
  };

  mic.onclick = async () => {
    if (Rec.active) { mic.disabled = true; return Rec.stop(); }
    try {
      await Rec.start((secs) => { lbl.textContent = `Spelar in … ${secs} s`; });
    } catch (err) {
      return fail("Mikrofonen gick inte att starta. Tillåt mikrofonen för sidan i Safari (aA i adressfältet, Webbplatsinställningar) och försök igen.");
    }
    mic.classList.add("rec"); mic.innerHTML = STOP_ICON; mic.setAttribute("aria-label", "Sluta spela in");
    lbl.textContent = "Spelar in … 0 s"; hint.textContent = "Tryck när du är klar.";
    meter.hidden = false;

    // Ljudnivåmätaren: visar att mikrofonen faktiskt tar upp ljud.
    const bar = meter.firstElementChild, t0 = Date.now();
    let loudest = 0, warned = false;
    const draw = () => {
      if (!Rec.active) return;
      const level = Rec.level();
      loudest = Math.max(loudest, level);
      bar.style.width = `${Math.min(100, Math.round(Math.sqrt(level) * 260))}%`;
      if (!warned && Date.now() - t0 > 2500 && loudest < 0.004) {
        warned = true;
        hint.textContent = "Jag hör inget från mikrofonen. Prata närmare telefonen och kolla att ingen annan app använder mikrofonen.";
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);

    const rec = await Rec.done;
    mic.classList.remove("rec"); mic.innerHTML = MIC_ICON; mic.setAttribute("aria-label", "Spela in ditt svar");
    meter.hidden = true;
    mic.hidden = true;
    busy = true;
    lbl.textContent = ""; lbl.append(h("span", { class: "spinner", role: "status", "aria-label": "Lyssnar" }));
    hint.textContent = "Pianissimo lyssnar på ditt svar …";
    try {
      const pcm = await to16k(rec);
      const { peak } = audioStats(pcm);
      if (pcm.length < 16000 * 0.4) return fail("Inspelningen blev för kort. Tryck, prata och tryck sedan igen.");
      if (peak < 0.002) return fail("Inspelningen blev helt tyst, mikrofonen gav inget ljud. Kolla att ingen annan app använder mikrofonen och försök igen.");
      if (peak < 0.5) for (let i = 0; i < pcm.length; i++) pcm[i] *= 0.9 / peak;
      const text = await transcribe(pcm.slice());
      box.remove();
      onText(text, pcm);
    } catch (err) {
      fail(err.message || "Något gick fel med taligenkänningen.");
    } finally {
      busy = false;
    }
  };
  return box;
}

// Rutan som visar vad hon sa, med knappar för att lyssna, spela in igen eller lägga till mer.
function saidBox(text, { onRedo, onMore, extra, audio } = {}) {
  const t = h("p", { class: `text${text ? "" : " empty"}` });
  t.textContent = text || (audio
    ? "Ljudet kom fram, men röstmotorn hittade inga ord. Lyssna på inspelningen: hörs du tydligt?"
    : "Jag hörde inget. Prova att prata lite högre och närmare telefonen.");
  const row = h("div", { class: "row" },
    audio ? btn("Lyssna på inspelningen", "small", () => playPcm(audio)) : null,
    onRedo ? btn("Spela in igen", "small", onRedo) : null,
    onMore && text ? btn("Lägg till mer", "small", onMore) : null,
    !text && audio && Engine.backend === "webgpu" ? btn("Prova utan WebGPU", "small", () => Engine.useWasm()) : null,
    extra || null);
  return h("div", { class: "said" }, h("span", { class: "lbl" }, "Du sa"), t, row);
}

function renderOpen(it, stage, actions) {
  let said = "", audio = null;
  const area = h("div", { class: "answer-area" });
  const wrapper = h("div", { style: "display:grid;gap:14px" }, area);
  stage.append(wrapper);

  const record = (append) => {
    area.innerHTML = "";
    actions.innerHTML = "";
    area.append(voiceInput((text, pcm) => { said = append && said ? `${said} ${text}` : text; audio = pcm; reveal(); }, append ? "Tryck och lägg till" : "Tryck och svara"));
    actions.append(btn("Visa svaret", "", () => { said = said || ""; reveal(true); }));
  };

  function reveal(skipped = false) {
    area.innerHTML = "";
    actions.innerHTML = "";
    const n = norm(said);
    const hits = it.points.map((p) => !!said && mentions(n, p.k));
    const count = hits.filter(Boolean).length;
    if (!skipped || said) area.append(saidBox(said, { audio, onRedo: () => { said = ""; audio = null; record(false); }, onMore: () => record(true) }));
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
  function check(text, audio) {
    area.innerHTML = ""; actions.innerHTML = "";
    if (text && mentions(norm(text), it.k)) {
      area.append(saidBox(text, { audio }), h("div", { class: "verdict ok" }, h("b", {}, "Rätt!"), h("p", {}, it.answer)));
      finish(it, true);
      return;
    }
    area.append(
      saidBox(text, { audio, extra: text ? btn("Jag sa rätt, den hörde fel", "small", () => {
        area.innerHTML = "";
        area.append(h("div", { class: "verdict ok" }, h("b", {}, "Okej, rätt!"), h("p", {}, it.answer)));
        finish(it, true);
      }) : null }),
      h("div", { class: "verdict no" }, h("b", {}, text ? "Inte riktigt" : "Inga ord kom fram"), h("p", {}, text ? "Läs ledtrådarna igen och försök en gång till." : "Försök en gång till och prata tydligt.")));
    actions.append(btn("Visa svaret", "", giveUp), btn("Försök igen", "primary", record));
  }
  record();
}

/* ---------- Inspelning ---------- */
// Fångar råa sampel från mikrofonen med Web Audio. Ingen MediaRecorder, inget AAC att avkoda.
const Rec = {
  active: false, stream: null, src: null, node: null, sink: null, analyser: null, levelBuf: null,
  chunks: [], rate: 48000, timer: null, done: null, resolve: null,
  async start(onTick) {
    const ctx = getAudioContext();
    const resumed = ctx.resume().catch(() => {}); // måste ske direkt i användarens tryck i Safari
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    try {
      await resumed;
      if (ctx.state !== "running") await ctx.resume();
      const chunks = (this.chunks = []);
      this.rate = ctx.sampleRate;
      this.src = ctx.createMediaStreamSource(this.stream);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.levelBuf = new Float32Array(this.analyser.fftSize);
      this.node = await captureNode(ctx, (data) => chunks.push(data));
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.src.connect(this.analyser);
      this.src.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(ctx.destination);
    } catch (err) {
      this._release();
      throw err;
    }
    this.done = new Promise((resolve) => (this.resolve = resolve));
    this.active = true;
    const t0 = Date.now();
    this.timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      onTick(s);
      if (s >= MAX_REC_SECONDS) this.stop();
    }, 250);
  },
  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) sum += v * v;
    return Math.sqrt(sum / this.levelBuf.length);
  },
  stop() {
    if (!this.active) return;
    const { chunks, rate, resolve } = this;
    this._release();
    let n = 0;
    for (const c of chunks) n += c.length;
    const pcm = new Float32Array(n);
    let o = 0;
    for (const c of chunks) { pcm.set(c, o); o += c.length; }
    resolve({ pcm, rate });
  },
  cancel() {
    if (this.active || this.stream) this._release();
  },
  _release() {
    clearInterval(this.timer);
    this.active = false;
    for (const n of [this.src, this.analyser, this.node, this.sink]) { try { n && n.disconnect(); } catch { /* redan bortkopplad */ } }
    if (this.node && this.node.port) this.node.port.onmessage = null;
    if (this.node) this.node.onaudioprocess = null;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = this.src = this.analyser = this.node = this.sink = null;
  },
};

let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

let workletReady = null;
async function captureNode(ctx, onData) {
  if (ctx.audioWorklet && window.AudioWorkletNode) {
    try {
      workletReady = workletReady || ctx.audioWorklet.addModule("rec-worklet.js");
      await workletReady;
      const node = new AudioWorkletNode(ctx, "rec-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      node.port.onmessage = (e) => onData(e.data);
      return node;
    } catch {
      workletReady = null;
    }
  }
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => onData(new Float32Array(e.inputBuffer.getChannelData(0)));
  return node;
}

// Gör om inspelningen till 16 kHz mono, det format modellen vill ha.
async function to16k({ pcm, rate }) {
  if (rate === 16000 || !pcm.length) return pcm;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, Math.max(1, Math.ceil((pcm.length * 16000) / rate)), 16000);
  const buf = off.createBuffer(1, pcm.length, rate);
  buf.getChannelData(0).set(pcm);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0);
  return new Float32Array((await off.startRendering()).getChannelData(0));
}

function audioStats(pcm) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  return { peak };
}

function playPcm(pcm) {
  const ctx = getAudioContext();
  ctx.resume().catch(() => {});
  const buf = ctx.createBuffer(1, pcm.length, 16000);
  buf.getChannelData(0).set(pcm);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
}

/* ---------- Röstmotorn: Pianissimo i en worker, allt sker i enheten ---------- */
const LOADING_KEY = "rymdplugg:motor-laddas";
const WASM_KEY = "rymdplugg:utan-webgpu";
const Engine = {
  state: "checking", detail: "", got: 0, total: 0, backend: "",
  worker: null, nextId: 1, pending: new Map(), listeners: new Set(),

  start() {
    try {
      this.worker = new Worker("asr/worker.js", { type: "module" });
    } catch {
      return this.set("unsupported", "Den här webbläsaren kan inte köra röstmotorn.");
    }
    this.worker.onmessage = ({ data }) => this.onMessage(data);
    this.worker.onerror = () => this.fail("Röstmotorn kunde inte starta.");
    let crashed = false;
    try { crashed = !!localStorage.getItem(LOADING_KEY); } catch { /* ignoreras */ }
    if (crashed) return this.set("crashed");
    this.worker.postMessage({ type: "check" });
  },
  async load() {
    try { localStorage.setItem(LOADING_KEY, String(Date.now())); } catch { /* ignoreras */ }
    try { await navigator.storage?.persist?.(); } catch { /* ignoreras */ }
    let webgpu = false;
    let wasmOnly = false;
    try { wasmOnly = localStorage.getItem(WASM_KEY) === "1"; } catch { /* ignoreras */ }
    if (!wasmOnly) {
      try { webgpu = !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { webgpu = false; }
    }
    this.set("loading", "Startar röstmotorn …");
    this.worker.postMessage({ type: "load", webgpu });
  },
  onMessage(m) {
    if (m.type === "cached") { if (m.cached) this.load(); else this.set("missing"); }
    else if (m.type === "progress") {
      this.got = m.got; this.total = m.total;
      const cached = this.state === "loading" && this.detail.startsWith("Startar");
      if (!cached || m.got < m.total) this.set("downloading");
    }
    else if (m.type === "status") this.set("loading", { "Värmer upp": "Nästan klar …" }[m.text] || "Startar röstmotorn …");
    else if (m.type === "ready") {
      try { localStorage.removeItem(LOADING_KEY); } catch { /* ignoreras */ }
      this.backend = m.backend;
      this.set("ready");
    }
    else if (m.type === "result") { this.pending.get(m.id)?.resolve(m.text); this.pending.delete(m.id); }
    else if (m.type === "error") {
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id).reject(new Error(m.text)); this.pending.delete(m.id); }
      else this.fail(m.text);
    }
  },
  // Starta om motorn med eller utan WebGPU. Valet sparas i webbläsaren.
  setWebGPU(on) {
    try { on ? localStorage.removeItem(WASM_KEY) : localStorage.setItem(WASM_KEY, "1"); } catch { /* ignoreras */ }
    this.worker.terminate();
    this.backend = "";
    this.start();
  },
  useWasm() {
    this.setWebGPU(false);
    location.hash = "";
  },
  fail(text) {
    try { localStorage.removeItem(LOADING_KEY); } catch { /* ignoreras */ }
    this.set("error", text);
  },
  set(state, detail = "") {
    this.state = state; this.detail = detail;
    this.listeners.forEach((fn) => fn());
  },
  transcribe(pcm) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: "transcribe", id, audio: pcm }, [pcm.buffer]);
    });
  },
};

async function transcribe(pcm) {
  if (Engine.state !== "ready") throw new Error("Röstmotorn är inte redo än.");
  try { return (await Engine.transcribe(pcm)).trim(); }
  catch { throw new Error("Något gick fel när svaret skulle tolkas. Försök igen, eller tryck Visa svaret."); }
}

const mb = (n) => Math.round(n / 1e6);
function engineHint() {
  return {
    checking: "Röstmotorn startar …",
    loading: "Röstmotorn startar, det tar en liten stund …",
    downloading: `Röstmotorn laddas ner: ${mb(Engine.got)} av ${mb(Engine.total)} MB.`,
    missing: "Röstmotorn är inte nedladdad. Gå till start och ladda ner den, eller tryck Visa svaret.",
    crashed: "Röstmotorn behöver startas om. Gå till start, eller tryck Visa svaret.",
    error: "Röstmotorn fungerar inte just nu. Tryck Visa svaret så kan du ändå öva.",
    unsupported: "Röstsvar fungerar inte i den här webbläsaren. Tryck Visa svaret så kan du ändå öva.",
  }[Engine.state] || "";
}

// Rutan på startsidan som visar röstmotorns läge.
function renderEngineCard() {
  const box = $("#engine");
  box.dataset.state = Engine.state;
  const title = $("#engine-title"), text = $("#engine-text"), bar = $("#engine-bar"), act = $("#engine-action");
  bar.hidden = Engine.state !== "downloading";
  act.hidden = !["missing", "crashed", "error"].includes(Engine.state) && !(Engine.state === "ready" && wasmOnly());
  const pct = Engine.total ? Math.round((Engine.got / Engine.total) * 100) : 0;
  bar.firstElementChild.style.width = `${pct}%`;
  const [t, d, a] = {
    checking: ["Röstmotorn startar …", "", ""],
    missing: ["Ladda ner röstmotorn", "För att svara med rösten behöver telefonen ladda ner Pianissimo en gång, ungefär 530 MB. Gör det på wifi. Sedan fungerar röstsvaren utan att något skickas iväg.", "Ladda ner (530 MB)"],
    downloading: [`Laddar ner röstmotorn: ${pct} %`, `${mb(Engine.got)} av ${mb(Engine.total)} MB. Du kan börja öva under tiden.`, ""],
    loading: ["Röstmotorn startar …", "Det kan ta upp till en halv minut. Du kan börja öva under tiden.", ""],
    ready: [`Röstsvaren är redo (${Engine.backend === "webgpu" ? "WebGPU" : "processorn"})`, "", wasmOnly() ? "Prova WebGPU igen" : ""],
    crashed: ["Röstmotorn stängdes av", "Förra gången hann den inte starta, troligen för att telefonen fick slut på minne. Stäng andra appar och försök igen. Fungerar det inte kan du öva på en dator i stället.", "Försök igen"],
    error: ["Röstmotorn fungerar inte", `Något gick fel: ${Engine.detail} Du kan ändå öva och trycka Visa svaret, eller använda en dator.`, "Försök igen"],
    unsupported: ["Röstsvar fungerar inte här", "Den här webbläsaren kan inte köra röstmotorn. Du kan ändå öva och trycka Visa svaret.", ""],
  }[Engine.state];
  title.textContent = t; text.textContent = d; text.hidden = !d; act.textContent = a;
}
Engine.listeners.add(renderEngineCard);
function wasmOnly() {
  try { return localStorage.getItem(WASM_KEY) === "1"; } catch { return false; }
}
$("#engine-action").onclick = () => {
  if (Engine.state === "ready") Engine.setWebGPU(true);
  else if (Engine.state === "error") { Engine.worker.terminate(); Engine.start(); }
  else Engine.load();
};

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
renderEngineCard();
Engine.start();
