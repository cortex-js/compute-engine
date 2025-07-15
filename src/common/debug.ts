import { SignalOrigin } from './signals';
import { terminal } from './terminal';
const LINEBREAK = /\r\n|[\n\r\u2028\u2029]/;

export class Origin {
  url: string;
  source: string;
  _lines: string[];
  _lineOffsets: number[];

  constructor(source: string, url?: string) {
    this.source = source;
    this.url = url ?? '';
  }

  get lines(): string[] {
    if (!this._lines) this._lines = this.source.split(LINEBREAK);
    return this._lines;
  }

  get lineOffsets(): number[] {
    if (this._lineOffsets == null) {
      const offsets: number[] = [];
      const text = this.source;
      let isLineStart = true;
      let i = 0;
      while (i < text.length) {
        if (isLineStart) {
          offsets.push(i);
          isLineStart = false;
        }
        const ch = text.charCodeAt(i);
        isLineStart = ch === 13 || ch === 10 || ch === 0x2028 || ch === 0x2029;
        if (ch === 13 && i + 1 < text.length && text.charCodeAt(i + 1) === 10) {
          i++;
        }
        i++;
      }
      if (isLineStart && text.length > 0) offsets.push(text.length);
      this._lineOffsets = offsets;
    }
    return this._lineOffsets;
  }

  getLinecol(offset: number): [line: number, col: number] {
    offset = Math.max(Math.min(offset, this.source.length), 0);

    const lineOffsets = this.lineOffsets;
    let low = 0;
    let high = lineOffsets.length;
    if (high === 0) return [1, offset + 1];
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (lineOffsets[mid] > offset) high = mid;
      else low = mid + 1;
    }
    return [low, offset - lineOffsets[low - 1] + 1];
  }

  signalOrigin(offset: number): SignalOrigin {
    const [line, column] = this.getLinecol(offset);
    return {
      url: this.url,
      source: this.source,
      offset: offset,
      line,
      column,
      around: this.sourceAround(line, column),
    };
  }

  chalkGutter(s: string): string {
    return terminal.renderSpan({ content: s, weight: 'thin' });
  }

  chalkMarker(s: string): string {
    return terminal.renderSpan({ content: s, fg: 'red' });
  }
  chalkMessage(s: string): string {
    return terminal.renderSpan({ content: s, fg: 'red' });
  }

  /** line: 1..., column: 1... */
  sourceAround(line: number, column: number, message?: string): string {
    const linesAbove = 2;
    const linesBelow = 3;
    const start = Math.max(line - 1 - (linesAbove + 1), 0);
    const end = Math.min(this.lines.length, line + linesBelow) - 1;

    const hasColumn = typeof column === 'number';
    const numberMaxWidth = String(end).length;
    const result: string[] = [];
    // index = 0..., start = 0... end = 0...
    for (let index = start; index <= end; index++) {
      const paddedNumber = ` ${index + 1}`.slice(-numberMaxWidth);
      const gutter = ` ${paddedNumber} \u2506 `;
      let markerLine = '';
      if (index === line - 1) {
        if (hasColumn) {
          const markerSpacing = this.lines[index]
            .slice(0, Math.max(column - 1, 0))
            .replace(/[^\t]/g, ' ');
          ((markerLine = '\n ' + this.chalkGutter(gutter.replace(/\d/g, ' '))),
            markerSpacing,
            this.chalkMarker('^'));

          if (message) {
            markerLine += ' ' + this.chalkMessage(message);
          }
        } else if (message) {
          markerLine =
            '\n' + this.chalkGutter(gutter.replace(/\d/g, ' ')) + message;
        }
        result.push(
          [
            this.chalkMarker('>'),
            this.chalkGutter(gutter),
            this.lines[index],
            markerLine,
          ].join('')
        );
      } else {
        result.push(` ${this.chalkGutter(gutter)}${this.lines[index]}`);
      }
    }
    return terminal.renderBlock({
      tag: 'block',
      spans: result.map((line) => ({ content: line + '\n' })),
    });
    /**
  1111 |     expect(
    12 |       rawExpression('\\sqrt{(1+x_0)}=\\frac{\\pi^2}{2}')
  > 13 |     ).toMatchInlineSnapshot(
       |       ^
    14 |       `'["Latex","\\\\sqrt","<{>","(",1,"+","x","_",0,")","<}>","=","\\\\frac","<{>","\\\\pi","^",2,"<}>","<{>",2,"<}>"]'`
    15 |     );
    16 |   });
    */
  }
}
