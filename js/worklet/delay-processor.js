// ============================================================
// Delay Workstation — AudioWorkletProcessor
// All DSP lives here. Runs on the audio thread.
// ============================================================

// --- Native I/O Ring Buffer (for Electron + PortAudio mode) ---

class RingBuffer {
  constructor(sab, ringSize) {
    this.header = new Int32Array(sab, 0, 2);
    this.data = new Float32Array(sab, 8);
    this.size = ringSize;
    this.mask = ringSize - 1;
  }
  write(samples, count) {
    const wp = Atomics.load(this.header, 0);
    for (let i = 0; i < count; i++) this.data[(wp + i) & this.mask] = samples[i];
    Atomics.store(this.header, 0, (wp + count) & this.mask);
  }
  read(dest, count) {
    const rp = Atomics.load(this.header, 1);
    const wp = Atomics.load(this.header, 0);
    const available = (wp - rp + this.size) & this.mask;
    if (available < count) { for (let i = 0; i < count; i++) dest[i] = 0; return false; }
    for (let i = 0; i < count; i++) dest[i] = this.data[(rp + i) & this.mask];
    Atomics.store(this.header, 1, (rp + count) & this.mask);
    return true;
  }
}

// --- DSP Utilities ---

function hermiteInterpolate(y0, y1, y2, y3, frac) {
  const c0 = y1;
  const c1 = 0.5 * (y2 - y0);
  const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
  const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * frac + c2) * frac + c1) * frac + c0;
}

function readBuffer(buffer, pos, mask) {
  const i = Math.floor(pos);
  const frac = pos - i;
  if (frac < 0.0001) return buffer[i & mask];
  const y0 = buffer[(i - 1) & mask];
  const y1 = buffer[i & mask];
  const y2 = buffer[(i + 1) & mask];
  const y3 = buffer[(i + 2) & mask];
  return hermiteInterpolate(y0, y1, y2, y3, frac);
}

class OnePoleFilter {
  constructor() {
    this.y1 = 0;
  }
  process(x, cutoff, sr) {
    const w = 2 * Math.PI * cutoff / sr;
    const a = Math.exp(-w);
    this.y1 = x * (1 - a) + this.y1 * a;
    return this.y1;
  }
  reset() { this.y1 = 0; }
}

class BiquadFilterDSP {
  constructor() {
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
  }

  setBandpass(freq, Q, sr) {
    const w0 = 2 * Math.PI * freq / sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = -2 * Math.cos(w0) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  setLowpass(freq, Q, sr) {
    const w0 = 2 * Math.PI * freq / sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosW = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 - cosW) / 2 / a0;
    this.b1 = (1 - cosW) / a0;
    this.b2 = (1 - cosW) / 2 / a0;
    this.a1 = -2 * cosW / a0;
    this.a2 = (1 - alpha) / a0;
  }

  setHighpass(freq, Q, sr) {
    const w0 = 2 * Math.PI * freq / sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const cosW = Math.cos(w0);
    const a0 = 1 + alpha;
    this.b0 = (1 + cosW) / 2 / a0;
    this.b1 = -(1 + cosW) / a0;
    this.b2 = (1 + cosW) / 2 / a0;
    this.a1 = -2 * cosW / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
            - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }

  reset() {
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }
}

class LFO {
  constructor() {
    this.phase = 0;
  }
  process(rate, sr) {
    const out = Math.sin(this.phase);
    this.phase += 2 * Math.PI * rate / sr;
    if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    return out;
  }
  reset() { this.phase = 0; }
}

class EnvelopeFollower {
  constructor() {
    this.env = 0;
  }
  process(input, attackMs, releaseMs, sr) {
    const abs = Math.abs(input);
    const attackCoeff = 1 - Math.exp(-1 / (attackMs * sr / 1000));
    const releaseCoeff = 1 - Math.exp(-1 / (releaseMs * sr / 1000));
    const coeff = abs > this.env ? attackCoeff : releaseCoeff;
    this.env += coeff * (abs - this.env);
    return this.env;
  }
  reset() { this.env = 0; }
}

