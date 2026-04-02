// ============================================================
// DELAYSTATION — Pedal-style UI with rotary knobs
// ============================================================

const ALGORITHMS = {
  clean:     { name: 'Clean Digital', tweakLabel: 'Tone',       tweezLabel: 'Spread' },
  tape:      { name: 'Tape Echo',     tweakLabel: 'Saturation', tweezLabel: 'Flutter' },
  analog:    { name: 'Analog BBD',    tweakLabel: 'Character',  tweezLabel: 'Resonance' },
  modulated: { name: 'Modulated',     tweakLabel: 'Rate',       tweezLabel: 'Depth' },
  reverse:   { name: 'Reverse',       tweakLabel: 'Chunk Size', tweezLabel: 'Crossfade' },
  pingpong:  { name: 'Ping Pong',     tweakLabel: 'Width',      tweezLabel: 'Tone' },
  ducking:   { name: 'Ducking',       tweakLabel: 'Threshold',  tweezLabel: 'Release' },
};

// --- Helpers ---

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// --- Rotary Knob ---
// Rotation range: -135deg to +135deg (270deg total)
const KNOB_MIN_ANGLE = -135;
const KNOB_MAX_ANGLE = 135;

function createKnob(label, min, max, value, step = 1, unit = '', small = false) {
  const group = el('div', 'knob-group');
  const labelEl = el('span', 'knob-label', label);

  const knob = el('div', 'knob' + (small ? ' knob-small' : ''));
  const indicator = el('div', 'knob-indicator');
  const valueEl = el('div', 'knob-value', value + unit);
  knob.append(indicator);

  // Hidden range input for value storage and events
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.value = value;
  input.step = step;
  input.style.display = 'none';

  function updateVisual() {
    const norm = (parseFloat(input.value) - min) / (max - min);
    const angle = KNOB_MIN_ANGLE + norm * (KNOB_MAX_ANGLE - KNOB_MIN_ANGLE);
    indicator.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    valueEl.textContent = input.value + unit;
  }

  updateVisual();
  input.addEventListener('input', updateVisual);

  // Mouse/touch drag interaction
  let dragging = false;
  let startY = 0;
  let startValue = 0;

  function onStart(e) {
    dragging = true;
    startY = e.clientY ?? e.touches[0].clientY;
    startValue = parseFloat(input.value);
    document.body.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function onMove(e) {
    if (!dragging) return;
    const y = e.clientY ?? e.touches[0].clientY;
    const delta = startY - y; // up = increase
    const range = max - min;
    const sensitivity = range / 150; // 150px for full range
    const newVal = Math.max(min, Math.min(max, startValue + delta * sensitivity));
    const stepped = Math.round(newVal / step) * step;
    if (parseFloat(input.value) !== stepped) {
      input.value = stepped;
      input.dispatchEvent(new Event('input'));
    }
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
  }

  knob.addEventListener('mousedown', onStart);
  knob.addEventListener('touchstart', onStart, { passive: false });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('mouseup', onEnd);
  document.addEventListener('touchend', onEnd);

  // Double-click to reset to default
  knob.addEventListener('dblclick', () => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  });

  group.append(labelEl, knob, valueEl, input);

  return {
    group,
    input,
    knob,
    valueEl,
    setLabel(t) { labelEl.textContent = t; },
  };
}

// --- Build UI ---

