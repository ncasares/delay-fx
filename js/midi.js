// ============================================================
// Delay Workstation — MIDI CC mapping (KORG phase8 tuned)
// ============================================================

const STORAGE_KEY = 'delay-fx-midi-mappings';

// Default mappings tuned for KORG phase8
// phase8 CCs: 12-19=Velocity knobs, 20-27=Envelope, 28=Depth,
//             29=Rate, 30=Air slider, 31=Tempo knob
const DEFAULT_MAPPINGS = {
  31: 'delayTime',   // phase8 TEMPO knob
  30: 'mix',         // phase8 AIR slider
  28: 'tweez',       // phase8 DEPTH
  29: 'tweak',       // phase8 RATE
  12: 'feedback',    // phase8 VELOCITY 1 knob
  13: 'inputGain',   // phase8 VELOCITY 2 knob
  14: 'outputGain',  // phase8 VELOCITY 3 knob
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
  let learnTarget = null;
  let midiAccess = null;

  // --- MIDI Clock tempo detection ---
  // MIDI clock = 24 PPQN (pulses per quarter note)
  const CLOCK_PPQN = 24;
  let clockTimes = [];
  let clockSyncEnabled = true;

  function handleClock(timestamp) {
    clockTimes.push(timestamp);

    // Keep last 48 ticks (2 quarter notes) for stable averaging
    if (clockTimes.length > CLOCK_PPQN * 2) {
      clockTimes.shift();
    }

    // Need at least 24 ticks (1 quarter note) to calculate tempo
    if (clockTimes.length < CLOCK_PPQN) return;

    // Average interval over the last full quarter note
    const recentTicks = clockTimes.slice(-CLOCK_PPQN);
    const totalMs = recentTicks[recentTicks.length - 1] - recentTicks[0];
    const quarterNoteMs = totalMs / (recentTicks.length - 1) * CLOCK_PPQN;

    // Apply subdivision and set delay time
    const subdiv = parseFloat(ui.subdivSelect.value) || 1;
    const delayMs = Math.max(10, Math.min(2000, quarterNoteMs * subdiv));

    ui.time.value = Math.round(delayMs);
    ui.time.dispatchEvent(new Event('input'));
  }

  function handleStart() {
    clockTimes = [];
  }

  function handleStop() {
    clockTimes = [];
  }

  // --- MIDI Learn UI ---
  const midiSection = document.createElement('div');
  midiSection.className = 'midi-section';

  const midiHeader = document.createElement('div');
  midiHeader.className = 'midi-header';
  const midiTitle = document.createElement('span');
  midiTitle.className = 'midi-title';
  midiTitle.textContent = 'MIDI';
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

    // Clock sync toggle row
    const clockRow = document.createElement('div');
    clockRow.className = 'midi-map-row midi-clock-row';
    const clockLabel = document.createElement('span');
    clockLabel.className = 'midi-map-label';
    clockLabel.textContent = 'Clock Sync';
    const clockStatus = document.createElement('span');
    clockStatus.className = 'midi-map-cc';
    clockStatus.textContent = clockSyncEnabled ? 'On' : 'Off';
    const clockToggle = document.createElement('button');
    clockToggle.className = 'midi-learn-btn' + (clockSyncEnabled ? ' learning' : '');
    clockToggle.textContent = clockSyncEnabled ? 'Enabled' : 'Disabled';
    clockToggle.addEventListener('click', () => {
      clockSyncEnabled = !clockSyncEnabled;
      clockTimes = [];
      renderMappings();
    });
    clockRow.append(clockLabel, clockStatus, clockToggle);
    midiMapList.appendChild(clockRow);

    // CC mapping rows
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
    if (learnTarget) {
      for (const [existingCC, param] of Object.entries(mappings)) {
        if (param === learnTarget) delete mappings[existingCC];
      }
      mappings[cc] = learnTarget;
      saveMappings(mappings);
      learnTarget = null;
      renderMappings();
      return;
    }

    const paramKey = mappings[cc];
    if (!paramKey) return;
    const def = PARAM_DEFS[paramKey];
    if (!def) return;

    const slider = getSlider(ui, def.el);
    const scaled = def.min + (value / 127) * (def.max - def.min);
    slider.value = Math.round(scaled);
    slider.dispatchEvent(new Event('input'));
  }

  function onMIDIMessage(e) {
    if (!e.data || e.data.length === 0) return;
    const status = e.data[0];

    // System realtime messages (single byte, no channel)
    if (status === 0xF8 && clockSyncEnabled) {
      handleClock(e.timeStamp);
      return;
    }
    if (status === 0xFA) { handleStart(); return; }
    if (status === 0xFC) { handleStop(); return; }

    // CC messages: 0xB0-0xBF
    if (e.data.length >= 3 && (status & 0xF0) === 0xB0) {
      handleCC(e.data[1], e.data[2]);
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
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
      midiAccess = null;
      midiToggle.textContent = 'Connect';
      midiStatus.textContent = '';
      midiMapList.style.display = 'none';
      clockTimes = [];
      return;
    }

    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      const inputCount = midiAccess.inputs.size;
      midiToggle.textContent = 'Disconnect';
      midiStatus.textContent = `${inputCount} device${inputCount !== 1 ? 's' : ''}`;
      midiMapList.style.display = '';
      connectInputs();
      renderMappings();

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
