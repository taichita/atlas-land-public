// App Server uses JSONL. Never concatenate an unbounded response into a JS
// string: media-heavy history can exceed V8's maximum string length.
export class BoundedLines {
  constructor({ onLine, onOverflow, maxBytes = 16 * 1024 * 1024 }) {
    Object.assign(this, { onLine, onOverflow, maxBytes });
    this.parts = []; this.bytes = 0; this.dropping = false;
  }
  write(chunk) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      if (!this.dropping) {
        const part = chunk.subarray(start, end);
        if (this.bytes + part.length > this.maxBytes) {
          this.parts = []; this.bytes = 0; this.dropping = true;
          this.onOverflow();
        } else if (part.length) {
          this.parts.push(part); this.bytes += part.length;
        }
      }
      if (newline < 0) return;
      const line = this.dropping ? null : Buffer.concat(this.parts, this.bytes).toString('utf8');
      this.parts = []; this.bytes = 0; this.dropping = false;
      if (line) this.onLine(line);
      start = newline + 1;
    }
  }
}
