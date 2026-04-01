// ============================================================
// Delay Workstation — MIDI CC mapping
// ============================================================

const STORAGE_KEY = 'delay-fx-midi-mappings';

// Default CC mappings (common CC numbers)
const DEFAULT_MAPPINGS = {
  1:  'mix',        // Mod wheel
  11: 'feedback',   // Expression
  12: 'delayTime',  // Effect Control 1
  13: 'tweak',      // Effect Control 2
  14: 'tweez',
  15: 'inputGain',
  16: 'outputGain',
};

const PARAM_DEFS = {
  delayTime:  { label: 'Time',        el: 'time',          min: 10, max: 2000 },
  feedback:   { label: 'Feedback',    el: 'feedback',      min: 0,  max: 95 },
  mix:        { label: 'Mix',         el: 'mix',           min: 0,  max: 100 },
  tweak:      { label: 'Tweak',       el: 'tweak.input',   min: 0,  max: 100 },
  tweez:      { label: 'Tweez',       el: 'tweez.input',   min: 0,  max: 100 },
  inputGain:  { label: 'Input Gain',  el: 'inputGain',     min: 0,  max: 200 },
  outputGain: { label: 'Output Gain', el: 'outputGain',    min: 0,  max: 200 },
};

function getSlider(ui, path) {
  const parts = path.split('.');
  let obj = ui;
  for (const p of parts) obj = obj[p];
  return obj;
}

function loadMappings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { ...DEFAULT_MAPPINGS };
  } catch {
    return { ...DEFAULT_MAPPINGS };
  }
}

function saveMappings(mappings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings));
}

export function setupMIDI(ui) {
  let mappings = loadMappings();
  let learnTarget = null; // param name waiting for a CC assignment
  let midiAccess = null;

  // --- MIDI Learn UI ---
  const midiSection = document.createElement('div');
  midiSection.className = 'midi-section';

  const midiHeader = document.createElement('div');
  midiHeader.className = 'midi-header';
  const midiTitle = document.createElement('span');
  midiTitle.className = 'midi-title';
  midiTitle.textContent = 'MIDI CC';
  const midiToggle = document.createElement('button');
  midiToggle.className = 'midi-toggle';
  midiToggle.textContent = 'Connect';
  midiHeader.append(midiTitle, midiToggle);
  midiSection.appendChild(midiHeader);

  const midiStatus = document.createElement('span');
  midiStatus.className = 'midi-status';
  midiStatus.textContent = '';
  midiHeader.appendChild(midiStatus);

  const midiMapList = document.createElement('div');
  midiMapList.className = 'midi-map-list';
  midiMapList.style.display = 'none';
  midiSection.appendChild(midiMapList);

  // Insert before meters
  const metersSection = ui.inputCanvas.closest('.meters-section');
  metersSection.parentNode.insertBefore(midiSection, metersSection);

  function renderMappings() {
    midiMapList.innerHTML = '';

    for (const [paramKey, def] of Object.entries(PARAM_DEFS)) {
      const row = document.createElement('div');
      row.className = 'midi-map-row';

      const label = document.createElement('span');
      label.className = 'midi-map-label';
      label.textContent = def.label;

      const ccLabel = document.createElement('span');
      ccLabel.className = 'midi-map-cc';
      const ccNum = Object.entries(mappings).find(([, v]) => v === paramKey)?.[0];
      ccLabel.textContent = ccNum ? `CC ${ccNum}` : '—';

      const learnBtn = document.createElement('button');
      learnBtn.className = 'midi-learn-btn';
      learnBtn.textContent = 'Learn';
      learnBtn.addEventListener('click', () => {
        if (learnTarget === paramKey) {
          learnTarget = null;
          learnBtn.textContent = 'Learn';
          learnBtn.classList.remove('learning');
        } else {
          // Clear previous learn state
          midiMapList.querySelectorAll('.midi-learn-btn').forEach(b => {
            b.textContent = 'Learn';
            b.classList.remove('learning');
          });
          learnTarget = paramKey;
          learnBtn.textContent = 'Move a CC…';
          learnBtn.classList.add('learning');
        }
      });

      const clearBtn = document.createElement('button');
      clearBtn.className = 'midi-clear-btn';
      clearBtn.textContent = '✕';
      clearBtn.title = 'Clear mapping';
      clearBtn.addEventListener('click', () => {
        // Remove any mapping pointing to this param
        for (const [cc, param] of Object.entries(mappings)) {
          if (param === paramKey) delete mappings[cc];
        }
        saveMappings(mappings);
        renderMappings();
      });

      row.append(label, ccLabel, learnBtn, clearBtn);
      midiMapList.appendChild(row);
    }
  }

  // --- MIDI message handling ---

  function handleCC(cc, value) {
    // MIDI Learn mode: assign this CC to the waiting param
    if (learnTarget) {
      // Remove old mapping for this CC and any existing mapping to this param
      for (const [existingCC, param] of Object.entries(mappings)) {
        if (param === learnTarget) delete mappings[existingCC];
      }
      mappings[cc] = learnTarget;
      saveMappings(mappings);
      learnTarget = null;
      renderMappings();
      return;
    }

    // Apply CC to mapped parameter
    const paramKey = mappings[cc];
    if (!paramKey) return;
    const def = PARAM_DEFS[paramKey];
    if (!def) return;

    const slider = getSlider(ui, def.el);
    // Map 0-127 to param range
    const scaled = def.min + (value / 127) * (def.max - def.min);
    slider.value = Math.round(scaled);
    slider.dispatchEvent(new Event('input'));
  }

  function onMIDIMessage(e) {
    const [status, cc, value] = e.data;
    // CC messages: status 0xB0-0xBF (channel 1-16)
    if ((status & 0xF0) === 0xB0) {
      handleCC(cc, value);
    }
  }

  function connectInputs() {
    if (!midiAccess) return;
    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = onMIDIMessage;
    }
  }

  // --- Connect / disconnect ---

  midiToggle.addEventListener('click', async () => {
    if (midiAccess) {
      // Disconnect
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
      midiAccess = null;
      midiToggle.textContent = 'Connect';
      midiStatus.textContent = '';
      midiMapList.style.display = 'none';
      return;
    }

    try {
      midiAccess = await navigator.requestMIDIAccess();
      const inputCount = midiAccess.inputs.size;
      midiToggle.textContent = 'Disconnect';
      midiStatus.textContent = `${inputCount} device${inputCount !== 1 ? 's' : ''}`;
      midiMapList.style.display = '';
      connectInputs();
      renderMappings();

      // Handle hot-plugging
      midiAccess.onstatechange = () => {
        connectInputs();
        const count = midiAccess.inputs.size;
        midiStatus.textContent = `${count} device${count !== 1 ? 's' : ''}`;
      };
    } catch (err) {
      midiStatus.textContent = 'MIDI not available';
      console.warn('MIDI access denied:', err);
    }
  });
}
