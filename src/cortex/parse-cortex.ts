import { ErrorSignal, Expression } from '../public';
import { Origin } from '../common/debug';
import { binaryNumber, ParserState, Result } from './parsers';

// class CortexExpression {
//   index = 0;
//   s: string;
//   origin: Origin;
//   warnings: WarningSignal[];

//   constructor(s: string, filepath?: string) {
//     this.s = s;
//     this.warnings = [];
//     this.origin = new Origin(s, filepath);
//   }

//   warning(code: SignalCode, ...args: (string | number)[]): void {
//     this.warnings.push({
//       severity: 'warning',
//       code,
//       args,
//       origin: this.origin.signalOrigin(this.index),
//     });
//   }

//   error(code: SignalCode, ...args: (string | number)[]): void {
//     throw new CortexError({
//       severity: 'error',
//       code,
//       args,
//       origin: this.origin.signalOrigin(this.index),
//     });
//   }

//   parseExpression(): Expression {
//     // return this.parseNumber() ?? 'Nothing';
//     return 'Nothing';
//   }
// }

function primaryExpression(state: ParserState): Result<Expression> {
  return binaryNumber(state);
}

function cortexExpression(state: ParserState): Result<Expression> {
  return primaryExpression(state);
}

export function parseCortex(s: string): [Expression, ErrorSignal] {
  // const cortex = new CortexExpression(s);
  // return [cortex.parseExpression(), cortex.warnings];
  const result = cortexExpression({ s, i: 0 });
  if (result.kind === 'success') return [result.value, null];

  let errorInfo: string[] = [];
  if (typeof result.error === 'string') {
    errorInfo = [result.error];
  } else if (typeof result.error !== 'undefined') {
    errorInfo = result.error.map((x) => `'${x.toString()}'`);
  } else {
    errorInfo = ['syntax-error'];
  }
  const origin = new Origin(s);
  return [
    ['Error', ...errorInfo],
    {
      severity: 'error',
      code: result.error ?? 'syntax-error',
      origin: origin.signalOrigin(result.state.i),
    },
  ];
}
