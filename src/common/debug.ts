import { SignalOrigin } from '../public';

const LINEBREAK = /\r\n|[\n\r\u2028\u2029]/;

const RESET = '\u001b[0m';
const GREY = '\u001b[30;1m${s}';
const RED = '\u001b[31;1m';
// const YELLOW = '\u001b[33m';
const BOLD = '\u001b[1m';

const GREY_BG = '\u001b[40;1m';

export type Terminal = {
  joinLines(lines: string[]): string;
  grey(s: string): string;
  red(s: string): string;
  highlightBackground(s: string): string;
};

export const colorTerminal: Terminal = {
  joinLines(lines: string[]): string {
    return lines.join('\n');
  },
  grey(s: string): string {
    return `${GREY}${s}${RESET}`;
  },
  red(s: string): string {
    return `${BOLD}${RED}${s}${RESET}`;
  },
  highlightBackground(s: string): string {
    return `${GREY_BG}${s}${RESET}`;
  },
};

const htmlTerminal: Terminal = {
  joinLines(lines: string[]) {
    return `<div>${lines.join('</div><div>')}</div>`;
  },
  grey(s: string): string {
    return `<span style="opacity:.5">${s}</span>`;
  },
  red(s: string): string {
    return `<span style="color:#F33">${s}</span>`;
  },
  highlightBackground(s: string): string {
    return `<span style="background:rgba(255, 100, 100, .1);display:block;border-radius: 4px">${s}</span>`;
  },
};

const terminal = htmlTerminal;

export class Origin {
  url: string;
  source: string;
  _lines: string[];
  _lineOffsets: number[];

  constructor(source: string, url?: string) {
    this.source = source;
    this.url = url;
  }

  get lines(): string[] {
    if (!this._lines) this._lines = this.source.split(LINEBREAK);
    return this._lines;
  }

  get lineOffsets(): number[] {
    if (this._lineOffsets == null) {
      const offsets = [];
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
    return terminal.grey(s);
  }

  chalkMarker(s: string): string {
    return terminal.red(s);
  }
  chalkMessage(s: string): string {
    return terminal.red(s);
  }

  /** line: 1..., column: 1... */
  sourceAround(line: number, column: number, message?: string): string {
    const linesAbove = 2;
    const linesBelow = 3;
    const start = Math.max(line - 1 - (linesAbove + 1), 0);
    const end = Math.min(this.lines.length, line + linesBelow) - 1;

    const hasColumn = typeof column === 'number';
    const numberMaxWidth = String(end).length;
    const result = [];
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
          markerLine = terminal.joinLines([
            '',
            [
              ' ',
              this.chalkGutter(gutter.replace(/\d/g, ' ')),
              markerSpacing,
              this.chalkMarker('^'),
            ].join(''),
          ]);

          if (message) {
            markerLine += ' ' + this.chalkMessage(message);
          }
        } else if (message) {
          markerLine = terminal.joinLines([
            '',
            this.chalkGutter(gutter.replace(/\d/g, ' ')) + message,
          ]);
        }
        result.push(
          terminal.highlightBackground(
            [
              this.chalkMarker('>'),
              this.chalkGutter(gutter),
              this.lines[index],
              markerLine,
            ].join('')
          )
        );
      } else {
        result.push(` ${this.chalkGutter(gutter)}${this.lines[index]}`);
      }
    }
    return terminal.joinLines(result);
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

/** Word-wrap a string that contains ANSI escape sequences.
 *  ANSI escape sequences do not add to the string length.
 */
export const wrapAnsiString = (
  string: string,
  terminalWidth: number
): string => {
  if (terminalWidth === 0) {
    // if the terminal width is zero, don't bother word-wrapping
    return string;
  }

  const ANSI_REGEXP = /[\u001b\u009b]\[\d{1,2}m/g;
  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = ANSI_REGEXP.exec(string))) {
    const ansi = match[0];
    const index = match['index'];
    if (index != lastIndex) {
      tokens.push(['string', string.slice(lastIndex, index)]);
    }
    tokens.push(['ansi', ansi]);
    lastIndex = index + ansi.length;
  }

  if (lastIndex != string.length - 1) {
    tokens.push(['string', string.slice(lastIndex, string.length)]);
  }

  let lastLineLength = 0;

  return tokens
    .reduce(
      (lines, [kind, token]) => {
        if (kind === 'string') {
          if (lastLineLength + token.length > terminalWidth) {
            while (token.length) {
              const chunk = token.slice(0, terminalWidth - lastLineLength);
              const remaining = token.slice(
                terminalWidth - lastLineLength,
                token.length
              );
              lines[lines.length - 1] += chunk;
              lastLineLength += chunk.length;
              token = remaining;
              if (token.length) {
                lines.push('');
                lastLineLength = 0;
              }
            }
          } else {
            lines[lines.length - 1] += token;
            lastLineLength += token.length;
          }
        } else {
          lines[lines.length - 1] += token;
        }

        return lines;
      },
      ['']
    )
    .join('\n');
};