export function buildUI(container) {
  container.innerHTML = '';

  // Header
  const header = el('div', 'header');
  header.appendChild(el('h1', null, 'DELAYSTATION'));

  const headerRight = el('div', 'header-right');
  headerRight.style.cssText = 'display:flex;gap:0.4rem;align-items:center';
  const deviceSelect = document.createElement('select');
  deviceSelect.id = 'device-select';
  const defaultOpt = document.createElement('option');
  defaultOpt.textContent = 'Default Input';
  defaultOpt.value = '';
  deviceSelect.appendChild(defaultOpt);

  const startBtn = el('button', null, 'Start');
  startBtn.id = 'start-btn';
  headerRight.append(deviceSelect, startBtn);
  header.appendChild(headerRight);
  container.appendChild(header);

  // Native audio routing (Electron only)
  let nativeDeviceSelect = null, inputChL = null, inputChR = null, outputChL = null, outputChR = null;
  if (window.electronAPI?.isElectron) {
    deviceSelect.style.display = 'none'; // hide browser device selector

    const nativeRow = el('div', 'native-routing');

    const devWrap = el('div', 'native-field');
    devWrap.appendChild(el('label', 'native-label', 'Device'));
    nativeDeviceSelect = document.createElement('select');
    nativeDeviceSelect.className = 'native-select';
    devWrap.appendChild(nativeDeviceSelect);
    nativeRow.appendChild(devWrap);

    function chSelect(label, defaultVal) {
      const wrap = el('div', 'native-field');
      wrap.appendChild(el('label', 'native-label', label));
      const sel = document.createElement('select');
      sel.className = 'native-select native-ch-select';
      for (let i = 0; i < 16; i++) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Ch ${i + 1}`;
        sel.appendChild(opt);
      }
      sel.value = defaultVal;
      wrap.appendChild(sel);
      nativeRow.appendChild(wrap);
      return sel;
    }

    inputChL = chSelect('In L', 2);
    inputChR = chSelect('In R', 3);
    outputChL = chSelect('Out L', 0);
    outputChR = chSelect('Out R', 1);

    container.appendChild(nativeRow);
  }

  // Algorithm selector
  const algoSection = el('div', 'algo-section');
  const algoRow = el('div', 'algo-row');
  const algoBtns = {};
  for (const [id, meta] of Object.entries(ALGORITHMS)) {
    const btn = el('button', 'algo-btn', meta.name);
    btn.dataset.algo = id;
    if (id === 'clean') btn.classList.add('active');
    algoRow.appendChild(btn);
    algoBtns[id] = btn;
  }
  algoSection.appendChild(algoRow);
  container.appendChild(algoSection);

  // Preset row
  const presetRow = el('div', 'preset-row');
  const presetSelect = document.createElement('select');
  presetSelect.id = 'preset-select';
  presetSelect.className = 'preset-select';
  const presetSaveBtn = el('button', 'preset-btn', 'Save');
  const presetDeleteBtn = el('button', 'preset-btn preset-delete-btn', 'Delete');
  const presetExportBtn = el('button', 'preset-btn', 'Export');
  const presetImportBtn = el('button', 'preset-btn', 'Import');
  const presetImportInput = document.createElement('input');
  presetImportInput.type = 'file';
  presetImportInput.accept = '.json';
  presetImportInput.style.display = 'none';
  presetImportBtn.addEventListener('click', () => presetImportInput.click());
  presetRow.append(presetSelect, presetSaveBtn, presetDeleteBtn, presetExportBtn, presetImportBtn, presetImportInput);
  container.appendChild(presetRow);

  // Main knobs row: TIME, FEEDBACK, TWEAK, TWEEZ, MIX
  const knobsMain = el('div', 'knobs-main');

  const time     = createKnob('Time', 10, 2000, 500, 1, 'ms');
  const feedback = createKnob('Repeats', 0, 95, 30, 1, '%');
  const tweak    = createKnob('Tweak', 0, 100, 50, 1, '%');
  const tweez    = createKnob('Tweez', 0, 100, 50, 1, '%');
  const mix      = createKnob('Mix', 0, 100, 50, 1, '%');

  knobsMain.append(time.group, feedback.group, tweak.group, tweez.group, mix.group);
  container.appendChild(knobsMain);

  // Sync tempo-driven CSS animation to delay time
  function syncTempoCSS() {
    const ms = parseFloat(time.input.value) || 500;
    container.style.setProperty('--tempo-duration', ms + 'ms');
  }
  time.input.addEventListener('input', syncTempoCSS);
  syncTempoCSS();

  // Secondary knobs: INPUT GAIN, OUTPUT GAIN + subdivision
  const knobsSecondary = el('div', 'knobs-secondary');
  const inputGain  = createKnob('Input', 0, 200, 100, 1, '%', true);
  const outputGain = createKnob('Output', 0, 200, 100, 1, '%', true);

  // Tap tempo + subdivision
  const tapGroup = el('div', 'tap-group');
  const subdivSelect = document.createElement('select');
  subdivSelect.className = 'subdiv-select';
  const subdivisions = [
    { label: '1/4', value: 1 },
    { label: 'dot 1/8', value: 0.75 },
    { label: '1/8 trip', value: 2 / 3 },
    { label: '1/8', value: 0.5 },
    { label: 'dot 1/4', value: 1.5 },
  ];
  for (const s of subdivisions) {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    subdivSelect.appendChild(opt);
  }
  tapGroup.append(el('span', 'knob-label', 'Subdiv'), subdivSelect);

  knobsSecondary.append(inputGain.group, tapGroup, outputGain.group);
  container.appendChild(knobsSecondary);

  // Footswitches: BYPASS, TAP
  const footswitchRow = el('div', 'footswitch-row');
  const bypassBtn = el('button', 'footswitch bypass-btn', 'Bypass');
  bypassBtn.dataset.active = 'false';
  const bypassLed = el('div', 'bypass-led');
  bypassBtn.appendChild(bypassLed);

  const tapBtn = el('button', 'footswitch tap-btn', 'Tap');
  const tapLed = el('div', 'tap-led');
  tapBtn.appendChild(tapLed);

  footswitchRow.append(bypassBtn, tapBtn);
  container.appendChild(footswitchRow);

  // --- Looper Section ---
  const looperSection = el('div', 'looper-section');

  const looperHeader = el('div', 'looper-header');
  looperHeader.appendChild(el('span', 'looper-title', 'Looper'));
  const looperTime = el('span', 'looper-time', '0:00 / 2:00');
  looperHeader.appendChild(looperTime);
  looperSection.appendChild(looperHeader);

  const looperFootRow = el('div', 'looper-foot-row');

  const looperRecBtn = el('button', 'footswitch looper-rec-btn', 'Record');
  const looperRecLed = el('div', 'looper-led looper-rec-led');
  looperRecBtn.appendChild(looperRecLed);

  const looperPlayBtn = el('button', 'footswitch looper-play-btn', 'Play');
  const looperPlayLed = el('div', 'looper-led looper-play-led');
  looperPlayBtn.appendChild(looperPlayLed);

  const looperClearBtn = el('button', 'footswitch looper-clear-btn', 'Clear');

  looperFootRow.append(looperRecBtn, looperPlayBtn, looperClearBtn);
  looperSection.appendChild(looperFootRow);

  // Secondary looper controls
  const looperSecondary = el('div', 'looper-secondary');
  const looperUndoBtn = el('button', 'looper-mode-btn', 'Undo');
  looperUndoBtn.disabled = true;
  const looperHalfBtn = el('button', 'looper-mode-btn', '½ Speed');
  const looperRevBtn = el('button', 'looper-mode-btn', 'Reverse');
  const looperOnceBtn = el('button', 'looper-mode-btn', 'Once');
  looperSecondary.append(looperUndoBtn, looperHalfBtn, looperRevBtn, looperOnceBtn);
  looperSection.appendChild(looperSecondary);

  // Loop position bar
  const looperPosWrap = el('div', 'looper-pos-wrap');
  const looperPosBar = el('div', 'looper-pos-bar');
  looperPosWrap.appendChild(looperPosBar);
  looperSection.appendChild(looperPosWrap);

  container.appendChild(looperSection);

  // Meters
  const dpr = window.devicePixelRatio || 1;
  const METER_W = 300;
  const METER_H = 6;

  function createMeter() {
    const canvas = document.createElement('canvas');
    canvas.className = 'meter';
    canvas.width = METER_W * dpr;
    canvas.height = METER_H * dpr;
    canvas.style.width = METER_W + 'px';
    canvas.style.height = METER_H + 'px';
    canvas.getContext('2d').scale(dpr, dpr);
    return canvas;
  }

  const metersSection = el('div', 'meters-section');
  const inputCanvas = createMeter();
  const outputCanvas = createMeter();
  const inRow = el('div', 'meter-row');
  inRow.append(el('span', 'meter-label', 'In'), inputCanvas);
  const outRow = el('div', 'meter-row');
  outRow.append(el('span', 'meter-label', 'Out'), outputCanvas);
  metersSection.append(inRow, outRow);
  container.appendChild(metersSection);

  // --- Algorithm switching (works before audio) ---
  let currentAlgo = 'clean';
  const algoListeners = [];

  algoRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.algo-btn');
    if (!btn) return;
    const algo = btn.dataset.algo;
    if (algo === currentAlgo) return;

    algoBtns[currentAlgo].classList.remove('active');
    btn.classList.add('active');
    currentAlgo = algo;

    for (const fn of algoListeners) fn(algo);
  });

  // Bypass
  const bypassListeners = [];
  bypassBtn.addEventListener('click', () => {
    const active = bypassBtn.dataset.active === 'true';
    bypassBtn.dataset.active = active ? 'false' : 'true';
    bypassBtn.textContent = active ? 'Bypass' : 'Bypass On';
    bypassBtn.classList.toggle('active', !active);
    for (const fn of bypassListeners) fn(!active);
  });

  return {
    startBtn,
    deviceSelect,
    algoBtns,
    algoRow,
    time: time.input,
    feedback: feedback.input,
    mix: mix.input,
    tweak: { input: tweak.input, setLabel() {} },
    tweez: { input: tweez.input, setLabel() {} },
    tapBtn,
    subdivSelect,
    inputGain: inputGain.input,
    outputGain: outputGain.input,
    bypassBtn,
    presetSelect,
    presetSaveBtn,
    presetDeleteBtn,
    presetExportBtn,
    presetImportInput,
    looperRecBtn,
    looperPlayBtn,
    looperClearBtn,
    looperUndoBtn,
    looperHalfBtn,
    looperRevBtn,
    looperOnceBtn,
    looperRecLed,
    looperPlayLed,
    looperPosBar,
    looperTime,
    inputCanvas,
    outputCanvas,
    nativeDeviceSelect,
    inputChL,
    inputChR,
    outputChL,
    outputChR,
    ALGORITHMS,
    get currentAlgo() { return currentAlgo; },
    onAlgoChange(fn) { algoListeners.push(fn); },
    onBypassChange(fn) { bypassListeners.push(fn); },
  };
}

// --- Connect params to worklet ---

export function connectParams(workletNode, ui) {
  const bindings = [
    { el: ui.time,         param: 'delayTime',  scale: 1 },
    { el: ui.feedback,     param: 'feedback',    scale: 1 / 100 * 0.95 },
    { el: ui.mix,          param: 'mix',         scale: 0.01 },
    { el: ui.tweak.input,  param: 'tweak',       scale: 0.01 },
    { el: ui.tweez.input,  param: 'tweez',       scale: 0.01 },
    { el: ui.inputGain,    param: 'inputGain',   scale: 0.01 * 2 },
    { el: ui.outputGain,   param: 'outputGain',  scale: 0.01 * 2 },
  ];

  for (const b of bindings) {
    const audioParam = workletNode.parameters.get(b.param);
    audioParam.setValueAtTime(parseFloat(b.el.value) * b.scale, 0);
    b.el.addEventListener('input', () => {
      audioParam.setValueAtTime(parseFloat(b.el.value) * b.scale, 0);
    });
  }

  workletNode.port.postMessage({ type: 'setAlgorithm', value: ui.currentAlgo });
  ui.onAlgoChange((algo) => {
    workletNode.port.postMessage({ type: 'setAlgorithm', value: algo });
  });

  ui.onBypassChange((active) => {
    workletNode.port.postMessage({ type: 'setBypass', value: active });
  });
}

// --- Tap Tempo ---

export function setupTapTempo(ui, workletNode) {
  const tapTimes = [];
  const MAX_TAPS = 4;
  const TIMEOUT = 2000;
  let lastTappedMs = null;

  function applySubdivision() {
    if (lastTappedMs === null) return;
    const subdiv = parseFloat(ui.subdivSelect.value) || 1;
    const clamped = Math.max(10, Math.min(2000, lastTappedMs * subdiv));
    ui.time.value = Math.round(clamped);
    ui.time.dispatchEvent(new Event('input'));
  }

  function handleTap() {
    const now = performance.now();
    if (tapTimes.length && (now - tapTimes[tapTimes.length - 1]) > TIMEOUT) {
      tapTimes.length = 0;
    }
    tapTimes.push(now);
    if (tapTimes.length > MAX_TAPS) tapTimes.shift();

    if (tapTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < tapTimes.length; i++) {
        total += tapTimes[i] - tapTimes[i - 1];
      }
      lastTappedMs = total / (tapTimes.length - 1);
      applySubdivision();
    }
  }

  ui.subdivSelect.addEventListener('change', applySubdivision);
  ui.tapBtn.addEventListener('click', handleTap);

  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'KeyT') {
      e.preventDefault();
      handleTap();
    }
    if (e.code === 'KeyB') {
      ui.bypassBtn.click();
    }
    if (e.code === 'KeyR') { ui.looperRecBtn.click(); }
    if (e.code === 'KeyP') { ui.looperPlayBtn.click(); }
    if (e.code === 'KeyC') { ui.looperClearBtn.click(); }
    if (e.code === 'KeyU') { ui.looperUndoBtn.click(); }
  });

  // Tempo-synced pulse on TAP button LED
  let lastPulse = 0;
  function animatePulse(now) {
    const delayMs = parseFloat(ui.time.value) || 500;
    const elapsed = now - lastPulse;
    if (elapsed >= delayMs) {
      lastPulse = now - (elapsed % delayMs);
    }
    const phase = (now - lastPulse) / delayMs;
    const glow = Math.max(0, 1 - phase * 3);

    const led = ui.tapBtn.querySelector('.tap-led');
    if (led) {
      const on = glow > 0.05;
      led.style.background = on ? `rgba(100, 220, 100, ${0.3 + glow * 0.7})` : '#333';
      led.style.boxShadow = on ? `0 0 ${4 + glow * 8}px rgba(100, 220, 100, ${glow * 0.6})` : 'none';
    }
    ui.tapBtn.style.borderColor = glow > 0.05
      ? `rgba(100, 180, 100, ${0.2 + glow * 0.3})`
      : '#444';

    requestAnimationFrame(animatePulse);
  }
  requestAnimationFrame(animatePulse);
}

// --- Level Meters ---

export function startMeters(ui, inputAnalyser, outputAnalyser) {
  const inBuf  = new Float32Array(inputAnalyser.fftSize);
  const outBuf = new Float32Array(outputAnalyser.fftSize);
  let inPeak = 0;
  let outPeak = 0;
  const DECAY = 0.95;

  function draw() {
    inputAnalyser.getFloatTimeDomainData(inBuf);
    const inRms = rms(inBuf);
    inPeak = Math.max(inRms, inPeak * DECAY);
    drawMeter(ui.inputCanvas, inRms, inPeak);

    outputAnalyser.getFloatTimeDomainData(outBuf);
    const outRms = rms(outBuf);
    outPeak = Math.max(outRms, outPeak * DECAY);
    drawMeter(ui.outputCanvas, outRms, outPeak);

    requestAnimationFrame(draw);
  }
  draw();
}

function rms(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

function drawMeter(canvas, level, peak) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1a261a';
  ctx.fillRect(0, 0, w, h);

  const barW = Math.min(1, level * 5) * w;
  const ratio = barW / w;
  ctx.fillStyle = ratio < 0.6 ? '#4a8a4a' : ratio < 0.85 ? '#8a8a3a' : '#8a3a3a';
  ctx.fillRect(0, 0, barW, h);

  const peakX = Math.min(1, peak * 5) * w;
  ctx.fillStyle = '#8ab88a';
  ctx.fillRect(peakX - 1, 0, 2, h);
}

// --- Device Selector ---

export async function populateDevices(ui) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === 'audioinput');
    ui.deviceSelect.innerHTML = '';
    for (const d of audioInputs) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Input ${ui.deviceSelect.length + 1}`;
      ui.deviceSelect.appendChild(opt);
    }
  } catch (err) {
    console.warn('Could not enumerate devices:', err);
  }
}

