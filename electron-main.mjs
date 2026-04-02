import { app, BrowserWindow, protocol, net, session, ipcMain } from 'electron';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let portaudio = null;

let mainWindow = null;
let audioStream = null;

app.whenReady().then(async () => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    if (!filePath || filePath === '/') filePath = '/index.html';
    const fullPath = path.join(__dirname, filePath);
    return net.fetch(pathToFileURL(fullPath).toString());
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'midi' || permission === 'midiSysex') {
      callback(true);
    } else {
      callback(false);
    }
  });
  session.defaultSession.setDevicePermissionHandler(() => true);

  // --- PortAudio IPC (naudiodon loaded later when needed) ---
  ipcMain.handle('audio:getDevices', () => {
    if (!portaudio) return [];
    return portaudio.getDevices();
  });

  ipcMain.handle('audio:start', (event, config) => {
    if (!portaudio) throw new Error('naudiodon not available');
    if (audioStream) {
      try { audioStream.quit(); } catch {}
      audioStream = null;
    }

    const ringSize = 8192;
    const headerBytes = 8;
    const dataBytes = ringSize * 4;
    const inputSAB = new SharedArrayBuffer(headerBytes + dataBytes);
    const outputSAB = new SharedArrayBuffer(headerBytes + dataBytes);

    new Int32Array(inputSAB, 0, 2).fill(0);
    new Int32Array(outputSAB, 0, 2).fill(0);

    const inputHeader = new Int32Array(inputSAB, 0, 2);
    const inputData = new Float32Array(inputSAB, headerBytes);
    const outputHeader = new Int32Array(outputSAB, 0, 2);
    const outputData = new Float32Array(outputSAB, headerBytes);

    const inChL = config.inputChannelL ?? 2;
    const inChR = config.inputChannelR ?? 3;
    const outChL = config.outputChannelL ?? 0;
    const outChR = config.outputChannelR ?? 1;

    const device = portaudio.getDevices().find(d => d.id === config.deviceId);
    if (!device) throw new Error(`Device ${config.deviceId} not found`);

    const maxInCh = Math.max(inChL, inChR) + 1;
    const maxOutCh = Math.max(outChL, outChR) + 1;
    const sr = config.sampleRate || 48000;
    const fpb = config.framesPerBuffer || 128;

    const inChCount = Math.min(maxInCh, device.maxInputChannels);
    const outChCount = Math.min(maxOutCh, device.maxOutputChannels);

    audioStream = new portaudio.AudioIO({
      inOptions: {
        channelCount: inChCount,
        sampleFormat: portaudio.SampleFormatFloat32,
        sampleRate: sr,
        deviceId: config.deviceId,
        framesPerBuffer: fpb,
      },
      outOptions: {
        channelCount: outChCount,
        sampleFormat: portaudio.SampleFormatFloat32,
        sampleRate: sr,
        deviceId: config.deviceId,
        framesPerBuffer: fpb,
      }
    });

    audioStream.on('data', (buffer) => {
      const floats = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
      const frames = floats.length / inChCount;
      const writePos = Atomics.load(inputHeader, 0);

      for (let f = 0; f < frames; f++) {
        const l = inChL < inChCount ? floats[f * inChCount + inChL] : 0;
        const r = inChR < inChCount ? floats[f * inChCount + inChR] : 0;
        const mono = (l + r) * 0.5;
        inputData[(writePos + f) & (ringSize - 1)] = mono;
      }
      Atomics.store(inputHeader, 0, (writePos + frames) & (ringSize - 1));
    });

    const outputTimer = setInterval(() => {
      if (!audioStream) { clearInterval(outputTimer); return; }

      const readPos = Atomics.load(outputHeader, 1);
      const writePos = Atomics.load(outputHeader, 0);
      let available = (writePos - readPos + ringSize) & (ringSize - 1);
      if (available < fpb) return;

      const outBuf = Buffer.alloc(fpb * outChCount * 4);
      const outFloats = new Float32Array(outBuf.buffer);

      for (let f = 0; f < fpb; f++) {
        const sample = outputData[(readPos + f) & (ringSize - 1)];
        for (let c = 0; c < outChCount; c++) {
          outFloats[f * outChCount + c] = (c === outChL || c === outChR) ? sample : 0;
        }
      }
      Atomics.store(outputHeader, 1, (readPos + fpb) & (ringSize - 1));

      try { audioStream.write(outBuf); } catch {}
    }, (fpb / sr) * 1000 * 0.5);

    audioStream.start();

    return { inputSAB, outputSAB, ringSize, sampleRate: sr };
  });

  ipcMain.handle('audio:stop', () => {
    if (audioStream) {
      try { audioStream.quit(); } catch {}
      audioStream = null;
    }
  });

  // --- Create window ---
  mainWindow = new BrowserWindow({
    width: 820,
    height: 950,
    minWidth: 700,
    minHeight: 800,
    backgroundColor: '#080808',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'electron-preload.js'),
    }
  });

  mainWindow.loadURL('app://delaystation/');

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.alt && input.key === 'i') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    if (audioStream) {
      try { audioStream.quit(); } catch {}
      audioStream = null;
    }
    mainWindow = null;
  });
});

app.on('window-all-closed', () => app.quit());
