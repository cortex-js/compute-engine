import type { Expression } from '../global-types.js';
import { isNumber } from '../boxed-expression/type-guards.js';

/**
 * Heads whose interpreter kernel continues a real function into the complex
 * plane: with real operands the value is complex off the real domain
 * (`LerchPhi(3, 2, 1)` is `0.773 − 1.150i`). The JavaScript target lowers
 * them to the complex kernel in `auto` and `complex` mode; a shader target
 * has no complex lane for them and declines a provably complex value.
 */
export const COMPLEX_CONTINUATION_HEADS: ReadonlySet<string> = new Set([
  'HurwitzZeta',
  'LerchPhi',
  'PolyLog',
  'EllipticK',
  'EllipticE',
  'Hypergeometric2F1',
  'LambertW',
]);

/** The branch point −1/e of `LambertW`. */
const LAMBERT_W_BRANCH_POINT = -Math.exp(-1);

/**
 * What is known of the value of `head(...args)` for real operands.
 *
 * - `real`: the value is provably real (or a real pole), so the real
 *   kernel answers;
 * - `complex`: the value is provably not real;
 * - `unknown`: neither is provable from the operand facts.
 *
 * The real domains are those of the issue table: `HurwitzZeta` is real for
 * `a ≥ 0` or an integer `s`; `LerchPhi` and `PolyLog` for `z ≤ 1` (or an
 * integer `s ≤ 0`, where they are rational in `z`); `EllipticK` and
 * `EllipticE` for `m ≤ 1`; `Hypergeometric2F1` for `z ≤ 1` (or a terminating
 * series); `LambertW` for `x ≥ −1/e` on branch 0.
 *
 * Operands are read as real: a complex operand takes the complex kernel
 * whatever this returns. An arity the lowering does not compile answers
 * `real`.
 */
export function complexContinuation(
  head: string,
  args: ReadonlyArray<Expression>
): 'real' | 'complex' | 'unknown' {
  const arity = (n: number) => args.length === n && args.every((x) => !!x);
  const nonPositiveInteger = (x: Expression) =>
    x.isInteger === true && x.isNonPositive === true;
  switch (head) {
    case 'HurwitzZeta': {
      if (!arity(2)) return 'real';
      const [s, a] = args;
      if (a.isNonNegative === true || s.isInteger === true) return 'real';
      return a.isNegative === true &&
        a.isInteger === false &&
        s.isInteger === false
        ? 'complex'
        : 'unknown';
    }
    case 'LerchPhi': {
      if (!arity(3)) return 'real';
      const [z, s, a] = args;
      const zReal = z.isLessEqual(1) === true || nonPositiveInteger(s);
      const aReal = a.isNonNegative === true || s.isInteger === true;
      if (zReal && aReal) return 'real';
      const zCut = z.isGreater(1) === true && s.isInteger !== true;
      const aCut =
        a.isNegative === true && a.isInteger === false && s.isInteger === false;
      return zCut || aCut ? 'complex' : 'unknown';
    }
    case 'PolyLog': {
      if (!arity(2)) return 'real';
      const [s, z] = args;
      if (z.isLessEqual(1) === true || nonPositiveInteger(s)) return 'real';
      return z.isGreater(1) === true && s.isInteger !== true
        ? 'complex'
        : 'unknown';
    }
    case 'EllipticK':
    case 'EllipticE': {
      if (!arity(1)) return 'real';
      const [m] = args;
      if (m.isLessEqual(1) === true) return 'real';
      return m.isGreater(1) === true ? 'complex' : 'unknown';
    }
    case 'Hypergeometric2F1': {
      if (!arity(4)) return 'real';
      const [a, b, , z] = args;
      if (
        z.isLessEqual(1) === true ||
        nonPositiveInteger(a) ||
        nonPositiveInteger(b)
      )
        return 'real';
      return 'unknown';
    }
    case 'LambertW': {
      if (args.length < 1 || args.length > 2 || !args[0]) return 'real';
      const [x, k] = args;
      // A branch that is not a literal integer cannot be classified
      if (k !== undefined && !(isNumber(k) && Number.isInteger(k.re)))
        return 'unknown';
      const branch = k === undefined ? 0 : k.re;
      const aboveBranchPoint =
        x.isNonNegative === true ||
        (isNumber(x) && !x.isComplex && x.re >= LAMBERT_W_BRANCH_POINT);
      if (branch === 0) return aboveBranchPoint ? 'real' : 'unknown';
      // W₋₁ is real on [−1/e, 0); every other branch is real nowhere but 0
      if (branch === -1)
        return aboveBranchPoint && x.isNegative === true ? 'real' : 'unknown';
      return 'unknown';
    }
  }
  return 'real';
}
