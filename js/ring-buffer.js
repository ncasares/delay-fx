// ============================================================
// Lock-free SPSC ring buffer over SharedArrayBuffer
// Used to bridge audio between Electron main process (PortAudio)
// and AudioWorklet processor.
//
// Layout: [writePos (Int32), readPos (Int32), ...float32 data]
// ============================================================

class RingBuffer {
  /**
   * @param {SharedArrayBuffer} sab - The shared buffer
   * @param {number} ringSize - Number of float32 samples in the ring
   */
  constructor(sab, ringSize) {
    this.header = new Int32Array(sab, 0, 2); // [writePos, readPos]
    this.data = new Float32Array(sab, 8);    // audio data after 8-byte header
    this.size = ringSize;
    this.mask = ringSize - 1;
  }

  /** Producer: write samples into the ring */
  write(samples, count) {
    const wp = Atomics.load(this.header, 0);
    for (let i = 0; i < count; i++) {
      this.data[(wp + i) & this.mask] = samples[i];
    }
    Atomics.store(this.header, 0, (wp + count) & this.mask);
  }

  /** Consumer: read samples from the ring into dest array */
  read(dest, count) {
    const rp = Atomics.load(this.header, 1);
    const wp = Atomics.load(this.header, 0);
    const available = (wp - rp + this.size) & this.mask;

    if (available < count) {
      // Not enough data — fill with silence
      for (let i = 0; i < count; i++) dest[i] = 0;
      return false;
    }

    for (let i = 0; i < count; i++) {
      dest[i] = this.data[(rp + i) & this.mask];
    }
    Atomics.store(this.header, 1, (rp + count) & this.mask);
    return true;
  }

  /** How many samples are available to read */
  available() {
    const rp = Atomics.load(this.header, 1);
    const wp = Atomics.load(this.header, 0);
    return (wp - rp + this.size) & this.mask;
  }
}

// Export for both ES modules (worklet) and CommonJS (if needed)
if (typeof globalThis.registerProcessor !== 'undefined') {
  // Inside AudioWorklet scope — make available globally
  globalThis.RingBuffer = RingBuffer;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RingBuffer };
}