function tanhSaturate(x, drive) {
  return Math.tanh(x * drive);
}

// --- Processor ---

class DelayProcessor extends AudioWorkletProcessor {

  static get parameterDescriptors() {
    return [
      { name: 'delayTime',  defaultValue: 500,  minValue: 10,   maxValue: 2000, automationRate: 'k-rate' },
      { name: 'feedback',   defaultValue: 0.3,  minValue: 0,    maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'mix',        defaultValue: 0.5,  minValue: 0,    maxValue: 1.0,  automationRate: 'k-rate' },
      { name: 'tweak',      defaultValue: 0.5,  minValue: 0,    maxValue: 1.0,  automationRate: 'k-rate' },
      { name: 'tweez',      defaultValue: 0.5,  minValue: 0,    maxValue: 1.0,  automationRate: 'k-rate' },
      { name: 'inputGain',  defaultValue: 1.0,  minValue: 0,    maxValue: 2.0,  automationRate: 'k-rate' },
      { name: 'outputGain', defaultValue: 1.0,  minValue: 0,    maxValue: 2.0,  automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super(options);

    const sr = sampleRate;

    // Power-of-2 buffer covering 2s
    const maxSamples = Math.ceil(sr * 2.0);
    this.bufferSize = 1;
    while (this.bufferSize < maxSamples) this.bufferSize <<= 1;
    this.mask = this.bufferSize - 1;

    // Circular buffers (L and R for stereo)
    this.bufferL = new Float32Array(this.bufferSize);
    this.bufferR = new Float32Array(this.bufferSize);
    this.writePos = 0;

    // Smoothed delay time (in samples) for slew-rate limiting
    this.smoothedDelay = 500 * sr / 1000;

    // Algorithm state
    this.algorithm = 'clean';
    this.bypass = false;
    this.bypassGain = 0; // 0 = not bypassed, 1 = bypassed (for crossfade)

    // Per-algorithm DSP objects
    // Clean Digital
    this.cleanLP = new OnePoleFilter();

    // Tape Echo
    this.tapeLFO1 = new LFO();
    this.tapeLFO2 = new LFO();
    this.tapeLP = new OnePoleFilter();

    // Analog BBD
    this.bbdBP = new BiquadFilterDSP();
    this.bbdHP = new BiquadFilterDSP();

    // Modulated
    this.modLFO = new LFO();

    // Reverse
    this.revGrainA = new Float32Array(this.bufferSize);
    this.revGrainB = new Float32Array(this.bufferSize);
    this.revWritePos = 0;
    this.revReadPos = 0;
    this.revGrainLen = 0;
    this.revActiveGrain = 'A'; // which grain is currently playing back
    this.revFillCount = 0;

    // Ping Pong (uses bufferL and bufferR as L/R delay lines)
    this.ppFilterL = new OnePoleFilter();
    this.ppFilterR = new OnePoleFilter();

    // Ducking
    this.duckEnv = new EnvelopeFollower();
    this.duckLP = new OnePoleFilter();

    // Crossfade state for algorithm switching
    this.crossfading = false;
    this.crossfadePos = 0;
    this.crossfadeLen = 0;
    this.prevAlgorithm = 'clean';

    // --- Looper ---
    this.loopState = 'empty'; // empty, recording, playing, overdubbing, stopped
    this.loopBuffer = null;   // lazy allocation
    this.undoBuffer = null;
    this.loopLength = 0;
    this.loopPlayhead = 0;
    this.loopRecordHead = 0;
    this.loopFadeGain = 0.95;
    this.loopPlaybackRate = 1.0;
    this.loopDirection = 1;
    this.loopOneShot = false;
    this.loopHalfSpeed = false;
    this.loopReverse = false;
    this.loopHasUndo = false;
    this.maxLoopSamples = Math.ceil(sr * 120);
    this._loopStateCounter = 0;
    this._loopStateInterval = Math.floor(sr * 0.05); // ~50ms

    // Native I/O (Electron + PortAudio)
    this.nativeInputRing = null;
    this.nativeOutputRing = null;
    this._nativeInputBuf = new Float32Array(128);

    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  handleMessage(data) {
    if (data.type === 'setAlgorithm') {
      if (data.value !== this.algorithm) {
        this.prevAlgorithm = this.algorithm;
        this.algorithm = data.value;
        this.crossfading = true;
        this.crossfadePos = 0;
        this.crossfadeLen = Math.floor(sampleRate * 0.05);
      }
    } else if (data.type === 'setBypass') {
      this.bypass = data.value;
    } else if (data.type === 'looperAllocate') {
      if (!this.loopBuffer) {
        this.loopBuffer = new Float32Array(this.maxLoopSamples);
        this.undoBuffer = new Float32Array(this.maxLoopSamples);
      }
    } else if (data.type === 'looperRecord') {
      this._looperToggleRecord();
    } else if (data.type === 'looperPlayStop') {
      this._looperTogglePlayStop();
    } else if (data.type === 'looperClear') {
      this._looperClear();
    } else if (data.type === 'looperUndo') {
      this._looperUndo();
    } else if (data.type === 'looperHalfSpeed') {
      this.loopHalfSpeed = !this.loopHalfSpeed;
      this.loopPlaybackRate = this.loopHalfSpeed ? 0.5 : 1.0;
    } else if (data.type === 'looperReverse') {
      this.loopReverse = !this.loopReverse;
      this.loopDirection = this.loopReverse ? -1 : 1;
    } else if (data.type === 'looperPlayOnce') {
      if (this.loopLength > 0 && this.loopState !== 'recording') {
        this.loopOneShot = true;
        this.loopPlayhead = 0;
        this.loopState = 'playing';
        this._sendLoopState();
      }
    } else if (data.type === 'setNativeIO') {
      this.nativeInputRing = new RingBuffer(data.inputSAB, data.ringSize);
      this.nativeOutputRing = new RingBuffer(data.outputSAB, data.ringSize);
    }
  }

  _looperToggleRecord() {
    if (!this.loopBuffer) return;
    if (this.loopState === 'empty') {
      this.loopRecordHead = 0;
      this.loopState = 'recording';
    } else if (this.loopState === 'recording') {
      this.loopLength = this.loopRecordHead;
      this.loopPlayhead = 0;
      this.loopState = this.loopLength > 0 ? 'playing' : 'empty';
    } else if (this.loopState === 'playing' || this.loopState === 'stopped') {
      // Enter overdub — snapshot for undo
      this.undoBuffer.set(this.loopBuffer.subarray(0, this.loopLength));
      this.loopHasUndo = true;
      if (this.loopState === 'stopped') this.loopPlayhead = 0;
      this.loopState = 'overdubbing';
    } else if (this.loopState === 'overdubbing') {
      this.loopState = 'playing';
    }
    this._sendLoopState();
  }

  _looperTogglePlayStop() {
    if (this.loopLength === 0) return;
    if (this.loopState === 'playing' || this.loopState === 'overdubbing') {
      this.loopState = 'stopped';
      this.loopOneShot = false;
    } else if (this.loopState === 'stopped') {
      this.loopPlayhead = 0;
      this.loopState = 'playing';
    }
    this._sendLoopState();
  }

  _looperClear() {
    this.loopState = 'empty';
    this.loopLength = 0;
    this.loopPlayhead = 0;
    this.loopRecordHead = 0;
    this.loopHasUndo = false;
    this.loopOneShot = false;
    this.loopHalfSpeed = false;
    this.loopReverse = false;
    this.loopPlaybackRate = 1.0;
    this.loopDirection = 1;
    this._sendLoopState();
  }

  _looperUndo() {
    if (!this.loopHasUndo || this.loopLength === 0) return;
    // Swap buffers
    const tmp = this.loopBuffer;
    this.loopBuffer = this.undoBuffer;
    this.undoBuffer = tmp;
    if (this.loopState === 'overdubbing') this.loopState = 'playing';
    this._sendLoopState();
  }

  _readLoop(pos) {
    // Hermite interpolation for fractional positions (half-speed)
    const len = this.loopLength;
    const i = Math.floor(pos);
    const frac = pos - i;
    if (frac < 0.0001) return this.loopBuffer[((i % len) + len) % len];
    const wrap = (idx) => ((idx % len) + len) % len;
    const y0 = this.loopBuffer[wrap(i - 1)];
    const y1 = this.loopBuffer[wrap(i)];
    const y2 = this.loopBuffer[wrap(i + 1)];
    const y3 = this.loopBuffer[wrap(i + 2)];
    return hermiteInterpolate(y0, y1, y2, y3, frac);
  }

  _wrapLoopPlayhead() {
    if (this.loopPlayhead >= this.loopLength) {
      if (this.loopOneShot) {
        this.loopState = 'stopped';
        this.loopOneShot = false;
        this._sendLoopState();
      }
      this.loopPlayhead -= this.loopLength;
    }
    if (this.loopPlayhead < 0) {
      this.loopPlayhead += this.loopLength;
    }
  }

  _sendLoopState() {
    this.port.postMessage({
      type: 'looperState',
      state: this.loopState,
      loopLength: this.loopState === 'recording' ? this.loopRecordHead : this.loopLength,
      playhead: this.loopPlayhead,
      recordHead: this.loopRecordHead,
      maxLength: this.maxLoopSamples,
      sampleRate: sampleRate,
      hasUndo: this.loopHasUndo,
      halfSpeed: this.loopHalfSpeed,
      reverse: this.loopReverse,
    });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    const outL = output[0];
    const outR = output[1] || output[0];

    // Native I/O: read from PortAudio ring buffer instead of Web Audio input
    let inp;
    if (this.nativeInputRing) {
      this.nativeInputRing.read(this._nativeInputBuf, 128);
      inp = this._nativeInputBuf;
    } else {
      if (!input || !input[0]) return true;
      inp = input[0];
    }

    const delayTimeMs = parameters.delayTime[0];
    const feedback    = parameters.feedback[0];
    const mix         = parameters.mix[0];
    const tweak       = parameters.tweak[0];
    const tweez       = parameters.tweez[0];
    const inputGain   = parameters.inputGain[0];
    const outputGain  = parameters.outputGain[0];
    const sr          = sampleRate;

    const targetDelay = delayTimeMs * sr / 1000;

    for (let i = 0; i < inp.length; i++) {
      const sample = inp[i] * inputGain;

      // Smooth delay time (one-pole, ~10ms time constant)
      this.smoothedDelay += 0.003 * (targetDelay - this.smoothedDelay);

      // Compute wet signal from current algorithm
      let wetL = 0, wetR = 0;

      if (this.crossfading) {
        // Run both algorithms during crossfade
        const [pL, pR, pFb] = this.processAlgorithm(this.prevAlgorithm, sample, feedback, tweak, tweez, sr);
        const [cL, cR, cFb] = this.processAlgorithm(this.algorithm, sample, feedback, tweak, tweez, sr);

        const t = this.crossfadePos / this.crossfadeLen;
        const fadeOut = Math.cos(t * Math.PI * 0.5);
        const fadeIn  = Math.sin(t * Math.PI * 0.5);

        wetL = pL * fadeOut + cL * fadeIn;
        wetR = pR * fadeOut + cR * fadeIn;

        // Write blended feedback to buffer (skip if ping pong manages its own)
        if (this.algorithm !== 'pingpong' && this.prevAlgorithm !== 'pingpong') {
          const fbSample = pFb * fadeOut + cFb * fadeIn;
          this.writeToBuffer(sample, fbSample, feedback);
        }

        this.crossfadePos++;
        if (this.crossfadePos >= this.crossfadeLen) {
          this.crossfading = false;
        }
      } else {
        const [wL, wR, fbSample] = this.processAlgorithm(this.algorithm, sample, feedback, tweak, tweez, sr);
        wetL = wL;
        wetR = wR;
        // Ping Pong writes its own buffers; skip for others that return null fb
        if (this.algorithm !== 'pingpong') {
          this.writeToBuffer(sample, fbSample, feedback);
        }
      }

      // Bypass crossfade
      const bypassTarget = this.bypass ? 1 : 0;
      this.bypassGain += 0.002 * (bypassTarget - this.bypassGain);

      // Mix dry/wet
      const dry = 1 - mix;
      const effectiveWetMix = mix * (1 - this.bypassGain);
      const mL = dry * sample + effectiveWetMix * wetL;
      const mR = dry * sample + effectiveWetMix * wetR;

      // --- Looper ---
      let loopOut = 0;
      if (this.loopBuffer) {
        if (this.loopState === 'recording') {
          this.loopBuffer[this.loopRecordHead] = mL;
          this.loopRecordHead++;
          if (this.loopRecordHead >= this.maxLoopSamples) {
            this.loopLength = this.loopRecordHead;
            this.loopPlayhead = 0;
            this.loopState = 'playing';
            this._sendLoopState();
          }
        } else if (this.loopState === 'playing') {
          loopOut = this._readLoop(this.loopPlayhead);
          this.loopPlayhead += this.loopPlaybackRate * this.loopDirection;
          this._wrapLoopPlayhead();
        } else if (this.loopState === 'overdubbing') {
          loopOut = this._readLoop(this.loopPlayhead);
          const idx = ((Math.floor(this.loopPlayhead) % this.loopLength) + this.loopLength) % this.loopLength;
          this.loopBuffer[idx] = this.loopBuffer[idx] * this.loopFadeGain + mL;
          this.loopPlayhead += this.loopPlaybackRate * this.loopDirection;
          this._wrapLoopPlayhead();
        }

        // Throttled state reporting
        this._loopStateCounter++;
        if (this._loopStateCounter >= this._loopStateInterval) {
          this._loopStateCounter = 0;
          this._sendLoopState();
        }
      }

      const finalL = (mL + loopOut) * outputGain;
      const finalR = (mR + loopOut) * outputGain;

      outL[i] = isFinite(finalL) ? finalL : 0;
      outR[i] = isFinite(finalR) ? finalR : 0;

      this.writePos = (this.writePos + 1) & this.mask;
    }

    // Native I/O: write output to PortAudio ring buffer
    if (this.nativeOutputRing) {
      this.nativeOutputRing.write(outL, outL.length);
    }

    return true;
  }

  writeToBuffer(input, processed, feedback) {
    const toWrite = input + feedback * processed;
    const safe = isFinite(toWrite) ? toWrite : 0;
    this.bufferL[this.writePos & this.mask] = safe;
    this.bufferR[this.writePos & this.mask] = safe;
  }

  // Returns [wetL, wetR, feedbackSample]
  processAlgorithm(algo, sample, feedback, tweak, tweez, sr) {
    switch (algo) {
      case 'clean':     return this.processClean(sample, tweak, tweez, sr);
      case 'tape':      return this.processTape(sample, feedback, tweak, tweez, sr);
      case 'analog':    return this.processAnalog(sample, feedback, tweak, tweez, sr);
      case 'modulated': return this.processModulated(sample, tweak, tweez, sr);
      case 'reverse':   return this.processReverse(sample, feedback, tweak, tweez, sr);
      case 'pingpong':  return this.processPingPong(sample, feedback, tweak, tweez, sr);
      case 'ducking':   return this.processDucking(sample, feedback, tweak, tweez, sr);
      default:          return this.processClean(sample, tweak, tweez, sr);
    }
  }

  // ---- CLEAN DIGITAL ----
  processClean(sample, tweak, tweez, sr) {
    const delay = this.smoothedDelay;
    const readPos = this.writePos - delay + this.bufferSize;

    // Read L channel
    const delayedL = readBuffer(this.bufferL, readPos, this.mask);

    // Tone: one-pole LP in feedback path (tweak: 0→800Hz, 1→18kHz)
    const cutoff = 800 + tweak * 17200;
    const filteredL = this.cleanLP.process(delayedL, cutoff, sr);

    // Stereo spread: R channel reads with slight offset (tweez: 0→mono, 1→10% offset)
    const spreadOffset = tweez * 0.1 * delay;
    const readPosR = readPos - spreadOffset;
    const delayedR = readBuffer(this.bufferR, readPosR + this.bufferSize, this.mask);

    return [filteredL, delayedR, filteredL];
  }

  // ---- TAPE ECHO ----
  processTape(sample, feedback, tweak, tweez, sr) {
    // Saturation drive: tweak 0→1.0, 1→5.0
    const drive = 1.0 + tweak * 4.0;

    // Wow & flutter: tweez controls depth (0→0, 1→3ms)
    const flutterDepthSamples = tweez * 3.0 * sr / 1000;
    // Two LFOs at different rates for organic feel
    const lfo1 = this.tapeLFO1.process(1.2, sr);
    const lfo2 = this.tapeLFO2.process(0.37, sr);
    const lfoMod = (lfo1 * 0.7 + lfo2 * 0.3) * flutterDepthSamples;

    const delay = this.smoothedDelay;
    const readPos = this.writePos - delay + lfoMod + this.bufferSize;
    const delayed = readBuffer(this.bufferL, readPos, this.mask);

    // LP filter in feedback: darkening (3kHz-6kHz range, tied to tweak)
    const lpCutoff = 3000 + (1 - tweak) * 3000;
    const filtered = this.tapeLP.process(delayed, lpCutoff, sr);

    // Saturation
    const saturated = tanhSaturate(filtered, drive);

    return [saturated, saturated, saturated];
  }

  // ---- ANALOG BBD ----
  processAnalog(sample, feedback, tweak, tweez, sr) {
    const delay = this.smoothedDelay;
    const readPos = this.writePos - delay + this.bufferSize;
    const delayed = readBuffer(this.bufferL, readPos, this.mask);

    // Bandpass: tweak controls character (Q: 0.5 to 8.0)
    const bpQ = 0.5 + tweak * 7.5;
    // Tweez controls resonance emphasis (center freq shift)
    const bpFreq = 1000 + tweez * 2000;
    this.bbdBP.setBandpass(bpFreq, bpQ, sr);
    const bpOut = this.bbdBP.process(delayed);

    // Highpass to prevent low-end buildup
    this.bbdHP.setHighpass(80, 0.707, sr);
    const hpOut = this.bbdHP.process(bpOut);

    // Subtle noise injection (very low level)
    const noise = (Math.random() * 2 - 1) * 0.002;
    const result = hpOut + noise;

    return [result, result, result];
  }

  // ---- MODULATED ----
  processModulated(sample, tweak, tweez, sr) {
    // Tweak: mod rate 0.1-5Hz
    const rate = 0.1 + tweak * 4.9;
    // Tweez: mod depth 0-15ms
    const depthSamples = tweez * 15.0 * sr / 1000;

    const lfo = this.modLFO.process(rate, sr);
    const modOffset = lfo * depthSamples;

    const delay = this.smoothedDelay;
    const readPos = this.writePos - delay + modOffset + this.bufferSize;
    const delayed = readBuffer(this.bufferL, readPos, this.mask);

    return [delayed, delayed, delayed];
  }

  // ---- REVERSE ----
  processReverse(sample, feedback, tweak, tweez, sr) {
    // Tweak: chunk size 50ms-500ms
    const chunkMs = 50 + tweak * 450;
    const chunkSamples = Math.floor(chunkMs * sr / 1000);
    // Tweez: crossfade 1ms-50ms
    const xfadeMs = 1 + tweez * 49;
    const xfadeSamples = Math.floor(xfadeMs * sr / 1000);

    // Initialize grain length if needed
    if (this.revGrainLen !== chunkSamples) {
      this.revGrainLen = chunkSamples;
    }

    // Write input to current fill grain
    const fillGrain = this.revActiveGrain === 'A' ? this.revGrainB : this.revGrainA;
    fillGrain[this.revFillCount] = sample;

    // Read from playback grain (reversed)
    const playGrain = this.revActiveGrain === 'A' ? this.revGrainA : this.revGrainB;
    const playLen = Math.min(this.revGrainLen, playGrain.length);
    const readIdx = playLen - 1 - this.revReadPos;
    let out = 0;
    if (readIdx >= 0 && readIdx < playLen) {
      out = playGrain[readIdx];
    }

    // Crossfade near boundaries
    if (this.revReadPos < xfadeSamples && this.revReadPos >= 0) {
      const fade = this.revReadPos / Math.max(1, xfadeSamples);
      out *= fade;
    }

    this.revFillCount++;
    this.revReadPos++;

    // Swap grains when chunk is done
    if (this.revFillCount >= this.revGrainLen || this.revReadPos >= this.revGrainLen) {
      this.revActiveGrain = this.revActiveGrain === 'A' ? 'B' : 'A';
      this.revFillCount = 0;
      this.revReadPos = 0;
    }

    // Also write to main buffer for feedback
    return [out, out, out];
  }

  // ---- PING PONG ----
  processPingPong(sample, feedback, tweak, tweez, sr) {
    const delay = this.smoothedDelay;

    // Read from L and R delay lines
    const readPosL = this.writePos - delay + this.bufferSize;
    const readPosR = this.writePos - delay + this.bufferSize;
    const delayedL = readBuffer(this.bufferL, readPosL, this.mask);
    const delayedR = readBuffer(this.bufferR, readPosR, this.mask);

    // Tweak: stereo width (0=mono, 1=hard pan)
    const width = tweak;

    // Tweez: high-cut on repeats (500Hz-20kHz)
    const hcCutoff = 500 + tweez * 19500;
    const filtL = this.ppFilterL.process(delayedL, hcCutoff, sr);
    const filtR = this.ppFilterR.process(delayedR, hcCutoff, sr);

    // Cross-feed: L output goes to R input and vice versa
    // Write to buffers: L gets input + feedback*R, R gets feedback*L
    const writeL = sample + feedback * filtR;
    const writeR = feedback * filtL;

    const safeL = isFinite(writeL) ? writeL : 0;
    const safeR = isFinite(writeR) ? writeR : 0;
    this.bufferL[this.writePos & this.mask] = safeL;
    this.bufferR[this.writePos & this.mask] = safeR;

    // Pan: at width=0, both channels get (L+R)/2. At width=1, full separation.
    const mono = (filtL + filtR) * 0.5;
    const outL = mono + (filtL - mono) * width;
    const outR = mono + (filtR - mono) * width;

    // Return wet signal (feedback already written to buffers)
    return [outL, outR, 0]; // 0 because we wrote to buffers directly
  }

  // ---- DUCKING ----
  processDucking(sample, feedback, tweak, tweez, sr) {
    const delay = this.smoothedDelay;
    const readPos = this.writePos - delay + this.bufferSize;
    const delayed = readBuffer(this.bufferL, readPos, this.mask);

    // Tone filter on repeats
    const filtered = this.duckLP.process(delayed, 8000, sr);

    // Envelope follower on dry input
    const env = this.duckEnv.process(sample, 1, 50, sr);

    // Tweak: threshold (-60dB to 0dB → linear 0.001 to 1.0)
    const threshDB = -60 + tweak * 60;
    const threshold = Math.pow(10, threshDB / 20);

    // Tweez: release time 50ms-2000ms
    const releaseMs = 50 + tweez * 1950;

    // Duck amount: reduce wet when input is above threshold
    let duckGain = 1.0;
    if (env > threshold) {
      duckGain = Math.max(0, threshold / (env + 0.0001));
    }

    // Smooth the duck gain with release time
    // (simple one-pole with asymmetric attack/release)
    const attackCoeff = 1 - Math.exp(-1 / (5 * sr / 1000)); // 5ms attack
    const releaseCoeff = 1 - Math.exp(-1 / (releaseMs * sr / 1000));
    if (!this._duckSmoothed) this._duckSmoothed = 1;
    const coeff = duckGain < this._duckSmoothed ? attackCoeff : releaseCoeff;
    this._duckSmoothed += coeff * (duckGain - this._duckSmoothed);

    const duckedL = filtered * this._duckSmoothed;
    const duckedR = filtered * this._duckSmoothed;

    return [duckedL, duckedR, filtered];
  }
}

registerProcessor('delay-processor', DelayProcessor);
