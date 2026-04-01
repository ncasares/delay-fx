// ============================================================
// Delay Workstation — Preset management
// ============================================================

const STORAGE_KEY = 'delay-fx-user-presets';

const FACTORY_PRESETS = [
  { name: 'Clean Slapback',  factory: true, algorithm: 'clean',     params: { delayTime: 120,  feedback: 10, mix: 55, tweak: 40, tweez: 20, inputGain: 100, outputGain: 100 } },
  { name: 'Dotted Eighth',   factory: true, algorithm: 'clean',     params: { delayTime: 375,  feedback: 35, mix: 40, tweak: 50, tweez: 50, inputGain: 100, outputGain: 100 } },
  { name: 'Worn Tape',       factory: true, algorithm: 'tape',      params: { delayTime: 340,  feedback: 45, mix: 50, tweak: 70, tweez: 40, inputGain: 100, outputGain: 100 } },
  { name: 'Lo-Fi Tape',      factory: true, algorithm: 'tape',      params: { delayTime: 500,  feedback: 60, mix: 45, tweak: 85, tweez: 65, inputGain: 100, outputGain: 100 } },
  { name: 'Dark Analog',     factory: true, algorithm: 'analog',    params: { delayTime: 300,  feedback: 55, mix: 45, tweak: 60, tweez: 70, inputGain: 100, outputGain: 100 } },
  { name: 'Chorus Wash',     factory: true, algorithm: 'modulated', params: { delayTime: 30,   feedback: 40, mix: 60, tweak: 65, tweez: 80, inputGain: 100, outputGain: 100 } },
  { name: 'Seasick',         factory: true, algorithm: 'modulated', params: { delayTime: 250,  feedback: 50, mix: 50, tweak: 80, tweez: 90, inputGain: 100, outputGain: 100 } },
  { name: 'Reverse Swell',   factory: true, algorithm: 'reverse',   params: { delayTime: 400,  feedback: 35, mix: 65, tweak: 60, tweez: 70, inputGain: 100, outputGain: 100 } },
  { name: 'Wide Pong',       factory: true, algorithm: 'pingpong',  params: { delayTime: 375,  feedback: 50, mix: 50, tweak: 90, tweez: 40, inputGain: 100, outputGain: 100 } },
  { name: 'Tight Pong',      factory: true, algorithm: 'pingpong',  params: { delayTime: 180,  feedback: 30, mix: 40, tweak: 70, tweez: 60, inputGain: 100, outputGain: 100 } },
  { name: 'Talk Box Duck',   factory: true, algorithm: 'ducking',   params: { delayTime: 350,  feedback: 45, mix: 55, tweak: 50, tweez: 40, inputGain: 100, outputGain: 100 } },
  { name: 'Heavy Duck',      factory: true, algorithm: 'ducking',   params: { delayTime: 500,  feedback: 65, mix: 60, tweak: 30, tweez: 70, inputGain: 100, outputGain: 100 } },
];

function getUserPresets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function setUserPresets(presets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function getAllPresets() {
  return [...FACTORY_PRESETS, ...getUserPresets()];
}

export function saveUserPreset(preset) {
  const presets = getUserPresets();
  const idx = presets.findIndex(p => p.name === preset.name);
  if (idx >= 0) {
    presets[idx] = preset;
  } else {
    presets.push(preset);
  }
  setUserPresets(presets);
}

export function deleteUserPreset(name) {
  const presets = getUserPresets().filter(p => p.name !== name);
  setUserPresets(presets);
}

export function captureState(ui, name) {
  return {
    name,
    algorithm: ui.currentAlgo,
    params: {
      delayTime:  parseInt(ui.time.value),
      feedback:   parseInt(ui.feedback.value),
      mix:        parseInt(ui.mix.value),
      tweak:      parseInt(ui.tweak.input.value),
      tweez:      parseInt(ui.tweez.input.value),
      inputGain:  parseInt(ui.inputGain.value),
      outputGain: parseInt(ui.outputGain.value),
    },
  };
}

export function exportPresets() {
  const presets = getUserPresets();
  if (presets.length === 0) return null;
  const blob = new Blob(
    [JSON.stringify({ version: 1, presets }, null, 2)],
    { type: 'application/json' }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'delaystation-presets.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function importPresets(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let incoming = [];
        if (Array.isArray(data)) {
          incoming = data;
        } else if (data.presets && Array.isArray(data.presets)) {
          incoming = data.presets;
        } else {
          reject(new Error('Invalid preset file format'));
          return;
        }
        // Validate and strip factory flag
        const valid = incoming
          .filter(p => p.name && p.algorithm && p.params)
          .map(({ name, algorithm, params }) => ({ name, algorithm, params }));
        if (valid.length === 0) {
          reject(new Error('No valid presets found in file'));
          return;
        }
        // Merge: imported presets overwrite existing with same name
        const existing = getUserPresets();
        for (const p of valid) {
          const idx = existing.findIndex(e => e.name === p.name);
          if (idx >= 0) {
            existing[idx] = p;
          } else {
            existing.push(p);
          }
        }
        setUserPresets(existing);
        resolve(valid.length);
      } catch (err) {
        reject(new Error('Failed to parse preset file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function applyPreset(preset, ui) {
  // Switch algorithm first (updates tweak/tweez labels)
  if (preset.algorithm !== ui.currentAlgo) {
    ui.algoBtns[preset.algorithm].click();
  }

  const sliders = {
    delayTime:  ui.time,
    feedback:   ui.feedback,
    mix:        ui.mix,
    tweak:      ui.tweak.input,
    tweez:      ui.tweez.input,
    inputGain:  ui.inputGain,
    outputGain: ui.outputGain,
  };

  for (const [key, el] of Object.entries(sliders)) {
    if (preset.params[key] !== undefined) {
      el.value = preset.params[key];
      el.dispatchEvent(new Event('input'));
    }
  }
}
