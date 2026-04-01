// ============================================================
// Delay Workstation — UI: DOM construction, controls, meters
// ============================================================

const ALGORITHMS = {
  clean:     { name: 'Clean Digital', tweakLabel: 'Tweak: Tone',       tweezLabel: 'Tweez: Spread' },
  tape:      { name: 'Tape Echo',     tweakLabel: 'Tweak: Saturation', tweezLabel: 'Tweez: Flutter' },
  analog:    { name: 'Analog BBD',    tweakLabel: 'Tweak: Character',  tweezLabel: 'Tweez: Resonance' },
  modulated: { name: 'Modulated',     tweakLabel: 'Tweak: Rate',       tweezLabel: 'Tweez: Depth' },
  reverse:   { name: 'Reverse',       tweakLabel: 'Tweak: Chunk Size', tweezLabel: 'Tweez: Crossfade' },
  pingpong:  { name: 'Ping Pong',     tweakLabel: 'Tweak: Width',      tweezLabel: 'Tweez: Tone' },
  ducking:   { name: 'Ducking',       tweakLabel: 'Tweak: Threshold',  tweezLabel: 'Tweez: Release' },
};

// --- Helpers ---

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function createSlider(label, min, max, value, step = 1, unit = '') {
  const wrapper = el('div', 'slider-group');
  const lbl = el('label', null, label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min;
  input.max = max;
  input.value = value;
  input.step = step;
  const readout = el('span', 'readout', value + unit);
  input.addEventListener('input', () => {
    readout.textContent = input.value + unit;
  });
  wrapper.append(lbl, input, readout);
  return { wrapper, input, readout, setLabel(t) { lbl.textContent = t; } };
}

// --- Build UI ---

export function buildUI(container) {
  container.innerHTML = '';

  // Header row
  const header = el('div', 'header');
  header.appendChild(el('h1', null, 'Delay Workstation'));
  const deviceSelect = document.createElement('select');
  deviceSelect.id = 'device-select';
  const defaultOpt = document.createElement('option');
  defaultOpt.textContent = 'Default Input';
  defaultOpt.value = '';
  deviceSelect.appendChild(defaultOpt);
  header.appendChild(deviceSelect);
  container.appendChild(header);

  // Start button
  const startBtn = el('button', 'start-btn', 'Start Audio');
  startBtn.id = 'start-btn';
  container.appendChild(startBtn);

  // Algorithm selector
  const algoRow = el('div', 'algo-row');
  const algoBtns = {};
  for (const [id, meta] of Object.entries(ALGORITHMS)) {
    const btn = el('button', 'algo-btn', meta.name);
    btn.dataset.algo = id;
    if (id === 'clean') btn.classList.add('active');
    algoRow.appendChild(btn);
    algoBtns[id] = btn;
  }
  container.appendChild(algoRow);

  // Preset row
  const presetRow = el('div', 'preset-row');
  const presetSelect = document.createElement('select');
  presetSelect.id = 'preset-select';
  presetSelect.className = 'preset-select';
  const presetSaveBtn = el('button', 'preset-btn', 'Save');
  const presetDeleteBtn = el('button', 'preset-btn preset-delete-btn', 'Delete');
  presetRow.append(presetSelect, presetSaveBtn, presetDeleteBtn);
  container.appendChild(presetRow);

  // Shared parameter sliders
  const paramsSection = el('div', 'params-section');

  const sharedRow = el('div', 'param-row');
  const time     = createSlider('Time', 10, 2000, 500, 1, ' ms');
  const feedback = createSlider('Feedback', 0, 95, 30, 1, '%');
  const mix      = createSlider('Mix', 0, 100, 50, 1, '%');
  sharedRow.append(time.wrapper, feedback.wrapper, mix.wrapper);
  paramsSection.appendChild(sharedRow);

  const tweakRow = el('div', 'param-row tweak-row');
  const tweak = createSlider(ALGORITHMS.clean.tweakLabel, 0, 100, 50, 1, '%');
  const tweez = createSlider(ALGORITHMS.clean.tweezLabel, 0, 100, 50, 1, '%');
  tweak.wrapper.classList.add('tweak-slider');
  tweez.wrapper.classList.add('tweez-slider');
  tweakRow.append(tweak.wrapper, tweez.wrapper);

  // Tap tempo + subdivision
  const tapGroup = el('div', 'tap-group');
  const tapBtn = el('button', 'tap-btn', 'TAP');
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
  tapGroup.append(tapBtn, subdivSelect);
  tweakRow.appendChild(tapGroup);
  paramsSection.appendChild(tweakRow);

  container.appendChild(paramsSection);

  // Gain sliders
  const gainRow = el('div', 'param-row gain-row');
  const inputGain  = createSlider('Input Gain', 0, 200, 100, 1, '%');
  const outputGain = createSlider('Output Gain', 0, 200, 100, 1, '%');
  gainRow.append(inputGain.wrapper, outputGain.wrapper);
  container.appendChild(gainRow);

  // Bypass
  const bypassBtn = el('button', 'bypass-btn', 'Bypass: OFF');
  bypassBtn.dataset.active = 'false';
  container.appendChild(bypassBtn);

  // Level meters (retina-aware)
  const dpr = window.devicePixelRatio || 1;
  const METER_W = 300;
  const METER_H = 12;

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
  const inputMeterLabel = el('span', 'meter-label', 'IN');
  const inputCanvas = createMeter();
  const outputMeterLabel = el('span', 'meter-label', 'OUT');
  const outputCanvas = createMeter();
  const inputMeterRow = el('div', 'meter-row');
  inputMeterRow.append(inputMeterLabel, inputCanvas);
  const outputMeterRow = el('div', 'meter-row');
  outputMeterRow.append(outputMeterLabel, outputCanvas);
  metersSection.append(inputMeterRow, outputMeterRow);
  container.appendChild(metersSection);

  // --- UI-only state (works before audio starts) ---
  let currentAlgo = 'clean';
  const algoListeners = []; // callbacks registered by connectParams

  algoRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.algo-btn');
    if (!btn) return;
    const algo = btn.dataset.algo;
    if (algo === currentAlgo) return;

    algoBtns[currentAlgo].classList.remove('active');
    btn.classList.add('active');
    currentAlgo = algo;

    // Update Tweak/Tweez labels
    const meta = ALGORITHMS[algo];
    tweak.setLabel(meta.tweakLabel);
    tweez.setLabel(meta.tweezLabel);

    // Notify audio engine if connected
    for (const fn of algoListeners) fn(algo);
  });

  const bypassListeners = [];
  bypassBtn.addEventListener('click', () => {
    const active = bypassBtn.dataset.active === 'true';
    bypassBtn.dataset.active = active ? 'false' : 'true';
    bypassBtn.textContent = active ? 'Bypass: OFF' : 'Bypass: ON';
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
    tweak,
    tweez,
    tapBtn,
    subdivSelect,
    inputGain: inputGain.input,
    outputGain: outputGain.input,
    bypassBtn,
    presetSelect,
    presetSaveBtn,
    presetDeleteBtn,
    inputCanvas,
    outputCanvas,
    ALGORITHMS,
    get currentAlgo() { return currentAlgo; },
    onAlgoChange(fn) { algoListeners.push(fn); },
    onBypassChange(fn) { bypassListeners.push(fn); },
  };
}

