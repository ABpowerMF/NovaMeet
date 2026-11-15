// Collects 16 kHz mono audio in ~0.5 s blocks and hands them to the page.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(8000);
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data === 'flush') this.flush(true); };
  }
  flush(final) {
    if (this.n) this.port.postMessage(this.buf.slice(0, this.n));
    this.n = 0;
    if (final) this.port.postMessage('flushed');
  }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) {
      const len = ch[0].length;
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let c = 0; c < ch.length; c++) s += ch[c][i];
        this.buf[this.n++] = s / ch.length;
        if (this.n === this.buf.length) this.flush(false);
      }
    }
    return true;
  }
}
registerProcessor('nova-capture', Capture);
