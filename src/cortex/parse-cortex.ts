import { Expression, SignalCode, WarningSignal } from '../public';
import { WHITE_SPACE } from './characters';
import { Origin } from '../common/debug';
import { CortexError } from '../compute-engine/utils';

class CortexExpression {
  index = 0;
  s: string;
  origin: Origin;
  warnings: WarningSignal[];

  constructor(s: string, filepath?: string) {
    this.s = s;
    this.warnings = [];
    this.origin = new Origin(s, filepath);
  }
  warning(code: SignalCode, ...args: (string | number)[]): void {
    this.warnings.push({
      severity: 'warning',
      code,
      args,
      origin: this.origin.signalOrigin(this.index),
    });
  }
  error(code: SignalCode, ...args: (string | number)[]): void {
    throw new CortexError({
      severity: 'error',
      code,
      args,
      origin: this.origin.signalOrigin(this.index),
    });
  }
  atEnd(): boolean {
    return this.index >= this.s.length;
  }
  atWhiteSpace(): boolean {
    return WHITE_SPACE.includes(this.s.charCodeAt(this.index));
  }
  peek(n = 1): string {
    if (n === 1) return this.s[this.index];
    return this.s.slice(this.index, this.index + n);
  }
  skipWhitespace(): void {
    let done = false;
    while (!done) {
      done = !WHITE_SPACE.includes(this.s.charCodeAt(this.index));
      if (!done) this.index;
    }
  }
  skipLineComment(): void {
    // @todo
    return;
  }
  skipBlockComment(): void {
    // @todo
    return;
  }

  match(target: string): boolean {
    if (this.peek(target.length) !== target) return false;
    this.index += target.length;
    return true;
  }

  until(target: string, error: SignalCode) {
    let found = false;
    while (!found && !this.atEnd()) {}
    if (!found) {
      this.error(error);
      found = true;
    }
  }

  expect(target: string, errorCode: SignalCode): boolean {
    if (this.peek(target.length) !== target) {
      this.error(errorCode);
      return false;
    }
    this.index += target.length;
    return true;
  }
  parseNumber(): Expression | null {
    return null;
  }

  parseExpression(): Expression {
    return this.parseNumber() ?? 'Nothing';
  }
}

export function parseCortex(s: string): [Expression, WarningSignal[]] {
  const cortex = new CortexExpression(s);
  return [cortex.parseExpression(), cortex.warnings];
}