// --- Looper UI Updates ---

export function updateLooperState(ui, data) {
  const { state, loopLength, playhead, recordHead, maxLength, sampleRate: sr, hasUndo, halfSpeed, reverse } = data;

  // LED states
  const recLed = ui.looperRecLed;
  const playLed = ui.looperPlayLed;

  // Reset
  recLed.className = 'looper-led looper-rec-led';
  playLed.className = 'looper-led looper-play-led';

  if (state === 'recording') {
    recLed.classList.add('recording');
    ui.looperRecBtn.textContent = 'Stop';
    ui.looperRecBtn.appendChild(recLed);
  } else if (state === 'overdubbing') {
    recLed.classList.add('overdubbing');
    playLed.classList.add('playing');
    ui.looperRecBtn.textContent = 'Stop Dub';
    ui.looperRecBtn.appendChild(recLed);
    ui.looperPlayBtn.textContent = 'Stop';
    ui.looperPlayBtn.appendChild(playLed);
  } else if (state === 'playing') {
    playLed.classList.add('playing');
    ui.looperRecBtn.textContent = 'Overdub';
    ui.looperRecBtn.appendChild(recLed);
    ui.looperPlayBtn.textContent = 'Stop';
    ui.looperPlayBtn.appendChild(playLed);
  } else if (state === 'stopped') {
    playLed.classList.add('stopped');
    ui.looperRecBtn.textContent = 'Overdub';
    ui.looperRecBtn.appendChild(recLed);
    ui.looperPlayBtn.textContent = 'Play';
    ui.looperPlayBtn.appendChild(playLed);
  } else {
    ui.looperRecBtn.textContent = 'Record';
    ui.looperRecBtn.appendChild(recLed);
    ui.looperPlayBtn.textContent = 'Play';
    ui.looperPlayBtn.appendChild(playLed);
  }

  // Undo button
  ui.looperUndoBtn.disabled = !hasUndo;

  // Mode buttons active state
  ui.looperHalfBtn.classList.toggle('active', halfSpeed);
  ui.looperRevBtn.classList.toggle('active', reverse);

  // Time display
  if (sr && sr > 0) {
    const currentSec = state === 'recording'
      ? loopLength / sr  // during recording, loopLength isn't set yet
      : (loopLength > 0 ? playhead / sr : 0);
    const totalSec = state === 'recording'
      ? maxLength / sr
      : (loopLength > 0 ? loopLength / sr : maxLength / sr);

    const fmt = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    if (state === 'recording') {
      ui.looperTime.textContent = `REC ${fmt(recordHead / sr)} / ${fmt(maxLength / sr)}`;
    } else {
      ui.looperTime.textContent = `${fmt(currentSec)} / ${fmt(totalSec)}`;
    }
  }

  // Position bar
  if (loopLength > 0 && (state === 'playing' || state === 'overdubbing')) {
    const pct = (playhead / loopLength) * 100;
    ui.looperPosBar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  } else if (state === 'recording' && maxLength > 0) {
    const pct = (recordHead / maxLength) * 100;
    ui.looperPosBar.style.width = Math.min(100, pct) + '%';
    ui.looperPosBar.style.background = 'linear-gradient(90deg, #c44, #e66)';
  } else {
    ui.looperPosBar.style.width = '0%';
    ui.looperPosBar.style.background = '';
  }
}

