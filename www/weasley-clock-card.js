/* Weasley Clock Card - vanilla custom Lovelace card, no dependencies.
 * type: custom:weasley-clock-card
 * title: The Family              (optional)
 * people: [{entity: person.x, tracker: device_tracker.life360_x, name: X, color: '#hex'}]
 * max_size: 96vh               (optional, default min(560px,78vh)) largest dial size
 * show_legend: false          (optional, default true) hide the name legend under the dial
 * sounds: true                  (optional, default false) clockwork whirr + chime when a hand moves
 * (sounds: long-press the face ~0.7 s to test)
 * volume: 0.6                   (optional, 0-1)   sound_path: /local/weasley/  (optional; clockwork.mp3, chime.mp3)
 * positions: [{name: Home, zones: [home]}, {name: Work, zones: [...]}, ...]  (strings allowed)
 * peril_battery: 10  traveling_speed: 5
 * special position names (override): peril_position, traveling_position, out_position, lost_position
 */
(() => {
const DEFAULT_POSITIONS = [
  { name: "Home", zones: ["home"] },
  { name: "Work", zones: [] },
  { name: "School", zones: ["School"] },
  { name: "Family", zones: [] },
  { name: "Out", zones: [] },
  { name: "Traveling", zones: [] },
  { name: "Lost", zones: [] },
  { name: "Mortal Peril", zones: [] },
];
const PALETTE = ["#9b2335", "#1f5f8b", "#2e7d4f", "#7b4b94", "#c46a1b", "#2a7f86", "#8a6d1d", "#5b5b5b"];
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const C = 200; // svg centre
const polar = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
const f = (n) => n.toFixed(2);

class WeasleyClockCard extends HTMLElement {
  static getStubConfig() {
    return { people: [{ entity: "person.example", name: "Me" }] };
  }
  setConfig(config) {
    if (!config || !Array.isArray(config.people) || !config.people.length) throw new Error("weasley-clock-card: 'people' list is required");
    const positions = (config.positions || DEFAULT_POSITIONS).map((p) => typeof p === "string"
      ? (DEFAULT_POSITIONS.find((d) => d.name === p) || { name: p, zones: [] })
      : { name: p.name, zones: p.zones || [] });
    this._cfg = {
      title: config.title ?? "",
      peril: Number(config.peril_battery ?? 10),
      speed: Number(config.traveling_speed ?? 5),
      perilPos: config.peril_position || "Mortal Peril",
      travelPos: config.traveling_position || "Traveling",
      outPos: config.out_position || "Out",
      lostPos: config.lost_position || "Lost",
      positions,
      legend: config.show_legend !== false,
      maxSize: String(config.max_size || "min(560px,78vh)").replace(/[^a-zA-Z0-9(),.% ]/g, ""),
      sounds: config.sounds === true,
      volume: Math.min(1, Math.max(0, Number(config.volume ?? 0.6))),
      soundBase: (config.sound_path || "/local/weasley/").replace(/\/?$/, "/"),
      people: config.people.map((p, i) => ({
        entity: p.entity, tracker: p.tracker, color: p.color || PALETTE[i % PALETTE.length],
        name: p.name || (p.entity || "").split(".").pop().split("_")[0].replace(/^./, (c) => c.toUpperCase()),
      })),
    };
    this._angles = {};
    this._last = "";
    this._prevPos = undefined; // no sound on first render after (re)config
    this._quietUntil = 0;
    this._build();
    if (this._hass) this._update();
  }
  set hass(h) {
    // first load / websocket reconnect: states catch up silently
    const wasConnected = this._hass ? this._hass.connected !== false : false;
    if (!this._hass || (h && h.connected !== false && !wasConnected)) this._quiet(5000);
    this._hass = h; if (this._cfg) this._update();
  }
  _quiet(ms) { this._quietUntil = Math.max(this._quietUntil || 0, Date.now() + ms); }
  connectedCallback() {
    this._quiet(5000); // (re)attached, e.g. dashboard opened/switched
    if (!window.__weasleyVisArmed) {
      window.__weasleyVisArmed = true;
      // app/tab resumed: whatever changed while away updates silently
      document.addEventListener("visibilitychange", () => { if (!document.hidden) window.__weasleyResumeAt = Date.now(); });
    }
  }
  _isQuiet() {
    // background tabs still get live updates, so they may chime; only catch-up after a resume is silent
    const now = Date.now();
    return !this.isConnected || now < this._quietUntil ||
      (window.__weasleyResumeAt && now - window.__weasleyResumeAt < 5000);
  }

  /* ---------- sound (opt-in) ----------
   * Web Audio first: once a tap/click resumes the AudioContext, it can play from
   * state updates with no further gesture (Safari / WKWebView / Android WebView block
   * HTMLAudio.play() outside a gesture). HTMLAudio is kept as a fallback. */
  _url(name) { return this._cfg.soundBase + name + ".mp3"; }
  _audio(name) {
    const url = this._url(name);
    const cache = (window.__weasleyAudio = window.__weasleyAudio || {});
    if (!cache[url]) { const a = new Audio(url); a.preload = "auto"; cache[url] = a; }
    // fetch the bytes early; decoding needs the AudioContext (created on first gesture)
    const raw = (window.__weasleyRaw = window.__weasleyRaw || {});
    if (!raw[url] && window.fetch) raw[url] = fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    return cache[url];
  }
  _buffer(name) {
    const ac = window.__weasleyAC, url = this._url(name);
    if (!ac) return Promise.resolve(null);
    const bufs = (window.__weasleyBuf = window.__weasleyBuf || {});
    if (!bufs[url]) {
      const raw = (window.__weasleyRaw || {})[url] || fetch(url).then((r) => r.arrayBuffer());
      bufs[url] = raw.then((ab) => ab && new Promise((res) => {
        const ok = (b) => { if (b) b.__wcName = name; res(b || null); };
        try { const pr = ac.decodeAudioData(ab.slice(0), ok, () => res(null)); if (pr && pr.then) pr.then(ok, () => res(null)); }
        catch (e) { res(null); }
      })).catch(() => null);
    }
    return bufs[url];
  }
  _armUnlock() {
    if (window.__weasleyUnlockArmed) return;
    window.__weasleyUnlockArmed = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    // stays armed: Safari/WebViews can suspend the context again (sleep, background)
    const unlock = () => {
      if (AC) {
        try {
          if (!window.__weasleyAC) window.__weasleyAC = new AC();
          const ac = window.__weasleyAC;
          if (ac.state !== "running") {
            const pr = ac.resume(); if (pr && pr.catch) pr.catch(() => {});
            // iOS/Safari: starting a (silent) source inside the gesture unlocks output
            const src = ac.createBufferSource(); src.buffer = ac.createBuffer(1, 1, 22050); src.connect(ac.destination); src.start(0);
          }
          Object.values(window.__weasleyRaw || {}).length && ["clockwork", "chime"].forEach((n) => this._cfg && this._buffer(n));
        } catch (e) { /* ignore */ }
      }
      if (!window.__weasleyHtmlUnlocked) {
        Object.values(window.__weasleyAudio || {}).forEach((a) => {
          if (!a.paused) return;
          try { a.muted = true;
            const pr = a.play(); const done = () => { a.pause(); a.currentTime = 0; a.muted = false; window.__weasleyHtmlUnlocked = true; };
            pr && pr.then ? pr.then(done, () => { a.muted = false; }) : done();
          } catch (e) { /* ignore */ }
        });
      }
    };
    ["pointerdown", "pointerup", "touchend", "click", "keydown"].forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
  }
  _play(name) {
    const ac = window.__weasleyAC, vol = this._cfg.volume;
    const viaHtml = () => {
      const a = this._audio(name);
      try { a.pause(); a.currentTime = 0; a.muted = false; a.volume = vol;
        const pr = a.play(); if (pr && pr.catch) return pr.then(() => true, () => false); } catch (e) { /* blocked */ }
      return Promise.resolve(false);
    };
    if (!ac) return viaHtml();
    const ready = ac.state === "running" ? Promise.resolve() : Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 300))]).catch(() => {});
    return Promise.all([ready, this._buffer(name)]).then(([, buf]) => {
      if (!buf || ac.state !== "running") return viaHtml();
      try {
        const src = ac.createBufferSource(), g = ac.createGain();
        src.buffer = buf; g.gain.value = vol; src.connect(g); g.connect(ac.destination); src.start(0);
        return true;
      } catch (e) { return viaHtml(); }
    });
  }
  _playSequence() {
    clearTimeout(this._chimeT); this._chimeT = null;
    const t0 = Date.now(), seq = (this._seq = (this._seq || 0) + 1);
    // chime only follows a clockwork that actually started: never a lone chime, never queued
    return this._play("clockwork").then((ok) => {
      if (ok && seq === this._seq) this._chimeT = setTimeout(() => this._play("chime"), Math.max(0, 2550 - (Date.now() - t0)));
      return ok;
    });
  }

  /* ---------- long-press sound test (sounds: true only) ---------- */
  _bindLongPress() {
    const wrap = this.querySelector(".wc-svg");
    if (!wrap || !this._cfg.sounds) return;
    wrap.classList.add("wc-lp");
    let t = null, x0 = 0, y0 = 0, t0 = 0, fired = false, retry = false;
    const cancel = () => { clearTimeout(t); t = null; };
    const fire = () => {
      if (fired) return;
      cancel(); fired = true;
      window.__weasleyLastSound = Date.now();
      this._cue();
      // touch: activation only arrives on release, so retry there if blocked
      this._playSequence().then((ok) => { if (!ok) retry = true; });
    };
    const release = (e) => {
      cancel();
      if (fired) { if (e.cancelable) e.preventDefault(); if (retry) { retry = false; this._playSequence(); } }
    };
    wrap.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      cancel(); fired = false; retry = false; x0 = e.clientX; y0 = e.clientY; t0 = Date.now();
      t = setTimeout(fire, 700);
    });
    wrap.addEventListener("pointermove", (e) => { if (t && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) cancel(); });
    wrap.addEventListener("pointerup", release);
    wrap.addEventListener("touchend", release);
    wrap.addEventListener("pointerleave", cancel);
    // mobile browsers / webviews may cancel the pointer for their own long-press:
    // if the finger was held still long enough, treat that as the long-press
    wrap.addEventListener("pointercancel", () => { if (t && Date.now() - t0 >= 400) fire(); else cancel(); });
    wrap.addEventListener("contextmenu", (e) => { e.preventDefault(); if (t) fire(); });
    wrap.addEventListener("click", (e) => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  }
  _cue() {
    const svg = this.querySelector(".wc-svg");
    if (!svg) return;
    svg.classList.remove("wc-cue"); void svg.getBoundingClientRect(); svg.classList.add("wc-cue");
    clearTimeout(this._cueT); this._cueT = setTimeout(() => svg.classList.remove("wc-cue"), 1300);
  }
  _chimeSound() {
    if (!this._cfg.sounds) return;
    const now = Date.now();
    if (window.__weasleyLastSound && now - window.__weasleyLastSound < 2000) return; // play once per change burst
    window.__weasleyLastSound = now;
    this._playSequence();
  }
  getCardSize() { return 8; }
  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6 }; }

  /* ---------- position logic ---------- */
  _compute(p) {
    const h = this._hass, cfg = this._cfg;
    const ps = h.states[p.entity];
    const tr = p.tracker ? h.states[p.tracker] : undefined;
    const ta = (tr && tr.attributes) || {}, pa = (ps && ps.attributes) || {};
    const state = ps ? ps.state : (tr ? tr.state : "unknown");
    const has = (n) => cfg.positions.some((x) => x.name === n);
    const bat = Number(ta.battery_level ?? ta.battery ?? pa.battery_level ?? pa.battery);
    const charging = [ta.battery_charging, ta.charging, pa.battery_charging].some((v) => v === true || v === "on" || v === "true");
    let pos, detail = "";
    if (!isNaN(bat) && bat < cfg.peril && !charging && has(cfg.perilPos)) { pos = cfg.perilPos; detail = `battery ${bat}%`; }
    if (!pos) {
      const s = norm(state);
      for (const x of cfg.positions) if (x.zones.some((z) => norm(z) === s || norm(String(z).replace(/^zone\./, "")) === s)) { pos = x.name; break; }
      if (pos && state !== "home" && norm(pos) !== s) detail = state;
    }
    const speed = Number(ta.speed);
    if (!pos && (ta.driving === true || (!isNaN(speed) && speed > cfg.speed)) && has(cfg.travelPos)) pos = cfg.travelPos;
    if (!pos && !["not_home", "unknown", "unavailable", "home", ""].includes(state) && has(cfg.outPos)) { pos = cfg.outPos; detail = state; }
    if (!pos) pos = has(cfg.lostPos) ? cfg.lostPos : cfg.positions[0].name;
    return { pos, detail };
  }

  /* ---------- static SVG ---------- */
  _build() {
    const cfg = this._cfg, n = cfg.positions.length, seg = 360 / n;
    const uid = "wc" + Math.random().toString(36).slice(2, 8);
    let defs = `
      <radialGradient id="${uid}wood" cx="50%" cy="45%" r="60%">
        <stop offset="0" stop-color="#7a4a26"/><stop offset=".7" stop-color="#5a3216"/><stop offset="1" stop-color="#2e1608"/></radialGradient>
      <filter id="${uid}grain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.18" numOctaves="3" seed="7"/>
        <feColorMatrix values="0 0 0 0 0.16  0 0 0 0 0.08  0 0 0 0 0.02  0 0 0 .55 0"/>
        <feComposite in2="SourceGraphic" operator="in"/></filter>
      <linearGradient id="${uid}brass" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff1b8"/><stop offset=".25" stop-color="#d9a93f"/><stop offset=".5" stop-color="#8a5f17"/>
        <stop offset=".75" stop-color="#e6bd5a"/><stop offset="1" stop-color="#6e4a10"/></linearGradient>
      <linearGradient id="${uid}brass2" x1="1" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f7dc8a"/><stop offset=".5" stop-color="#9c6f1f"/><stop offset="1" stop-color="#e2b75a"/></linearGradient>
      <radialGradient id="${uid}face" cx="45%" cy="40%" r="65%">
        <stop offset="0" stop-color="#fbf1d6"/><stop offset=".65" stop-color="#ecd9a8"/><stop offset="1" stop-color="#c9a76a"/></radialGradient>
      <radialGradient id="${uid}boss" cx="38%" cy="35%" r="70%">
        <stop offset="0" stop-color="#fff4c4"/><stop offset=".45" stop-color="#d4a03c"/><stop offset="1" stop-color="#5c3d0b"/></radialGradient>
      <filter id="${uid}shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="1.5" dy="2.5" stdDeviation="1.8" flood-color="#2b1a05" flood-opacity=".55"/></filter>
      <filter id="${uid}soft" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity=".45"/></filter>`;
    const rLabel = 131;
    let labels = "", dividers = "", ticks = "";
    cfg.positions.forEach((p, i) => {
      const a = i * seg, a0 = a - seg / 2 + 1.5, a1 = a + seg / 2 - 1.5;
      const bottom = a > 90 && a < 270;
      const words = p.name.toUpperCase().split(/\s+/);
      const lines = words.length > 1 && p.name.length > (n > 8 ? 6 : 8) ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")] : [words.join(" ")];
      const radii = lines.length === 1 ? [rLabel] : [rLabel + 7, rLabel - 10];
      lines.forEach((txt, li) => {
        const rr = (bottom ? radii[lines.length - 1 - li] : radii[li]);
        const r = bottom ? rr + 6 : rr;
        const avail = r * (a1 - a0) * Math.PI / 180 * 0.92;
        const fs = Math.max(9, Math.min(lines.length > 1 ? 14 : 18.5, avail / (txt.length * 0.74)));
        const [x0, y0] = polar(r, bottom ? a1 : a0), [x1, y1] = polar(r, bottom ? a0 : a1);
        defs += `<path id="${uid}lp${i}_${li}" d="M${f(x0)} ${f(y0)} A${r} ${r} 0 0 ${bottom ? 0 : 1} ${f(x1)} ${f(y1)}"/>`;
        labels += `<text class="lbl" font-size="${f(fs)}"><textPath href="#${uid}lp${i}_${li}" startOffset="50%" text-anchor="middle">${esc(txt)}</textPath></text>`;
      });
      // divider ornaments between positions
      const d = a + seg / 2;
      const [dx0, dy0] = polar(112, d), [dx1, dy1] = polar(150, d);
      dividers += `<line x1="${f(dx0)}" y1="${f(dy0)}" x2="${f(dx1)}" y2="${f(dy1)}" stroke="#7a5418" stroke-width="1.4" opacity=".75"/>`;
      const [sx, sy] = polar(150, d);
      dividers += `<g transform="translate(${f(sx)} ${f(sy)}) rotate(${d})"><path d="M0 -6 L3.2 0 L0 6 L-3.2 0Z" fill="url(#${uid}brass)" stroke="#5c3d0b" stroke-width=".6"/></g>`;
      // small pip at each label centre near hub ring
      const [px, py] = polar(107, a);
      dividers += `<circle cx="${f(px)}" cy="${f(py)}" r="2.6" fill="#7a5418"/>`;
    });
    for (let t = 0; t < 72; t++) {
      const a = t * 5, big = t % 3 === 0;
      const [x0, y0] = polar(157, a), [x1, y1] = polar(big ? 151 : 154, a);
      ticks += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="#6b4512" stroke-width="${big ? 1.4 : .8}"/>`;
    }
    // beaded brass rim
    let beads = "";
    for (let b = 0; b < 48; b++) { const [x, y] = polar(171, b * 7.5); beads += `<circle cx="${f(x)}" cy="${f(y)}" r="2.3" fill="url(#${uid}boss)" stroke="#5c3d0b" stroke-width=".4"/>`; }
    // filigree scrolls in the wood at 4 corners
    let scroll = "";
    for (const a of [45, 135, 225, 315]) {
      scroll += `<g transform="rotate(${a} ${C} ${C})" fill="none" stroke="url(#${uid}brass2)" stroke-width="2" stroke-linecap="round" opacity=".9">
        <path d="M${C} ${C - 186} c-10 -2 -18 4 -16 11 c2 6 10 5 10 0"/><path d="M${C} ${C - 186} c10 -2 18 4 16 11 c-2 6 -10 5 -10 0"/>
        <circle cx="${C}" cy="${C - 189}" r="2.6" fill="url(#${uid}brass)" stroke="none"/></g>`;
    }
    const title = cfg.title ? `<text class="ttl" x="${C}" y="${C + 62}" text-anchor="middle">${esc(cfg.title)}</text>
      <path d="M${C - 40} ${C + 70} q20 6 40 0 q20 -6 40 0" fill="none" stroke="#7a5418" stroke-width=".9"/>` : "";
    const hands = cfg.people.map((p, i) => `<g class="hand" data-i="${i}" style="transform:rotate(0deg)">
        <g filter="url(#${uid}shadow)"></g></g>`).join("");

    this.innerHTML = `
      <ha-card>
        <style>
          .wc-wrap{padding:12px 12px 8px;display:flex;flex-direction:column;align-items:center;container-type:inline-size}
          .wc-svg{width:100%;max-width:${this._cfg.maxSize};height:auto;display:block;overflow:visible}
          .lbl{font-family:"Cinzel","Trajan Pro","Palatino Linotype","Book Antiqua",Palatino,Georgia,"Times New Roman",serif;
               font-weight:700;letter-spacing:.09em;fill:#3b2408}
          .ttl{font-family:"Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;font-style:italic;font-size:17px;fill:#6b4512;opacity:.85;letter-spacing:.06em}
          .hand{transform-origin:${C}px ${C}px;transform-box:view-box;transition:transform 2.6s cubic-bezier(.45,-0.25,.3,1.35)}
          .hname{font-family:"Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;font-weight:700;font-size:13.5px;letter-spacing:.06em;fill:#fff8e4}
          .wc-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 14px;margin-top:8px;
               font-family:"Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;font-size:14px;color:var(--primary-text-color)}
          .wc-item{display:flex;align-items:center;gap:6px;white-space:nowrap}
          .wc-dot{width:11px;height:11px;border-radius:50%;box-shadow:0 0 0 1.5px #c9a04a inset,0 1px 2px rgba(0,0,0,.4)}
          .wc-pos{font-style:italic;opacity:.8}
          .wc-peril .wc-pos{color:#c62828;opacity:1;font-weight:700}
          .wc-svg.wc-lp{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
          .hands{transform-origin:${C}px ${C}px;transform-box:view-box}
          .wc-cue .hands{animation:wc-wiggle 1.1s ease-in-out}
          .wc-cue{animation:wc-glow 1.2s ease-out}
          @keyframes wc-wiggle{0%{transform:rotate(0)}20%{transform:rotate(16deg)}45%{transform:rotate(-11deg)}65%{transform:rotate(6deg)}82%{transform:rotate(-3deg)}100%{transform:rotate(0)}}
          @keyframes wc-glow{0%{filter:none}25%{filter:drop-shadow(0 0 14px rgba(255,214,120,.95))}100%{filter:none}}
          @media (prefers-reduced-motion: reduce){.hand{transition:none}.wc-cue .hands{animation:none}}
        </style>
        <div class="wc-wrap">
          <svg class="wc-svg" viewBox="-8 -8 416 416" role="img" aria-label="Weasley clock">
            <defs>${defs}</defs>
            <circle cx="${C}" cy="${C}" r="198" fill="url(#${uid}wood)" filter="url(#${uid}soft)"/>
            <circle cx="${C}" cy="${C}" r="198" fill="#000" filter="url(#${uid}grain)"/>
            <circle cx="${C}" cy="${C}" r="196" fill="none" stroke="#1d0d03" stroke-width="2"/>
            ${scroll}
            <circle cx="${C}" cy="${C}" r="176" fill="url(#${uid}brass)" stroke="#4a2f07" stroke-width="1"/>
            <circle cx="${C}" cy="${C}" r="166" fill="url(#${uid}brass2)"/>
            ${beads}
            <circle cx="${C}" cy="${C}" r="161" fill="url(#${uid}face)" stroke="#5c3d0b" stroke-width="2"/>
            <circle cx="${C}" cy="${C}" r="157" fill="none" stroke="#7a5418" stroke-width="1"/>
            ${ticks}
            <circle cx="${C}" cy="${C}" r="150" fill="none" stroke="#7a5418" stroke-width=".8"/>
            <circle cx="${C}" cy="${C}" r="112" fill="none" stroke="#7a5418" stroke-width="1.2"/>
            <circle cx="${C}" cy="${C}" r="108" fill="none" stroke="#7a5418" stroke-width=".6" stroke-dasharray="1.5 3"/>
            ${dividers}
            ${labels}
            ${title}
            <g class="hands">${hands}</g>
            <circle cx="${C}" cy="${C}" r="15" fill="url(#${uid}boss)" stroke="#4a2f07" stroke-width="1.2" filter="url(#${uid}shadow)"/>
            <circle cx="${C}" cy="${C}" r="7" fill="url(#${uid}brass2)" stroke="#4a2f07" stroke-width=".8"/>
            <circle cx="${C - 2}" cy="${C - 2}" r="2" fill="#fff6d0" opacity=".9"/>
          </svg>
          <div class="wc-legend"></div>
        </div>
      </ha-card>`;
    this._uid = uid;
    this._handEls = [...this.querySelectorAll(".hand")];
    this._legend = this.querySelector(".wc-legend");
    if (!this._cfg.legend) this._legend.style.display = "none";
    this._bindLongPress();
  }

  _handShape(p, len, flip) {
    const uid = this._uid, w = 8.5, plateStart = 40, plateEnd = len - 24;
    const y = (d) => C - d;
    // ornate spade tip + long name plate + counterweight tail
    const body = `M${C} ${y(-26)}
      C${C + 7} ${y(-24)} ${C + 8} ${y(-14)} ${C + 3} ${y(-8)}
      L${C + 3} ${y(plateStart - 6)} L${C + w} ${y(plateStart)} L${C + w} ${y(plateEnd)}
      L${C + 2.5} ${y(plateEnd + 6)} L${C + 2.5} ${y(len - 18)}
      C${C + 12} ${y(len - 18)} ${C + 13} ${y(len - 4)} ${C} ${y(len + 6)}
      C${C - 13} ${y(len - 4)} ${C - 12} ${y(len - 18)} ${C - 2.5} ${y(len - 18)}
      L${C - 2.5} ${y(plateEnd + 6)} L${C - w} ${y(plateEnd)} L${C - w} ${y(plateStart)} L${C - 3} ${y(plateStart - 6)}
      L${C - 3} ${y(-8)} C${C - 8} ${y(-14)} ${C - 7} ${y(-24)} ${C} ${y(-26)} Z`;
    const mid = (plateStart + plateEnd) / 2;
    const tx = C + (flip ? -4.3 : 4.3);
    const rot = flip ? 90 : -90;
    const name = esc(p.name.toUpperCase());
    const plateLen = plateEnd - plateStart - 6;
    return `<path d="${body}" fill="${p.color}" stroke="url(#${uid}brass)" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="${C}" cy="${y(len - 10)}" r="2.6" fill="url(#${uid}boss)"/>
      <circle cx="${C}" cy="${y(-17)}" r="3" fill="url(#${uid}boss)"/>
      <text class="hname" x="${f(tx)}" y="${f(y(mid))}" transform="rotate(${rot} ${f(tx)} ${f(y(mid))})" text-anchor="middle"
        ${name.length > 7 ? `textLength="${plateLen}" lengthAdjust="spacingAndGlyphs"` : ""}>${name}</text>`;
  }

  _update() {
    const cfg = this._cfg, n = cfg.positions.length, seg = 360 / n;
    const res = cfg.people.map((p) => this._compute(p));
    const key = JSON.stringify(res);
    if (key === this._last) return;
    this._last = key;
    const posKey = res.map((r) => r.pos).join("|");
    if (this._cfg.sounds) {
      this._audio("clockwork"); this._audio("chime"); this._armUnlock();
      if (this._prevPos !== undefined && posKey !== this._prevPos && !this._isQuiet()) this._chimeSound();
    }
    const ready = cfg.people.every((p) => this._hass.states[p.entity] || (p.tracker && this._hass.states[p.tracker]));
    this._prevPos = ready ? posKey : undefined; // states still loading: stay silent
    // group for fan-out
    const groups = {};
    res.forEach((r, i) => (groups[r.pos] = groups[r.pos] || []).push(i));
    res.forEach((r, i) => {
      const idx = Math.max(0, cfg.positions.findIndex((x) => x.name === r.pos));
      const g = groups[r.pos], k = g.indexOf(i), m = g.length;
      const spread = Math.min(16, (seg * 0.78) / Math.max(1, m - 1));
      const target = idx * seg + (k - (m - 1) / 2) * spread;
      // shortest rotation from previous angle
      const prev = this._angles[i];
      let ang = target;
      if (prev !== undefined) { ang = prev + ((((target - prev) % 360) + 540) % 360) - 180; }
      this._angles[i] = ang;
      const norm360 = ((ang % 360) + 360) % 360;
      const flip = norm360 >= 179.5; // keep names reading bottom-to-top / left-to-right
      const len = m > 1 ? 110 - (k % 2) * 24 : 110;
      const el = this._handEls[i];
      const shapeKey = `${flip}|${len}`;
      if (el.dataset.shape !== shapeKey) { el.firstElementChild.innerHTML = this._handShape(cfg.people[i], len, flip); el.dataset.shape = shapeKey; }
      el.style.transform = `rotate(${ang}deg)`;
    });
    // draw grouped hands with shorter ones on top
    this._legend.innerHTML = cfg.people.map((p, i) => {
      const r = res[i], peril = r.pos === cfg.perilPos;
      return `<div class="wc-item${peril ? " wc-peril" : ""}"><span class="wc-dot" style="background:${p.color}"></span>
        <b>${esc(p.name)}</b><span class="wc-pos">${esc(r.pos)}${r.detail && norm(r.detail) !== norm(r.pos) ? " \u00b7 " + esc(r.detail) : ""}</span></div>`;
    }).join("");
  }
}
if (!customElements.get("weasley-clock-card")) customElements.define("weasley-clock-card", WeasleyClockCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "weasley-clock-card"))
  window.customCards.push({ type: "weasley-clock-card", name: "Weasley Clock", description: "Harry Potter style family location clock", preview: false });
})();