// --- Connect params to worklet ---

export function connectParams(workletNode, ui) {
  const bindings = [
    { el: ui.time,       param: 'delayTime',  scale: 1 },
    { el: ui.feedback,   param: 'feedback',   scale: 1 / 100 * 0.95 },
    { el: ui.mix,        param: 'mix',        scale: 0.01 },
    { el: ui.tweak.input, param: 'tweak',     scale: 0.01 },
    { el: ui.tweez.input, param: 'tweez',     scale: 0.01 },
    { el: ui.inputGain,  param: 'inputGain',  scale: 0.01 * 2 },
    { el: ui.outputGain, param: 'outputGain', scale: 0.01 * 2 },
  ];

  for (const b of bindings) {
    const audioParam = workletNode.parameters.get(b.param);
    audioParam.setValueAtTime(parseFloat(b.el.value) * b.scale, 0);
    b.el.addEventListener('input', () => {
      audioParam.setValueAtTime(parseFloat(b.el.value) * b.scale, 0);
    });
  }

  // Wire algorithm switching to worklet
  workletNode.port.postMessage({ type: 'setAlgorithm', value: ui.currentAlgo });
  ui.onAlgoChange((algo) => {
    workletNode.port.postMessage({ type: 'setAlgorithm', value: algo });
  });

  // Wire bypass to worklet
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
  });

  // Continuous tempo-synced pulse animation
  let lastPulse = 0;
  function animatePulse(now) {
    const delayMs = parseFloat(ui.time.value) || 500;
    const elapsed = now - lastPulse;

    if (elapsed >= delayMs) {
      lastPulse = now - (elapsed % delayMs);
    }

    // Brightness ramps up at beat, then fades out
    const phase = (now - lastPulse) / delayMs;
    const glow = Math.max(0, 1 - phase * 3); // fast fade: bright for ~33% of cycle
    ui.tapBtn.style.borderColor = glow > 0.01
      ? `rgba(0, 180, 216, ${0.3 + glow * 0.7})`
      : '#444';
    ui.tapBtn.style.boxShadow = glow > 0.05
      ? `0 0 ${4 + glow * 10}px rgba(0, 180, 216, ${glow * 0.5})`
      : 'none';

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
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

function drawMeter(canvas, level, peak) {
  const ctx = canvas.getContext('2d');
  // Use CSS pixel dimensions (canvas is scaled by dpr)
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#2a2a2a';
  ctx.fillRect(0, 0, w, h);

  const barW = Math.min(1, level * 5) * w;
  const ratio = barW / w;
  ctx.fillStyle = ratio < 0.6 ? '#00b4d8' : ratio < 0.85 ? '#f0c040' : '#e04040';
  ctx.fillRect(0, 0, barW, h);

  const peakX = Math.min(1, peak * 5) * w;
  ctx.fillStyle = '#fff';
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
