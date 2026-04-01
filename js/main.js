// ============================================================
// Delay Workstation — Main: audio graph setup and UI wiring
// ============================================================

import { buildUI, connectParams, setupTapTempo, startMeters, populateDevices, connectLooper } from './ui.js';
import { getAllPresets, captureState, applyPreset, saveUserPreset, deleteUserPreset, exportPresets, importPresets } from './presets.js';
import { setupMIDI } from './midi.js';

let audioCtx = null;
let workletNode = null;
let mediaStream = null;
let sourceNode = null;
let inputAnalyser = null;
let outputAnalyser = null;

const ui = buildUI(document.getElementById('app'));

// --- Presets ---

function refreshPresetList(selectName) {
  const presets = getAllPresets();
  ui.presetSelect.innerHTML = '';

  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '\u2014 Presets \u2014';
  ui.presetSelect.appendChild(emptyOpt);

  const factoryGroup = document.createElement('optgroup');
  factoryGroup.label = 'Factory';
  for (const p of presets.filter(p => p.factory)) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    factoryGroup.appendChild(opt);
  }
  ui.presetSelect.appendChild(factoryGroup);

  const userPresets = presets.filter(p => !p.factory);
  if (userPresets.length) {
    const userGroup = document.createElement('optgroup');
    userGroup.label = 'User';
    for (const p of userPresets) {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      userGroup.appendChild(opt);
    }
    ui.presetSelect.appendChild(userGroup);
  }

  if (selectName) ui.presetSelect.value = selectName;
}

refreshPresetList();

ui.presetSelect.addEventListener('change', () => {
  const name = ui.presetSelect.value;
  if (!name) return;
  const preset = getAllPresets().find(p => p.name === name);
  if (preset) applyPreset(preset, ui);
});

ui.presetSaveBtn.addEventListener('click', () => {
  const name = prompt('Preset name:');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  if (getAllPresets().some(p => p.factory && p.name === trimmed)) {
    alert('Cannot overwrite a factory preset.');
    return;
  }
  const preset = captureState(ui, trimmed);
  saveUserPreset(preset);
  refreshPresetList(trimmed);
});

ui.presetDeleteBtn.addEventListener('click', () => {
  const name = ui.presetSelect.value;
  if (!name) return;
  const preset = getAllPresets().find(p => p.name === name);
  if (!preset) return;
  if (preset.factory) {
    alert('Cannot delete a factory preset.');
    return;
  }
  if (!confirm(`Delete preset "${name}"?`)) return;
  deleteUserPreset(name);
  refreshPresetList();
});

ui.presetExportBtn.addEventListener('click', () => {
  exportPresets();
});

ui.presetImportInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const count = await importPresets(file);
    refreshPresetList();
    alert(`Imported ${count} preset${count !== 1 ? 's' : ''}.`);
  } catch (err) {
    alert(err.message);
  }
  e.target.value = '';
});

// --- MIDI ---
setupMIDI(ui);

async function startAudio(deviceId) {
  // Create context on first call
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API not supported');
    audioCtx = new AC();
    if (!audioCtx.audioWorklet) {
      throw new Error('AudioWorklet not available — page must be served over HTTPS or localhost (not 127.0.0.1)');
    }
    await audioCtx.audioWorklet.addModule('js/worklet/delay-processor.js');
  }

  // Stop previous stream if switching devices
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
  }
  if (sourceNode) {
    sourceNode.disconnect();
  }

  // Get mic input
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia not available — are you on localhost or HTTPS?');
  }
  const constraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  };
  if (deviceId) {
    constraints.audio.deviceId = { exact: deviceId };
  }
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);

  // Build graph on first start
  if (!workletNode) {
    workletNode = new AudioWorkletNode(audioCtx, 'delay-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // Analysers for metering
    inputAnalyser = audioCtx.createAnalyser();
    inputAnalyser.fftSize = 1024;
    outputAnalyser = audioCtx.createAnalyser();
    outputAnalyser.fftSize = 1024;

    workletNode.connect(outputAnalyser);
    outputAnalyser.connect(audioCtx.destination);

    // Wire UI
    connectParams(workletNode, ui);
    setupTapTempo(ui, workletNode);
    startMeters(ui, inputAnalyser, outputAnalyser);
    connectLooper(workletNode, ui);
  }

  // Connect source through input analyser to worklet
  sourceNode.connect(inputAnalyser);
  inputAnalyser.connect(workletNode);

  await audioCtx.resume();

  // Populate device list (labels available after getUserMedia)
  await populateDevices(ui);
}

// --- Start button ---
ui.startBtn.addEventListener('click', async () => {
  ui.startBtn.textContent = 'Starting…';
  ui.startBtn.disabled = true;
  try {
    await startAudio();
    ui.startBtn.textContent = 'Audio Running';
  } catch (err) {
    console.error('Failed to start audio:', err);
    ui.startBtn.disabled = false;
    ui.startBtn.textContent = 'Error — Retry';
    const msg = document.createElement('p');
    msg.style.cssText = 'color:#e04040;margin-top:1rem;font-size:0.85rem';
    msg.textContent = err.message;
    ui.startBtn.parentNode.insertBefore(msg, ui.startBtn.nextSibling);
  }
});

// --- Device switching ---
ui.deviceSelect.addEventListener('change', async () => {
  if (!audioCtx) return;
  try {
    await startAudio(ui.deviceSelect.value);
  } catch (err) {
    console.error('Failed to switch device:', err);
  }
});
