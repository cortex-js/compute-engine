import { SignalOrigin } from '../public';
const chalk = require('chalk');

const NEWLINE = /\r\n|[\n\r\u2028\u2029]/;

export class Origin {
  filepath: string;
  source: string;
  _lines: string[];

  constructor(source: string, filepath?: string) {
    this.source = source;
    this.filepath = filepath;
  }

  get lines(): string[] {
    if (this._lines) return this._lines;
    this._lines = this.source.split(NEWLINE);
  }

  //   line(n: number, col?: number): string {
  //     // @todo
  //     let result = '';
  //     if (col) {
  //       result = chalk.bold(`      ${n} |`.slice(-8));
  //     } else {
  //       result = `    > ${n} |`.slice(-8);
  //     }
  //     return result;
  //   }

  getLinecol(_offset: number): [line: number, col: number] {
    // @todo
    return [0, 0];
  }

  signalOrigin(offset: number): SignalOrigin {
    const [line, column] = this.getLinecol(offset);
    return {
      filepath: this.filepath,
      source: this.source,
      index: offset,
      line,
      column,
    };
  }

  chalkGutter(s: string): string {
    // chalk.grey,
    return s;
  }

  chalkMarker(s: string): string {
    //  chalk.red.bold,
    return s;
  }
  chalkMessage(s: string): string {
    //message: chalk.red.bold
    return chalk.red.bold(s);
  }

  sourceAround(line: number, column: number, message: string): string {
    const linesAbove = 2;
    const linesBelow = 3;
    const start = Math.max(line - (linesAbove + 1), 0);
    const end = Math.min(this.lines.length, line + linesBelow);

    const hasColumn = typeof column === 'number';
    const numberMaxWidth = String(end).length;
    let result = '';
    for (let index = start; index <= end; index++) {
      const number = start + 1 + index;
      const paddedNumber = ` ${number}`.slice(-numberMaxWidth);
      const gutter = ` ${paddedNumber} | `;
      let markerLine = '';
      if (index === line) {
        if (hasColumn) {
          const markerSpacing = this.lines[index]
            .slice(0, Math.max(column - 1, 0))
            .replace(/[^\t]/g, ' ');
          markerLine = [
            '\n ',
            this.chalkGutter(gutter.replace(/\d/g, ' ')),
            markerSpacing,
            this.chalkMarker('^'),
          ].join('');

          if (message) {
            markerLine += ' ' + this.chalkMessage(message);
          }
        } else if (message) {
          markerLine =
            '\n' + this.chalkGutter(gutter.replace(/\d/g, ' ')) + message;
        }
        result += [
          this.chalkMarker('>'),
          this.chalkGutter(gutter),
          this.lines[index],
          markerLine,
        ].join('');
      } else {
        result += ` ${this.chalkGutter(gutter)}${this.lines[line]}`;
      }
    }
    return result;
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
