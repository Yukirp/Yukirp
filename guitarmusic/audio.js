// audio.js
// Microphone setup, pitch extraction and background music playback.

import { autoCorrelate, frequencyToNoteInfo } from "./pitchDetection.js";

export class AudioInput {
  constructor(options = {}) {
    this.fftSize = options.fftSize || 2048;
    this.toleranceCents = options.toleranceCents || 30;
    this.smoothing = options.smoothing || 0.25;
    this.historySize = options.historySize || 5;
    this.throttleMs = options.throttleMs || 40;

    this.freqHistory = [];
    this.smoothedFreq = null;
    this.lastResult = null;
    this.lastProcessTime = 0;

    this.audioContext = null;
    this.analyser = null;
    this.buffer = null;
    this.microphoneStream = null;

    this.backgroundBuffer = null;
    this.backgroundSource = null;
    this.backgroundGain = null;
  }

  async init(options = {}) {
    const enableMicrophone = options.enableMicrophone ?? true;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContext();
    await this.audioContext.resume();

    if (!enableMicrophone) {
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia is not supported in this browser.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    this.microphoneStream = stream;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.buffer = new Float32Array(this.analyser.fftSize);

    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);
  }

  async loadBackgroundTrack(file) {
    if (!this.audioContext) {
      throw new Error("Audio context not initialized.");
    }

    if (!file) {
      throw new Error("No background audio file provided.");
    }

    const fileData = await file.arrayBuffer();
    this.backgroundBuffer = await this.audioContext.decodeAudioData(
      fileData.slice(0)
    );
  }

  playBackgroundTrack(options = {}) {
    if (!this.audioContext || !this.backgroundBuffer) {
      return false;
    }

    const loop = options.loop ?? true;
    const volume = options.volume ?? 0.42;

    this.stopBackgroundTrack();

    const source = this.audioContext.createBufferSource();
    const gain = this.audioContext.createGain();

    source.buffer = this.backgroundBuffer;
    source.loop = loop;

    gain.gain.setValueAtTime(volume, this.audioContext.currentTime);

    source.connect(gain);
    gain.connect(this.audioContext.destination);

    source.onended = () => {
      if (this.backgroundSource === source) {
        this.backgroundSource = null;
      }
    };

    source.start(0);

    this.backgroundSource = source;
    this.backgroundGain = gain;
    return true;
  }

  stopBackgroundTrack() {
    if (!this.backgroundSource) {
      return;
    }

    try {
      this.backgroundSource.stop();
    } catch (_error) {
      // Source may already be stopped.
    }

    this.backgroundSource.disconnect();
    if (this.backgroundGain) {
      this.backgroundGain.disconnect();
    }

    this.backgroundSource = null;
    this.backgroundGain = null;
  }

  playTone(frequency, durationMs = 320, whenMs = 0) {
    if (!this.audioContext) {
      return;
    }

    const now = this.audioContext.currentTime;
    const startTime = now + Math.max(0, whenMs) / 1000;
    const duration = Math.max(80, durationMs) / 1000;

    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.18, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    oscillator.connect(gain);
    gain.connect(this.audioContext.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.02);
  }

  playNote(midi, durationMs = 320, whenMs = 0) {
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    this.playTone(frequency, durationMs, whenMs);
  }

  getPitchInfo() {
    if (!this.analyser || !this.buffer) {
      return null;
    }

    const now = performance.now();
    if (now - this.lastProcessTime < this.throttleMs) {
      return this.lastResult;
    }

    this.lastProcessTime = now;
    this.analyser.getFloatTimeDomainData(this.buffer);

    const result = autoCorrelate(this.buffer, this.audioContext.sampleRate);
    if (!result) {
      this.lastResult = null;
      return null;
    }

    this.freqHistory.push(result.frequency);
    if (this.freqHistory.length > this.historySize) {
      this.freqHistory.shift();
    }

    const sorted = [...this.freqHistory].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    this.smoothedFreq =
      this.smoothedFreq === null
        ? median
        : this.smoothedFreq * (1 - this.smoothing) + median * this.smoothing;

    const noteInfo = frequencyToNoteInfo(this.smoothedFreq);
    const inTune = Math.abs(noteInfo.cents) <= this.toleranceCents;

    this.lastResult = {
      ...noteInfo,
      inTune,
      rms: result.rms,
      confidence: result.confidence,
    };

    return this.lastResult;
  }
}
