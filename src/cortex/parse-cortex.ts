import { Expression } from '../public';
import {
  CortexErrorCode,
  CortexErrorListener,
  CortexErrorMessage,
} from './cortex-utils';

class CortexExpression {
  index = 0;
  s: string;
  onError: CortexErrorListener;
  constructor(s: string, onError: CortexErrorListener) {
    this.s = s;
    this.onError = onError;
  }
  error(error: CortexErrorCode | CortexErrorMessage): void {
    const message =
      typeof error !== 'string'
        ? { ...error, pos: this.index }
        : { code: error, pos: this.index };
    this.onError(message);
  }
  atEnd(): boolean {
    return this.index >= this.s.length;
  }
  peek(n = 1): string {
    if (n === 1) return this.s[this.index];
    return this.s.slice(this.index, this.index + n);
  }
  skipWhitespace(): void {
    let done = false;
    while (!done) {
      done = !this.match(' ') && !this.match('\t');
    }
  }
  skipLineComment(): void {
    return;
  }
  skipBlockComment(): void {
    return;
  }

  match(target: string): boolean {
    if (this.peek(target.length) !== target) return false;
    this.index += target.length;
    return true;
  }

  until(target: string, error: CortexErrorCode | CortexErrorMessage) {
    let found = false;
    while (!found && !this.atEnd()) {}
    if (!found) {
      this.error(error);
      found = true;
    }
  }

  expect(target: string, errorCode: CortexErrorCode): boolean {
    if (this.peek(target.length) !== target) {
      this.error(errorCode);
      return false;
    }
    this.index += target.length;
    return true;
  }

  parseExpression(): Expression {
    return 'Nothing';
  }
}

export function parseCortex(
  s: string,
  onError?: CortexErrorListener
): Expression {
  const cortex = new CortexExpression(s, onError);
  return cortex.parseExpression();
}
