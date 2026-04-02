// ============================================================
// DELAYSTATION — Main: audio graph setup and UI wiring
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

const isElectron = !!window.electronAPI?.isElectron;
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

// --- Electron: populate PortAudio devices ---
async function populateNativeDevices() {
  if (!isElectron) return;
  const devices = await window.electronAPI.getAudioDevices();
  if (!ui.nativeDeviceSelect) return;

  ui.nativeDeviceSelect.innerHTML = '';
  const audioDevices = devices.filter(d => d.maxInputChannels > 0 && d.maxOutputChannels > 0);
  for (const d of audioDevices) {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = `${d.name} (${d.maxInputChannels}in/${d.maxOutputChannels}out)`;
    ui.nativeDeviceSelect.appendChild(opt);
  }
}

// --- Audio start (browser mode) ---
async function startAudioBrowser(deviceId) {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API not supported');
    audioCtx = new AC();
    if (!audioCtx.audioWorklet) {
      throw new Error('AudioWorklet not available — page must be served over HTTPS or localhost');
    }
    await audioCtx.audioWorklet.addModule('js/worklet/delay-processor.js');
  }

  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  if (sourceNode) sourceNode.disconnect();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia not available');
  }
  const constraints = {
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  };
  if (deviceId) constraints.audio.deviceId = { exact: deviceId };
  mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);

  if (!workletNode) {
    workletNode = new AudioWorkletNode(audioCtx, 'delay-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    });
    inputAnalyser = audioCtx.createAnalyser();
    inputAnalyser.fftSize = 1024;
    outputAnalyser = audioCtx.createAnalyser();
    outputAnalyser.fftSize = 1024;
    workletNode.connect(outputAnalyser);
    outputAnalyser.connect(audioCtx.destination);
    connectParams(workletNode, ui);
    setupTapTempo(ui, workletNode);
    startMeters(ui, inputAnalyser, outputAnalyser);
    connectLooper(workletNode, ui);
  }

  sourceNode.connect(inputAnalyser);
  inputAnalyser.connect(workletNode);
  await audioCtx.resume();
  await populateDevices(ui);
}

// --- Audio start (Electron native mode) ---
async function startAudioNative() {
  // Create AudioContext and worklet (still needed for DSP)
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    await audioCtx.audioWorklet.addModule('js/worklet/delay-processor.js');
  }

  if (!workletNode) {
    workletNode = new AudioWorkletNode(audioCtx, 'delay-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    });

    inputAnalyser = audioCtx.createAnalyser();
    inputAnalyser.fftSize = 1024;
    outputAnalyser = audioCtx.createAnalyser();
    outputAnalyser.fftSize = 1024;

    // Connect worklet to analysers (for metering) but NOT to destination
    // Output goes through PortAudio, not system audio
    workletNode.connect(outputAnalyser);

    connectParams(workletNode, ui);
    setupTapTempo(ui, workletNode);
    startMeters(ui, inputAnalyser, outputAnalyser);
    connectLooper(workletNode, ui);
  }

  await audioCtx.resume();

  // Get channel config from UI
  const deviceId = parseInt(ui.nativeDeviceSelect?.value);
  const inputChL = parseInt(ui.inputChL?.value ?? 2);
  const inputChR = parseInt(ui.inputChR?.value ?? 3);
  const outputChL = parseInt(ui.outputChL?.value ?? 0);
  const outputChR = parseInt(ui.outputChR?.value ?? 1);

  // Stop previous native stream
  await window.electronAPI.stopAudio();

  // Start PortAudio stream, get SharedArrayBuffers back
  const result = await window.electronAPI.startAudio({
    deviceId,
    inputChannelL: inputChL,
    inputChannelR: inputChR,
    outputChannelL: outputChL,
    outputChannelR: outputChR,
    sampleRate: audioCtx.sampleRate,
    framesPerBuffer: 128,
  });

  // Pass SharedArrayBuffers to the AudioWorklet
  workletNode.port.postMessage({
    type: 'setNativeIO',
    inputSAB: result.inputSAB,
    outputSAB: result.outputSAB,
    ringSize: result.ringSize,
  });
}

// --- Start button ---
ui.startBtn.addEventListener('click', async () => {
  ui.startBtn.textContent = 'Starting…';
  ui.startBtn.disabled = true;
  try {
    if (isElectron) {
      await startAudioNative();
    } else {
      await startAudioBrowser();
    }
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

// --- Device switching (browser mode) ---
ui.deviceSelect.addEventListener('change', async () => {
  if (!audioCtx || isElectron) return;
  try {
    await startAudioBrowser(ui.deviceSelect.value);
  } catch (err) {
    console.error('Failed to switch device:', err);
  }
});

// --- Electron: populate devices on load ---
if (isElectron) {
  populateNativeDevices();
}