export function connectLooper(workletNode, ui) {
  // Allocate loop buffers
  workletNode.port.postMessage({ type: 'looperAllocate' });

  // Wire footswitch buttons
  ui.looperRecBtn.addEventListener('click', () => {
    workletNode.port.postMessage({ type: 'looperRecord' });
  });
  ui.looperPlayBtn.addEventListener('click', () => {
    workletNode.port.postMessage({ type: 'looperPlayStop' });
  });
  ui.looperClearBtn.addEventListener('click', () => {
    workletNode.port.postMessage({ type: 'looperClear' });
  });
  ui.looperUndoBtn.addEventListener('click', () => {
    workletNode.port.postMessage({ type: 'looperUndo' });
  });
  ui.looperHalfBtn.addEventListener('click', () => {
    workletNode.port.postMessage({ type: 'looperHalfSpeed' });
  });
  ui.looperRevBtn.addEventListener('click', () => {
    workletNode.port.postMessage({ type: 'looperReverse' });
  });
  ui.looperOnceBtn.addEventListener('click', () => {
    workletNode.port.postMessage({ type: 'looperPlayOnce' });
  });

  // Listen for state updates from worklet
  workletNode.port.onmessage = (e) => {
    if (e.data.type === 'looperState') {
      updateLooperState(ui, e.data);
    }
  };
}
