import { ComputeEngine } from '../../src/compute-engine';
import { _BoxedValueDefinition } from '../../src/compute-engine/boxed-expression/boxed-value-definition';

// Tycho item 329 (2026-09-28): reading the `.type` of a product or a sum of
// calls to declared user functions took exponential time when a callee body
// read a name that no scope declared (`T` below).
//
// A function declared with a placeholder result (`(real) -> unknown`) reports
// a signature derived from its body, memoized in `_deriveSignature`. The
// derivation boxes the body again in a fresh local scope. The free `T` was
// then declared again in that scope and narrowed by its use (`unknown` to
// `number`), and that narrowing advanced the engine version the memo keys on.
// So each derivation invalidated the memo of every other declared function,
// and each factor of a product re-derived its callees recursively: 5 173
// derivations for `h(1)r(1)`, 89 002 for `h(1)r(1)+c(2)r(3)`, and 1.87 million
// for the sum below (more than 60 s). With `T` declared, 97, 53 and 251.
//
// A narrowing by a use no longer advances that version. These tests check
// that the reported types do not change and that the number of derivations
// stays small.

const LIMIT = 2000;

/** Count the calls to `_deriveSignature`. Past `LIMIT` the spy throws, so
 * that without the fix the test fails at once instead of running for
 * minutes. */
function withDerivationCount<T>(f: () => T): { result: T; count: number } {
  const proto = _BoxedValueDefinition.prototype as any;
  const original = proto._deriveSignature;
  let count = 0;
  proto._deriveSignature = function (...args: unknown[]) {
    count += 1;
    if (count > LIMIT) throw new Error('too many signature derivations');
    return original.apply(this, args);
  };
  try {
    return { result: f(), count };
  } finally {
    proto._deriveSignature = original;
  }
}

function setup(declareT: boolean): ComputeEngine {
  const ce = new ComputeEngine();
  ce.pushScope();
  if (declareT) ce.declare('T', 'real');
  ce.declare('m', 'real | signed_infinity | nan');
  for (const f of ['h', 'd', 's', 'c', 'q', 'r'])
    ce.declare(f, '(real | signed_infinity | nan) -> unknown');
  const def = (name: string, param: string, body: string) =>
    ce.assign(
      name,
      ce.box(['Function', ce.parse(body, { canonical: false }).json, param])
    );
  def('h', 'x', '0.08\\sin(4x - T) + 0.03\\sin(9.3x + 2T)');
  def('d', 'x', '0.32\\cos(4x - T) + 0.279\\cos(9.3x + 2T)');
  def('s', 'j', '-4 + 8\\frac{j - 0.5}{400}');
  def('c', 'j', '\\frac{1}{\\sqrt{1 + d(s(j))^2}}');
  def('q', 'j', 'mc(j) - \\sqrt{1 - m^2(1 - c(j)^2)}');
  def('r', 'j', '\\frac{-q(j)d(s(j))c(j)}{q(j)c(j) - m}');
  ce.pushScope();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  return ce;
}

const SUM =
  '\\sum_{j=1}^{400} \\exp(-(\\frac{s(j) + (y - h(s(j)))r(j) - x}{0.045})^2)';

describe('TYCHO ITEM 329: SIGNATURE MEMO WITH AN UNDECLARED FREE NAME', () => {
  for (const declareT of [false, true]) {
    describe(declareT ? 'T declared real' : 'T undeclared', () => {
      const ce = setup(declareT);

      test('the types do not change', () => {
        expect(ce.parse('h(1)').type.toString()).toBe(
          declareT ? 'nan | real' : 'number'
        );
        expect(ce.parse('h(1)r(1)').type.toString()).toBe('number');
        expect(ce.parse('h(1)r(1)+c(2)r(3)').type.toString()).toBe('number');
      });

      test('a product of calls derives a bounded number of signatures', () => {
        const { result, count } = withDerivationCount(() =>
          ce.parse('h(2)r(2)+c(4)r(5)').type.toString()
        );
        expect(result).toBe('number');
        expect(count).toBeLessThan(LIMIT);
      });

      test('a sum over 400 terms types in bounded time', () => {
        const start = performance.now();
        const { result, count } = withDerivationCount(() =>
          ce.parse(SUM).type.toString()
        );
        expect(result).toBe('number');
        expect(count).toBeLessThan(LIMIT);
        expect(performance.now() - start).toBeLessThan(2000);
      });
    });
  }

  test('a later declaration of the free name still changes the result', () => {
    const ce = setup(false);
    expect(ce.parse('h(1)').type.toString()).toBe('number');
    // Declare `T` in the scope where `h` was defined: the memo of `h`'s
    // derived signature must miss, and the result follows the declaration.
    ce.popScope();
    ce.declare('T', 'real');
    expect(ce.parse('h(1)').type.toString()).toBe('nan | real');
  });
});
