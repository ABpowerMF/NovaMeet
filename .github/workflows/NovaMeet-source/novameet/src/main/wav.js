// Streams 16 kHz mono audio to a 16-bit PCM WAV file while recording.
'use strict';

const fs = require('fs');

class WavWriter {
  constructor(file, sampleRate = 16000) {
    this.file = file;
    this.sampleRate = sampleRate;
    this.fd = fs.openSync(file, 'w');
    this.bytes = 0;
    fs.writeSync(this.fd, header(0, sampleRate));
  }
  /** @param {Float32Array} samples */
  write(samples) {
    if (this.fd === null) return;
    const buf = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2);
    }
    fs.writeSync(this.fd, buf);
    this.bytes += buf.length;
  }
  get seconds() { return this.bytes / 2 / this.sampleRate; }
  close() {
    if (this.fd === null) return;
    fs.writeSync(this.fd, header(this.bytes, this.sampleRate), 0, 44, 0);
    fs.closeSync(this.fd);
    this.fd = null;
  }
}

function header(dataBytes, sampleRate) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + dataBytes, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(dataBytes, 40);
  return b;
}

module.exports = { WavWriter };
