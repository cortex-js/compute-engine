import { ErrorSignal, Signal } from '../common/signals';

export class CortexError {
  signal: ErrorSignal;
  constructor(errorSignal: Signal) {
    this.signal = { severity: 'error', ...errorSignal } as ErrorSignal;
  }
  toString(): string {
    let result = '';
    if (this.signal.head) result += this.signal.head + ': ';

    if (typeof this.signal.message === 'string') {
      result += this.signal.message;
    } else {
      result += ' ';
      for (const arg of this.signal.message) result += arg.toString() + ' ';
    }

    return result;
  }
}
