// ─────────────────────────────────────────────────────────────────────────────
// audio.js  –  Synthesised sound effects via Web Audio API (no audio files)
// ─────────────────────────────────────────────────────────────────────────────

const Audio = (() => {
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ── Low-level helpers ───────────────────────────────────────────────────────

  function osc(freq, type, start, dur, gainStart, gainEnd, ac) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.type      = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(gainStart, start);
    g.gain.exponentialRampToValueAtTime(Math.max(gainEnd, 0.001), start + dur);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  function noise(start, dur, gainStart, gainEnd, ac) {
    const bufSize  = ac.sampleRate * dur;
    const buffer   = ac.createBuffer(1, bufSize, ac.sampleRate);
    const data     = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const source   = ac.createBufferSource();
    source.buffer  = buffer;
    const g = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type      = 'bandpass';
    filter.frequency.value = 400;
    source.connect(filter);
    filter.connect(g);
    g.connect(ac.destination);
    g.gain.setValueAtTime(gainStart, start);
    g.gain.exponentialRampToValueAtTime(Math.max(gainEnd, 0.001), start + dur);
    source.start(start);
    source.stop(start + dur + 0.05);
  }

  // ── Public sounds ───────────────────────────────────────────────────────────

  function playPlace() {
    try {
      const ac = getCtx();
      const t  = ac.currentTime;
      osc(220, 'sine',   t,        0.12, 0.25, 0.001, ac);
      osc(330, 'sine',   t + 0.05, 0.08, 0.15, 0.001, ac);
    } catch (_) {}
  }

  function playMiss() {
    // Soft water plop
    try {
      const ac = getCtx();
      const t  = ac.currentTime;
      osc(160, 'sine',     t,        0.25, 0.3,  0.001, ac);
      osc(110, 'sine',     t + 0.08, 0.18, 0.15, 0.001, ac);
      noise(t, 0.15,  0.08, 0.001, ac);
    } catch (_) {}
  }

  function playHit() {
    // Sharp metallic thud
    try {
      const ac = getCtx();
      const t  = ac.currentTime;
      osc(80,  'sawtooth', t,        0.08, 0.6, 0.001, ac);
      osc(160, 'square',   t,        0.06, 0.4, 0.001, ac);
      noise(t, 0.20, 0.35, 0.001, ac);
      osc(60,  'sine',     t + 0.05, 0.20, 0.3, 0.001, ac);
    } catch (_) {}
  }

  function playSunk() {
    // Dramatic descending tone + explosion noise
    try {
      const ac = getCtx();
      const t  = ac.currentTime;
      const o  = ac.createOscillator();
      const g  = ac.createGain();
      o.connect(g);
      g.connect(ac.destination);
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(300, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.6);
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      o.start(t);
      o.stop(t + 0.65);
      noise(t, 0.5, 0.4, 0.001, ac);
      osc(440, 'sine', t,        0.06, 0.3, 0.001, ac);
      osc(550, 'sine', t + 0.05, 0.06, 0.25, 0.001, ac);
      osc(660, 'sine', t + 0.10, 0.06, 0.2, 0.001, ac);
    } catch (_) {}
  }

  function playWin() {
    try {
      const ac = getCtx();
      const t  = ac.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => {
        osc(f, 'sine', t + i * 0.12, 0.3, 0.4, 0.001, ac);
      });
    } catch (_) {}
  }

  function playLose() {
    try {
      const ac = getCtx();
      const t  = ac.currentTime;
      [392, 349, 294, 220].forEach((f, i) => {
        osc(f, 'sawtooth', t + i * 0.18, 0.35, 0.3, 0.001, ac);
      });
    } catch (_) {}
  }

  return { playPlace, playMiss, playHit, playSunk, playWin, playLose };
})();
