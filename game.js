(function () {
  "use strict";

  // ---------- setup ----------
  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  var W = 0, H = 0; // CSS pixel size
  var laneW = 0, laneLeft = 0, laneRight = 0;

  function computeLane() {
    laneW = Math.min(420, W - 32); // small fixed margin instead of a % cut, so narrow phones use nearly the full width
    laneLeft = W / 2 - laneW / 2;
    laneRight = W / 2 + laneW / 2;
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeLane();
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- palette ----------
  var COLORS = [
    { fill: "#ff2d95", glow: "rgba(255,45,149,0.5)", ambient: "rgba(255,45,149,0.10)", shape: "circle", name: "PINK" },
    { fill: "#2dd4ff", glow: "rgba(45,212,255,0.5)", ambient: "rgba(45,212,255,0.10)", shape: "triangle", name: "CYAN" },
    { fill: "#ffd12d", glow: "rgba(255,209,45,0.5)", ambient: "rgba(255,209,45,0.10)", shape: "square", name: "YELLOW" },
    { fill: "#4dff8f", glow: "rgba(77,255,143,0.5)", ambient: "rgba(77,255,143,0.10)", shape: "diamond", name: "GREEN" }
  ];
  var SEGMENTS = COLORS.length; // overridden per-run by the chosen difficulty
  var activePalette = [0, 1, 2, 3]; // color indices in play this run

  var DIFFICULTY_PRESETS = {
    easy: { label: "EASY", segments: 2, paletteSize: 2, moving: false, oscMul: 0 },
    normal: { label: "NORMAL", segments: 4, paletteSize: 4, moving: false, oscMul: 0 },
    hard: { label: "HARD", segments: 4, paletteSize: 4, moving: true, oscMul: 1 },
    impossible: { label: "IMPOSSIBLE", segments: 4, paletteSize: 4, moving: true, oscMul: 1.8 }
  };
  var difficulty = "normal";
  var chosenBallColor = null; // null = random each run; otherwise a fixed COLORS index

  // ---------- levels: exactly GATES_PER_LEVEL gates each, zone crossfades on level-up ----------
  var GATES_PER_LEVEL = 10;
  var ZONE_TRANSITION_DUR = 1.4;
  var ZONES = [
    { name: "NEON DUSK", top: "#0b0620", bottom: "#1a0e35", star: "255,255,255" },
    { name: "AURORA", top: "#031a17", bottom: "#0c3b2e", star: "170,255,225" },
    { name: "SUNSET RUSH", top: "#2b0a1f", bottom: "#5a1a2b", star: "255,205,160" },
    { name: "DEEP SPACE", top: "#05040f", bottom: "#140a2e", star: "195,195,255" },
    { name: "CRYSTAL VOID", top: "#031420", bottom: "#0c2b3d", star: "195,240,255" }
  ];

  function hexToRgb(hex) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function lerpColor(a, b, t, alpha) {
    var ca = hexToRgb(a), cb = hexToRgb(b);
    var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
    var g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
    var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
    if (alpha === undefined) return "rgb(" + r + "," + g + "," + bl + ")";
    return "rgba(" + r + "," + g + "," + bl + "," + alpha + ")";
  }
  function lerpTriple(aStr, bStr, t) {
    var a = aStr.split(",").map(Number), b = bStr.split(",").map(Number);
    var r = Math.round(a[0] + (b[0] - a[0]) * t);
    var g = Math.round(a[1] + (b[1] - a[1]) * t);
    var bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return r + "," + g + "," + bl;
  }
  function shade(hex, amt) {
    var c = hexToRgb(hex);
    var r = Math.max(0, Math.min(255, c[0] + amt));
    var g = Math.max(0, Math.min(255, c[1] + amt));
    var b = Math.max(0, Math.min(255, c[2] + amt));
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  function currentZoneInfo() {
    var t = Math.min(1, zoneTransT);
    return { idx: zoneIdx, t: t, zone: ZONES[zonePrevIdx], nextZone: ZONES[zoneIdx] };
  }

  // ---------- dom ----------
  var scoreEl = document.getElementById("score");
  var levelBadgeEl = document.getElementById("level-badge");
  var effectRowEl = document.getElementById("effect-row");
  var levelNumEl = document.getElementById("level-num");
  var bgLayer = document.getElementById("bg-layer");
  var startScreen = document.getElementById("start-screen");
  var overScreen = document.getElementById("gameover-screen");
  var diffButtons = document.querySelectorAll(".diff-btn");
  var colorButtons = document.querySelectorAll(".color-swatch");
  var retryBtn = document.getElementById("retry-btn");
  var menuBtn = document.getElementById("menu-btn");
  var finalScoreEl = document.getElementById("final-score");
  var finalLevelEl = document.getElementById("final-level");
  var bestScoreEl = document.getElementById("best-score");
  var bestStartEl = document.getElementById("best-start");
  var pauseBtn = document.getElementById("pause-btn");
  var muteBtn = document.getElementById("mute-btn");
  var muteSlash = document.getElementById("mute-slash");
  var pauseScreen = document.getElementById("pause-screen");
  var resumeBtn = document.getElementById("resume-btn");
  var neededRow = document.getElementById("needed-row");
  var neededSwatch = document.getElementById("needed-swatch");
  var neededLabel = document.getElementById("needed-label");

  var BEST_KEY = "prismleap_best";
  var best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0;
  bestStartEl.textContent = best;

  // ---------- audio (procedural, no files) ----------
  var actx = null;
  var masterGain = null;
  var muted = false;
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = actx.createGain();
      masterGain.gain.value = muted ? 0 : 1;
      masterGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function setMuted(m) {
    muted = m;
    if (masterGain) masterGain.gain.value = muted ? 0 : 1;
  }
  function tone(freq, dur, type, peak, delay) {
    if (!actx) return;
    var t0 = actx.currentTime + (delay || 0);
    var osc = actx.createOscillator();
    var gain = actx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak || 0.2, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  function sweep(freqFrom, freqTo, dur, type, peak, delay) {
    if (!actx) return;
    var t0 = actx.currentTime + (delay || 0);
    var osc = actx.createOscillator();
    var gain = actx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freqFrom, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak || 0.2, t0 + Math.min(0.05, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  // shared key for every sound in the game: A minor pentatonic (A C D E G)
  var SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33];
  function playPass(streak) {
    tone(SCALE[Math.min(SCALE.length - 1, streak % SCALE.length)], 0.18, "triangle", 0.15);
  }
  function playStart() {
    sweep(180, 720, 0.35, "sawtooth", 0.1);
    tone(SCALE[4], 0.12, "triangle", 0.14, 0.28);
    tone(SCALE[5], 0.12, "triangle", 0.15, 0.34);
    tone(SCALE[7], 0.32, "triangle", 0.18, 0.4);
  }
  function playDie() {
    sweep(260, 60, 0.18, "square", 0.22);
    tone(293.66, 0.22, "sine", 0.16, 0.05);
    tone(220.00, 0.55, "sine", 0.14, 0.15);
  }
  function playClick() {
    tone(587.33, 0.08, "triangle", 0.09);
  }
  function playMiss() {
    tone(196.00, 0.16, "square", 0.13);
    tone(164.81, 0.2, "square", 0.1, 0.06);
  }
  function playPowerup() {
    tone(SCALE[3], 0.1, "sine", 0.14);
    tone(SCALE[5], 0.1, "sine", 0.15, 0.07);
    tone(SCALE[7], 0.22, "sine", 0.17, 0.14);
  }
  function playShieldHit() {
    tone(440.00, 0.1, "triangle", 0.15);
    tone(329.63, 0.18, "triangle", 0.12, 0.05);
  }
  function playLevelUp() {
    tone(392.00, 0.13, "triangle", 0.15);
    tone(523.25, 0.13, "triangle", 0.15, 0.08);
    tone(659.25, 0.3, "triangle", 0.17, 0.16);
  }
  function playFanfare() {
    var run = [SCALE[0], SCALE[2], SCALE[4], SCALE[5], SCALE[6], SCALE[7]];
    for (var i = 0; i < run.length; i++) {
      tone(run[i], 0.28, "triangle", 0.17, i * 0.09);
      tone(run[i] * 2, 0.22, "sine", 0.07, i * 0.09 + 0.02);
    }
    var chordAt = run.length * 0.09 + 0.06;
    tone(SCALE[0] * 2, 0.7, "triangle", 0.15, chordAt);
    tone(SCALE[4], 0.7, "triangle", 0.13, chordAt);
    tone(SCALE[7], 0.7, "triangle", 0.15, chordAt);
  }
  function playFirework() {
    var f = 700 + Math.random() * 500;
    tone(f, 0.16, "triangle", 0.11);
    tone(f * 1.5, 0.14, "sine", 0.07, 0.03);
  }

  // ---------- background music (looping procedural sequencer, speeds up with level) ----------
  var musicOn = false, musicTimer = null, nextNoteTime = 0, stepIndex = 0;
  var currentLevel = 1;
  var BASS_NOTES = [110.00, 110.00, 146.83, 130.81]; // A2 A2 D3 C3
  var ARP_SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
  var ARP_PATTERNS = [
    [0, 3, 2, 3, 1, 3, 2, 4, 0, 3, 2, 3, 4, 3, 2, 1],
    [0, 4, 2, 5, 3, 4, 1, 5, 0, 4, 2, 6, 3, 5, 1, 4]
  ];

  function musicStepDur() {
    return Math.max(0.11, 0.24 - (currentLevel - 1) * 0.013);
  }
  function musicPattern() {
    return ARP_PATTERNS[currentLevel >= 3 ? 1 : 0];
  }
  function scheduleNote(freq, time, dur, type, peak) {
    if (!actx) return;
    var osc = actx.createOscillator();
    var gain = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }
  function scheduleTick(time) {
    if (!actx) return;
    var osc = actx.createOscillator();
    var gain = actx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(1700, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.016, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.03);
    osc.connect(gain).connect(masterGain);
    osc.start(time);
    osc.stop(time + 0.04);
  }
  function musicScheduler() {
    if (!actx || !musicOn) return;
    while (nextNoteTime < actx.currentTime + 0.15) {
      var pattern = musicPattern();
      var dur = musicStepDur();
      var step = stepIndex % pattern.length;
      scheduleNote(ARP_SCALE[pattern[step]], nextNoteTime, dur * 0.9, "sine", 0.032);
      if (step % 2 === 1) scheduleTick(nextNoteTime);
      if (step % 4 === 0) {
        scheduleNote(BASS_NOTES[(step / 4) | 0], nextNoteTime, dur * 3.6, "triangle", 0.035);
      }
      nextNoteTime += dur;
      stepIndex++;
    }
  }
  function startMusic() {
    if (!actx || musicOn) return;
    musicOn = true;
    stepIndex = 0;
    nextNoteTime = actx.currentTime + 0.05;
    musicScheduler();
    musicTimer = setInterval(musicScheduler, 100);
  }
  function stopMusic() {
    musicOn = false;
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  // ---------- game constants ----------
  var BALL_R = 15;
  var CLIMB_BASE = 150;
  var CLIMB_BONUS_MAX = 110;
  var GATE_GAP_BASE = 230;
  var GATE_GAP_MIN_CUT = 25;
  var GATE_H = 26;
  var KEY_SPEED = 1400;
  var BALL_SCREEN_Y_RATIO = 0.6;
  var HIT_STOP_DUR = 0.08;
  var PUNCH_DECAY = 5;
  var STAR_COUNT = 70;
  var STAR_BAND = 1300;

  // ---------- state ----------
  var state = "start"; // start | playing | dead
  var ball, gates = [], particles = [], floatTexts = [], camY = 0, score = 0, lastTime, spawnCursorY, spawnedCount;
  var moveDir = 0;
  var shake = 0, flash = 0, punch = 0, hitstop = 0, elapsed = 0;
  var paused = false;
  var lastMissColor = 0;
  var flashColor = "255,45,60";
  var timeScale = 1;
  var shockwaves = [];
  var gatesPassed = 0;
  var zoneIdx = 0, zonePrevIdx = 0, zoneTransT = 1;

  // ---------- power-ups ----------
  var POWERUP_TYPES = {
    shield: { color: "#ffe066", label: "SHIELD" },
    slow: { color: "#7ec8ff", label: "SLOW" },
    rush: { color: "#ff6a3d", label: "RUSH" },
    magnet: { color: "#b26dff", label: "MAGNET" }
  };
  var POWERUP_ORDER = ["shield", "slow", "rush", "magnet"];
  var powerups = [];
  var shieldCharges = 0;
  var effectTimers = { slow: 0, rush: 0, magnet: 0 };
  var stars = [];
  var bokeh = [];
  var BOKEH_COUNT = 6;

  for (var si = 0; si < STAR_COUNT; si++) {
    stars.push({
      x: Math.random(),
      y0: Math.random() * STAR_BAND,
      r: Math.random() * 1.6 + 0.4,
      layer: Math.random(),
      tw: Math.random() * Math.PI * 2
    });
  }
  for (var bi = 0; bi < BOKEH_COUNT; bi++) {
    bokeh.push({
      x: Math.random(),
      y0: Math.random() * STAR_BAND,
      r: 70 + Math.random() * 110,
      layer: Math.random()
    });
  }

  function resetGame() {
    var preset = DIFFICULTY_PRESETS[difficulty];
    SEGMENTS = preset.segments;
    var pool = [0, 1, 2, 3];
    for (var i = pool.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    activePalette = pool.slice(0, preset.paletteSize);
    if (chosenBallColor !== null && activePalette.indexOf(chosenBallColor) === -1) {
      activePalette[0] = chosenBallColor;
    }

    ball = {
      x: W / 2,
      y: 0,
      targetX: W / 2,
      color: chosenBallColor !== null ? chosenBallColor : activePalette[(Math.random() * activePalette.length) | 0],
      trail: [],
      spin: 0,
      spawnT: 0
    };
    gates = [];
    particles = [];
    floatTexts = [];
    powerups = [];
    shieldCharges = 0;
    effectTimers = { slow: 0, rush: 0, magnet: 0 };
    score = 0;
    spawnedCount = 0;
    shake = 0; flash = 0; punch = 0; hitstop = 0;
    gatesPassed = 0;
    zoneIdx = 0; zonePrevIdx = 0; zoneTransT = 1;
    currentLevel = 1;
    stepIndex = 0;
    scoreEl.textContent = "0";
    camY = ball.y - H * BALL_SCREEN_Y_RATIO;
    spawnCursorY = -GATE_GAP_BASE * 1.1;
    updateShieldBadge();
    for (var i = 0; i < 6; i++) spawnGate();
  }

  function difficultyT() {
    return Math.min(1, spawnedCount / 35);
  }

  function randomPaletteColor() {
    return activePalette[(Math.random() * activePalette.length) | 0];
  }

  function spawnGate() {
    var t = difficultyT();
    var preset = DIFFICULTY_PRESETS[difficulty];

    var blocks = [];
    for (var s = 0; s < SEGMENTS; s++) blocks.push(randomPaletteColor());
    var matchSlot = (Math.random() * SEGMENTS) | 0;
    for (var k = 0; k < SEGMENTS; k++) {
      if (k !== matchSlot && blocks[k] === ball.color) {
        var guard = 0;
        do { blocks[k] = randomPaletteColor(); guard++; } while (blocks[k] === ball.color && guard < 10);
      }
    }
    blocks[matchSlot] = ball.color; // exactly one matching segment per gate, always, always equal width

    var moving = preset.moving;
    var gateW = moving ? laneW * 0.68 : laneW;

    var gap = GATE_GAP_BASE - t * GATE_GAP_MIN_CUT;
    var thisGateY = spawnCursorY;

    gates.push({
      y: thisGateY,
      blocks: blocks,
      passed: false,
      pulse: 0,
      moving: moving,
      gateW: gateW,
      phase: Math.random() * Math.PI * 2,
      oscSpeed: (0.6 + t * 0.9) * preset.oscMul
    });
    spawnedCount++;
    spawnCursorY -= gap;

    // roughly 1 in 4 gaps gets a power-up, always dead-centered between the two
    // gates it sits between so grabbing it never conflicts with either one's color
    if (spawnedCount > 3 && Math.random() < 0.25) {
      var type = POWERUP_ORDER[(Math.random() * POWERUP_ORDER.length) | 0];
      var margin = laneLeft + 26;
      var x = margin + Math.random() * (laneRight - 26 - margin);
      powerups.push({ x: x, y: thisGateY - gap / 2, type: type, collected: false, bobT: Math.random() * Math.PI * 2 });
    }
  }

  function gateGeometry(gate) {
    var w = gate.gateW / SEGMENTS;
    if (!gate.moving) return { left: laneLeft, w: w };
    var amp = (laneW - gate.gateW) / 2 * 0.92;
    var off = Math.sin(elapsed * gate.oscSpeed + gate.phase) * amp;
    return { left: laneLeft + (laneW - gate.gateW) / 2 + off, w: w };
  }

  function blockColorAt(gate, x) {
    var geo = gateGeometry(gate);
    var idx = Math.floor((x - geo.left) / geo.w);
    if (idx < 0) idx = 0;
    if (idx >= SEGMENTS) idx = SEGMENTS - 1;
    return gate.blocks[idx];
  }

  function spawnParticles(x, y, color, count, power) {
    for (var i = 0; i < count; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.5 + Math.random()) * power;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.4,
        t: 0,
        color: color,
        r: 2 + Math.random() * 3
      });
    }
  }

  function spawnShockwave(x, y, color, maxR, life) {
    shockwaves.push({ x: x, y: y, color: color, maxR: maxR, life: life, t: 0 });
  }

  function spawnFloatText(x, y, text, color, size) {
    var life = size === "huge" ? 1.3 : 0.85;
    floatTexts.push({ x: x, y: y, text: text, color: color, t: 0, life: life, size: size || "normal" });
  }

  function bumpScorePop() {
    scoreEl.classList.remove("pop");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("pop");
  }

  function bumpLevelPop() {
    levelBadgeEl.classList.remove("pop");
    void levelBadgeEl.offsetWidth;
    levelBadgeEl.classList.add("pop");
  }

  function updateShieldBadge() {
    updateEffectBadges();
  }

  function updateEffectBadges() {
    var chips = [];
    if (shieldCharges > 0) chips.push({ text: "SHIELD x" + shieldCharges, color: POWERUP_TYPES.shield.color });
    if (effectTimers.slow > 0) chips.push({ text: "SLOW " + Math.ceil(effectTimers.slow) + "s", color: POWERUP_TYPES.slow.color });
    if (effectTimers.rush > 0) chips.push({ text: "RUSH " + Math.ceil(effectTimers.rush) + "s", color: POWERUP_TYPES.rush.color });
    if (effectTimers.magnet > 0) chips.push({ text: "MAGNET " + Math.ceil(effectTimers.magnet) + "s", color: POWERUP_TYPES.magnet.color });
    effectRowEl.innerHTML = "";
    for (var i = 0; i < chips.length; i++) {
      var el = document.createElement("div");
      el.className = "effect-chip";
      el.style.setProperty("--sc", chips[i].color);
      el.textContent = chips[i].text;
      effectRowEl.appendChild(el);
    }
  }

  function beginPlaying(chosenDifficulty) {
    if (chosenDifficulty) difficulty = chosenDifficulty;
    ensureAudio();
    startScreen.classList.add("hidden");
    overScreen.classList.add("hidden");
    scoreEl.classList.add("visible");
    levelBadgeEl.classList.add("visible");
    levelNumEl.textContent = "1";
    state = "playing";
    resetGame();
    startMusic();
    canvas.style.cursor = "none";
    bgLayer.classList.remove("bg-menu");
    bgLayer.classList.add("bg-play");

    playStart();
    punch = 1;
    flashColor = hexToRgb(COLORS[ball.color].fill).join(",");
    flash = 0.8;
    spawnShockwave(W / 2, H * BALL_SCREEN_Y_RATIO, COLORS[ball.color].fill, Math.max(W, H) * 0.7, 0.7);
    spawnShockwave(W / 2, H * BALL_SCREEN_Y_RATIO, "#ffffff", Math.max(W, H) * 0.5, 0.5);
  }

  function onPrimaryAction() {
    if (state === "start") beginPlaying();
  }

  function returnToMenu() {
    state = "start";
    overScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");
    canvas.style.cursor = "default";
  }

  function triggerGrandCelebration() {
    spawnFloatText(W / 2, H * 0.16, "LEVEL " + currentLevel, "#ffffff", "huge");
    spawnFloatText(W / 2, H * 0.27, "MILESTONE REACHED", COLORS[ball.color].fill, "big");
    punch = 1;
    shake = Math.max(shake, 1.3);
    hitstop = Math.max(hitstop, 0.1);
    playFanfare();
    var bursts = 7;
    for (var i = 0; i < bursts; i++) {
      (function (idx) {
        setTimeout(function () {
          var fx = W * (0.14 + Math.random() * 0.72);
          var fy = H * (0.12 + Math.random() * 0.4);
          var col = COLORS[(Math.random() * COLORS.length) | 0].fill;
          spawnParticles(fx, fy, col, 26, 250);
          spawnShockwave(fx, fy, col, 95, 0.55);
          playFirework();
        }, idx * 160);
      })(i);
    }
  }

  function triggerLevelUp() {
    zonePrevIdx = zoneIdx;
    zoneIdx = (zoneIdx + 1) % ZONES.length;
    zoneTransT = 0;
    currentLevel++;
    levelNumEl.textContent = currentLevel;
    bumpLevelPop();
    punch = Math.min(1, punch + 0.5);

    if (currentLevel % 10 === 0) {
      triggerGrandCelebration();
    } else {
      spawnFloatText(W / 2, H * 0.2, "LEVEL " + currentLevel, "#ffffff", "big");
      playLevelUp();
    }
  }

  function onPassGate(g) {
    g.passed = true;
    score++;
    gatesPassed++;
    scoreEl.textContent = score;
    bumpScorePop();
    g.pulse = 1;
    punch = Math.min(1, punch + 0.5);
    spawnParticles(ball.x, screenYOf(g.y), COLORS[ball.color].fill, 12, 150);
    spawnFloatText(ball.x, screenYOf(g.y), "+1", COLORS[ball.color].fill, "normal");
    playPass(score);
    vibrate(12);
    if (score > 0 && score % 5 === 0) {
      spawnFloatText(W / 2, H * 0.28, score + " STREAK", "#ffffff", "big");
      hitstop = Math.max(hitstop, 0.035);
    }
    if (gatesPassed % GATES_PER_LEVEL === 0) {
      triggerLevelUp();
    }
  }

  function onMissPlatform(g) {
    score = Math.max(0, score - 1);
    scoreEl.textContent = score;
    bumpScorePop();
    shake = Math.max(shake, 0.4);
    spawnParticles(ball.x, screenYOf(g.y), "#ff5566", 8, 90);
    spawnFloatText(ball.x, screenYOf(g.y), "MISSED  -1", "#ff5566", "normal");
    playMiss();
    vibrate(20);
  }

  function onShieldAbsorb(g) {
    shieldCharges--;
    updateShieldBadge();
    shake = Math.max(shake, 0.6);
    flashColor = hexToRgb(POWERUP_TYPES.shield.color).join(",");
    flash = Math.max(flash, 0.5);
    spawnParticles(ball.x, screenYOf(g.y), POWERUP_TYPES.shield.color, 16, 200);
    spawnShockwave(ball.x, screenYOf(g.y), POWERUP_TYPES.shield.color, 60, 0.4);
    spawnFloatText(ball.x, screenYOf(g.y), "SHIELD  " + shieldCharges, POWERUP_TYPES.shield.color, "normal");
    playShieldHit();
    vibrate(30);
  }

  function collectPowerup(type, x, y) {
    var c = POWERUP_TYPES[type];
    spawnParticles(x, y, c.color, 18, 180);
    spawnShockwave(x, y, c.color, 70, 0.45);
    spawnFloatText(x, y, c.label, c.color, "normal");
    punch = Math.min(1, punch + 0.35);
    playPowerup();
    vibrate(15);

    if (type === "shield") {
      shieldCharges = Math.min(5, shieldCharges + 3);
      updateShieldBadge();
    } else if (type === "slow") {
      effectTimers.slow = 6;
      effectTimers.rush = 0;
    } else if (type === "rush") {
      effectTimers.rush = 6;
      effectTimers.slow = 0;
    } else if (type === "magnet") {
      effectTimers.magnet = 5;
    }
    updateEffectBadges();
  }

  function die() {
    if (state !== "playing") return;
    state = "dead";
    effectRowEl.innerHTML = "";
    hitstop = HIT_STOP_DUR;
    timeScale = 0.2;
    shake = 1.8;
    flashColor = "255,45,60";
    flash = 1;
    var dx = ball.x, dy = screenYOf(ball.y);
    spawnParticles(dx, dy, COLORS[ball.color].fill, 42, 380);
    spawnShockwave(dx, dy, COLORS[ball.color].fill, Math.max(W, H) * 0.55, 0.55);
    spawnShockwave(dx, dy, "#ff2d3c", Math.max(W, H) * 0.8, 0.75);
    canvas.style.cursor = "default";
    bgLayer.classList.remove("bg-play");
    bgLayer.classList.add("bg-menu");
    stopMusic();
    playDie();
    vibrate([15, 40, 15]);
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
    }
    setTimeout(function () {
      finalScoreEl.textContent = score;
      finalLevelEl.textContent = currentLevel;
      bestScoreEl.textContent = best;
      var missC = COLORS[lastMissColor];
      neededSwatch.style.background = missC.fill;
      neededSwatch.style.color = missC.fill;
      neededLabel.textContent = missC.name;
      neededRow.classList.remove("hidden");
      overScreen.classList.remove("hidden");
      scoreEl.classList.remove("visible");
      levelBadgeEl.classList.remove("visible");
    }, 1100);
  }

  for (var dbi = 0; dbi < diffButtons.length; dbi++) {
    diffButtons[dbi].addEventListener("click", function (e) {
      beginPlaying(e.currentTarget.getAttribute("data-diff"));
    });
  }
  for (var cbi = 0; cbi < colorButtons.length; cbi++) {
    colorButtons[cbi].addEventListener("click", function (e) {
      var val = e.currentTarget.getAttribute("data-color");
      chosenBallColor = val === "random" ? null : parseInt(val, 10);
      for (var k = 0; k < colorButtons.length; k++) colorButtons[k].classList.remove("selected");
      e.currentTarget.classList.add("selected");
    });
  }
  retryBtn.addEventListener("click", function () { beginPlaying(); });
  menuBtn.addEventListener("click", returnToMenu);

  function openPause() {
    if (state !== "playing" || paused) return;
    paused = true;
    stopMusic();
    pauseScreen.classList.remove("hidden");
  }
  function closePause() {
    if (!paused) return;
    paused = false;
    pauseScreen.classList.add("hidden");
    lastTime = null;
    if (state === "playing") startMusic();
  }
  pauseBtn.addEventListener("click", function () { ensureAudio(); openPause(); });
  resumeBtn.addEventListener("click", closePause);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) openPause();
  });

  muteBtn.addEventListener("click", function () {
    ensureAudio();
    setMuted(!muted);
    muteSlash.style.display = muted ? "block" : "none";
  });

  function pointerToX(clientX) {
    var rect = canvas.getBoundingClientRect();
    var frac = (clientX - rect.left) / rect.width;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return laneLeft + frac * laneW; // full window width maps to the full lane, edge to edge
  }

  canvas.addEventListener("pointerdown", function (e) {
    ensureAudio();
    if (ball) ball.targetX = pointerToX(e.clientX);
    onPrimaryAction();
  });
  window.addEventListener("pointermove", function (e) {
    if (!ball) return;
    ball.targetX = pointerToX(e.clientX);
  });

  window.addEventListener("keydown", function (e) {
    if (e.code === "Escape") {
      if (paused) closePause(); else openPause();
      return;
    }
    if (e.code === "KeyP") { if (paused) closePause(); else openPause(); return; }
    if (e.code === "ArrowLeft" || e.code === "KeyA") { moveDir = -1; }
    else if (e.code === "ArrowRight" || e.code === "KeyD") { moveDir = 1; }
    else if (e.code === "Space") {
      e.preventDefault();
      ensureAudio();
      if (paused) { closePause(); return; }
      onPrimaryAction();
    }
  });
  window.addEventListener("keyup", function (e) {
    if ((e.code === "ArrowLeft" || e.code === "KeyA") && moveDir === -1) moveDir = 0;
    else if ((e.code === "ArrowRight" || e.code === "KeyD") && moveDir === 1) moveDir = 0;
  });

  // ---------- helpers ----------
  function screenYOf(worldY) {
    return worldY - camY; // camY already bakes in the H*BALL_SCREEN_Y_RATIO offset, don't add it twice
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // draws a small shape glyph per color, on top of the fill, so the game
  // never relies on hue alone to tell segments apart (colorblind support)
  function drawShapeIcon(shape, cx, cy, r) {
    r = Math.max(0.5, Math.abs(r));
    ctx.beginPath();
    if (shape === "circle") {
      ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    } else if (shape === "triangle") {
      ctx.moveTo(cx, cy - r * 0.6);
      ctx.lineTo(cx + r * 0.55, cy + r * 0.4);
      ctx.lineTo(cx - r * 0.55, cy + r * 0.4);
      ctx.closePath();
    } else if (shape === "square") {
      var s = r * 0.45;
      ctx.rect(cx - s, cy - s, s * 2, s * 2);
    } else if (shape === "diamond") {
      ctx.moveTo(cx, cy - r * 0.6);
      ctx.lineTo(cx + r * 0.5, cy);
      ctx.lineTo(cx, cy + r * 0.6);
      ctx.lineTo(cx - r * 0.5, cy);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  // ---------- update ----------
  function updateFx(dt) {
    var sdt = dt * timeScale; // debris/particles drift in slow-motion right after a death impact
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.t += sdt;
      pt.x += pt.vx * sdt;
      pt.y += pt.vy * sdt;
      pt.vy += 700 * sdt;
      if (pt.t > pt.life) particles.splice(p, 1);
    }
    for (var f = floatTexts.length - 1; f >= 0; f--) {
      var ft = floatTexts[f];
      ft.t += sdt;
      if (ft.t > ft.life) floatTexts.splice(f, 1);
    }
    for (var w = shockwaves.length - 1; w >= 0; w--) {
      var sw = shockwaves[w];
      sw.t += dt;
      if (sw.t > sw.life) shockwaves.splice(w, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - dt * 3);
    if (flash > 0) flash = Math.max(0, flash - dt * 2.5);
    if (punch > 0) punch = Math.max(0, punch - dt * PUNCH_DECAY);
    if (timeScale < 1) timeScale = Math.min(1, timeScale + dt * 2.2);
  }

  function update(dt) {
    if (paused) return;
    elapsed += dt;

    if (hitstop > 0) {
      hitstop -= dt;
      updateFx(dt);
      return;
    }

    if (state !== "playing") {
      updateFx(dt);
      return;
    }

    var prevY = ball.y;
    var speedMul = 1;
    if (effectTimers.rush > 0) speedMul = 1.5;
    else if (effectTimers.slow > 0) speedMul = 0.6;
    var climb = (CLIMB_BASE + Math.min(CLIMB_BONUS_MAX, score * 4)) * speedMul;
    ball.y -= climb * dt;
    camY = ball.y - H * BALL_SCREEN_Y_RATIO;

    for (var ek in effectTimers) {
      if (effectTimers[ek] > 0) effectTimers[ek] = Math.max(0, effectTimers[ek] - dt);
    }
    updateEffectBadges();

    if (zoneTransT < 1) zoneTransT = Math.min(1, zoneTransT + dt / ZONE_TRANSITION_DUR);

    if (moveDir !== 0) ball.targetX += moveDir * KEY_SPEED * dt;
    var minX = laneLeft + BALL_R + 4, maxX = laneRight - BALL_R - 4;
    if (ball.targetX < minX) ball.targetX = minX;
    if (ball.targetX > maxX) ball.targetX = maxX;

    if (effectTimers.magnet > 0) {
      var mg = null;
      for (var mi = 0; mi < gates.length; mi++) { if (!gates[mi].passed) { mg = gates[mi]; break; } }
      if (mg) {
        var mgeo = gateGeometry(mg);
        var targetIdx = mg.blocks.indexOf(ball.color);
        if (targetIdx === -1) targetIdx = 0;
        var segCenterX = mgeo.left + mgeo.w * (targetIdx + 0.5);
        ball.targetX += (segCenterX - ball.targetX) * Math.min(1, dt * 3);
      }
    }

    var prevX = ball.x;
    ball.x = ball.targetX; // direct 1:1 tracking, no lag behind the pointer
    ball.spin += dt * (2.2 + Math.abs(ball.x - prevX) * 0.18);
    if (ball.spawnT < 1) ball.spawnT = Math.min(1, ball.spawnT + dt / 0.35);

    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > 10) ball.trail.shift();

    for (var i = 0; i < gates.length; i++) {
      var g = gates[i];
      if (g.pulse > 0) g.pulse = Math.max(0, g.pulse - dt * 3);

      if (!g.passed && prevY > g.y && ball.y <= g.y) {
        var geo = gateGeometry(g);
        var onPlatform = ball.x >= geo.left && ball.x <= geo.left + g.gateW;
        if (!onPlatform) {
          g.passed = true;
          onMissPlatform(g);
        } else {
          var col = blockColorAt(g, ball.x);
          if (col === ball.color) {
            onPassGate(g);
          } else if (shieldCharges > 0) {
            g.passed = true;
            onShieldAbsorb(g);
          } else {
            lastMissColor = ball.color;
            die();
            break;
          }
        }
      }
    }

    for (var pi = powerups.length - 1; pi >= 0; pi--) {
      var pu = powerups[pi];
      pu.bobT += dt;
      if (!pu.collected && Math.abs(ball.y - pu.y) < 30 && Math.abs(ball.x - pu.x) < 32) {
        pu.collected = true;
        collectPowerup(pu.type, pu.x, screenYOf(pu.y));
      }
      if (pu.collected || pu.y > camY + H + 200) powerups.splice(pi, 1);
    }

    while (gates.length && gates[0].y > camY + H + 200) gates.shift();
    while (spawnCursorY > camY - H) spawnGate();

    updateFx(dt);
  }

  // ---------- draw ----------
  function nextGateY() {
    for (var i = 0; i < gates.length; i++) if (!gates[i].passed) return gates[i].y;
    return null;
  }

  function drawBackground(zi) {
    var bgAlpha = state === "playing" ? 0.88 : 0.7;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, lerpColor(zi.zone.top, zi.nextZone.top, zi.t, bgAlpha));
    g.addColorStop(1, lerpColor(zi.zone.bottom, zi.nextZone.bottom, zi.t, bgAlpha));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    if (ball) {
      var c = COLORS[ball.color];
      var pulse = 0.55 + 0.45 * Math.sin(elapsed * 1.1);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var glow = ctx.createRadialGradient(W / 2, H * 0.4, 10, W / 2, H * 0.4, Math.max(W, H) * (0.55 + pulse * 0.12));
      glow.addColorStop(0, c.ambient);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    var laneGrad = ctx.createLinearGradient(laneLeft, 0, laneRight, 0);
    laneGrad.addColorStop(0, "rgba(255,255,255,0.02)");
    laneGrad.addColorStop(0.5, "rgba(255,255,255,0.06)");
    laneGrad.addColorStop(1, "rgba(255,255,255,0.02)");
    ctx.fillStyle = laneGrad;
    ctx.fillRect(laneLeft, 0, laneW, H);
  }

  function drawBokeh(zi) {
    var tint = lerpTriple(zi.zone.star, zi.nextZone.star, zi.t);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < bokeh.length; i++) {
      var b = bokeh[i];
      var parallax = 0.12 + b.layer * 0.3;
      var wy = ((b.y0 - camY * parallax) % STAR_BAND + STAR_BAND) % STAR_BAND;
      var sy = wy - STAR_BAND * 0.5 + H * 0.5;
      var sx = b.x * W;
      var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, b.r);
      g.addColorStop(0, "rgba(" + tint + ",0.03)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(sx, sy, b.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawStars(zi) {
    var tint = lerpTriple(zi.zone.star, zi.nextZone.star, zi.t);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var parallax = 0.25 + s.layer * 0.55;
      var wy = ((s.y0 - camY * parallax) % STAR_BAND + STAR_BAND) % STAR_BAND;
      var sy = wy - STAR_BAND * 0.5 + H * 0.5;
      var tw = 0.35 + 0.55 * Math.abs(Math.sin(elapsed * (0.8 + s.layer) + s.tw));
      ctx.beginPath();
      ctx.arc(s.x * W, sy, s.r + s.layer * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + tint + "," + (tw * (0.25 + s.layer * 0.4)) + ")";
      ctx.fill();
    }
  }

  function drawGate(gate) {
    var sy = screenYOf(gate.y);
    if (sy < -40 || sy > H + 40) return;
    var geo = gateGeometry(gate);
    var gLeft = geo.left, w = geo.w, gW = gate.gateW;
    var isNext = !gate.passed && nextGateY() === gate.y;
    var highlight = isNext ? (0.5 + 0.5 * Math.sin(elapsed * 5)) : 0;
    var scaleY = 1 + gate.pulse * 0.35;
    var h = GATE_H * scaleY;

    if (ball && isNext) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      roundRectPath(gLeft - 12, sy - h / 2 - 12, gW + 24, h + 24, 20);
      ctx.fillStyle = COLORS[ball.color].ambient;
      ctx.fill();
      ctx.restore();
    }

    if (isNext) {
      ctx.save();
      roundRectPath(gLeft - 4, sy - h / 2 - 4, gW + 8, h + 8, 14);
      ctx.strokeStyle = "rgba(255,255,255," + (0.15 + highlight * 0.35) + ")";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    roundRectPath(gLeft, sy - h / 2, gW, h, 12);
    ctx.clip();

    for (var s = 0; s < SEGMENTS; s++) {
      var bx = gLeft + s * w;
      ctx.fillStyle = COLORS[gate.blocks[s]].fill;
      ctx.globalAlpha = gate.passed ? 0.22 : 0.95;
      ctx.fillRect(bx, sy - h / 2, w + 0.5, h);
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    for (var si = 0; si < SEGMENTS; si++) {
      drawShapeIcon(COLORS[gate.blocks[si]].shape, gLeft + si * w + w / 2, sy, Math.min(h, w) * 0.7);
    }
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1.5;
    for (var d = 1; d < SEGMENTS; d++) {
      var dx = gLeft + d * w;
      ctx.beginPath();
      ctx.moveTo(dx, sy - h / 2);
      ctx.lineTo(dx, sy + h / 2);
      ctx.stroke();
    }
    ctx.globalAlpha = gate.passed ? 0.22 : 0.35;
    var sheen = ctx.createLinearGradient(0, sy - h / 2, 0, sy + h / 2);
    sheen.addColorStop(0, "rgba(255,255,255,0.35)");
    sheen.addColorStop(0.4, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(gLeft, sy - h / 2, gW, h);
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.save();
    roundRectPath(gLeft, sy - h / 2, gW, h, 12);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function drawBall() {
    var sx = ball.x;
    var sy = screenYOf(ball.y);
    var c = COLORS[ball.color];
    var R = ball.spawnT >= 1 ? BALL_R : BALL_R * Math.max(0, easeOutBack(ball.spawnT));

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    for (var i = 0; i < ball.trail.length; i++) {
      var tp = ball.trail[i];
      var ty = screenYOf(tp.y);
      var f = i / ball.trail.length;
      ctx.beginPath();
      ctx.arc(tp.x, ty, R * (0.3 + 0.55 * f), 0, Math.PI * 2);
      ctx.fillStyle = c.fill;
      ctx.globalAlpha = f * 0.22;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    var glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, R * 3.6);
    glow.addColorStop(0, c.glow);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.arc(sx, sy, R * 3.6, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();

    var body = ctx.createRadialGradient(
      sx - R * 0.35, sy - R * 0.4, R * 0.1,
      sx, sy, R * 1.15
    );
    body.addColorStop(0, "#ffffff");
    body.addColorStop(0.22, c.fill);
    body.addColorStop(1, shade(c.fill, -55));
    ctx.beginPath();
    ctx.arc(sx, sy, R, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    var hx = sx + Math.cos(ball.spin) * R * 0.3 - R * 0.1;
    var hy = sy + Math.sin(ball.spin) * R * 0.3 - R * 0.12;
    ctx.beginPath();
    ctx.arc(hx, hy, R * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1;
    drawShapeIcon(c.shape, sx, sy, R * 1.15);
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = Math.max(0, 1 - p.t / p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawShockwaves() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < shockwaves.length; i++) {
      var sw = shockwaves[i];
      var f = sw.t / sw.life;
      var a = Math.max(0, 1 - f);
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.maxR * f, 0, Math.PI * 2);
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3 + (1 - f) * 5;
      ctx.globalAlpha = a;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPowerupGlyph(type, cx, cy, r) {
    r = Math.max(0.5, Math.abs(r));
    ctx.beginPath();
    if (type === "shield") {
      var pts = 6;
      for (var i = 0; i <= pts; i++) {
        var a = -Math.PI / 2 + (i / pts) * Math.PI * 2;
        var px = cx + Math.cos(a) * r * 0.55, py = cy + Math.sin(a) * r * 0.55;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (type === "slow") {
      ctx.moveTo(cx - r * 0.4, cy - r * 0.35);
      ctx.lineTo(cx + r * 0.4, cy - r * 0.35);
      ctx.lineTo(cx, cy + r * 0.45);
      ctx.closePath();
    } else if (type === "rush") {
      ctx.moveTo(cx + r * 0.12, cy - r * 0.55);
      ctx.lineTo(cx - r * 0.4, cy + r * 0.08);
      ctx.lineTo(cx - r * 0.05, cy + r * 0.08);
      ctx.lineTo(cx - r * 0.12, cy + r * 0.55);
      ctx.lineTo(cx + r * 0.4, cy - r * 0.12);
      ctx.lineTo(cx + r * 0.08, cy - r * 0.12);
      ctx.closePath();
    } else if (type === "magnet") {
      ctx.arc(cx, cy - r * 0.05, r * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.lineWidth = r * 0.32;
      ctx.stroke();
      return;
    }
    ctx.fill();
  }

  function drawPowerups(zi) {
    ctx.save();
    for (var i = 0; i < powerups.length; i++) {
      var pu = powerups[i];
      if (pu.collected) continue;
      var sy = screenYOf(pu.y);
      if (sy < -40 || sy > H + 40) continue;
      var sx = pu.x;
      var bob = Math.sin(pu.bobT * 2.2) * 5;
      var c = POWERUP_TYPES[pu.type].color;

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      var glow = ctx.createRadialGradient(sx, sy + bob, 2, sx, sy + bob, 34);
      glow.addColorStop(0, c);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(pu.bobT * 3);
      ctx.beginPath();
      ctx.arc(sx, sy + bob, 34, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.restore();

      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(sx, sy + bob, 16, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(12,8,23,0.85)";
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = c;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      drawPowerupGlyph(pu.type, sx, sy + bob, 15);
    }
    ctx.restore();
  }

  function drawFloatTexts() {
    ctx.textAlign = "center";
    for (var i = 0; i < floatTexts.length; i++) {
      var ft = floatTexts[i];
      var a = Math.max(0, 1 - ft.t / ft.life);
      var ty = ft.y - ft.t * 46;
      var px = ft.size === "huge" ? 40 : (ft.size === "big" ? 26 : 18);
      ctx.font = "800 " + px + "px 'Segoe UI', system-ui, sans-serif";
      ctx.globalAlpha = a;
      ctx.lineJoin = "round";
      ctx.lineWidth = ft.size === "huge" ? 5 : (ft.size === "big" ? 4 : 3);
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeText(ft.text, ft.x, ty);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ty);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.save();
    var mag = shake * 8;
    ctx.translate(W / 2, H / 2);
    ctx.scale(1 + punch * 0.05, 1 + punch * 0.05);
    ctx.translate(-W / 2 + (Math.random() - 0.5) * mag, -H / 2 + (Math.random() - 0.5) * mag);

    var zi = currentZoneInfo();
    drawBackground(zi);
    drawBokeh(zi);
    drawStars(zi);
    drawShockwaves();

    if (state === "playing" || state === "dead") {
      for (var i = 0; i < gates.length; i++) drawGate(gates[i]);
      if (state === "playing") drawPowerups(zi);
      drawParticles();
      drawFloatTexts();
      if (state === "playing") drawBall();
    }
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = "rgba(" + flashColor + "," + (flash * 0.32) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- loop ----------
  function frame(ts) {
    if (!lastTime) lastTime = ts;
    var dt = Math.min(0.033, (ts - lastTime) / 1000);
    lastTime = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  });
}
