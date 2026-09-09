/**
 * The interval JavaScript target emits `_IA.sub` for a subtraction.
 *
 * `Subtract` canonicalizes to `Add(a, Negate(b))` before compilation, so an
 * `Add` chain that compiled each operand on its own emitted
 * `_IA.add(a, _IA.negate(b))` — an extra call and an extra interval object
 * for every subtraction. The chain now calls the library `sub` kernel
 * directly for a negated operand in any position AFTER the first; a `Negate`
 * that is the first operand of the chain has nothing to subtract it from and
 * keeps its `_IA.negate`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';

const ce = new ComputeEngine();

type IntervalRun = {
  success: boolean;
  code: string;
  run: (arg: unknown) => unknown;
};

function compileInterval(latex: string): IntervalRun {
  const expr = ce.parse(latex);
  if (!expr.isValid) throw new Error(`parse: ${expr.toString()}`);
  const r = compile(expr, { to: 'interval-js' }) as IntervalRun;
  if (!r.success) throw new Error(`compile failed: ${latex}`);
  return r;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A point, a non-degenerate interval, and one that straddles zero. */
const SAMPLES = [
  { x: 3, y: 1, z: 0.5 },
  { x: { lo: 1, hi: 2 }, y: { lo: 0.5, hi: 3 }, z: { lo: -1, hi: 1 } },
  { x: { lo: -2, hi: -1 }, y: { lo: 4, hi: 5 }, z: { lo: 0, hi: 0 } },
];

describe('INTERVAL JS - SUBTRACTION EMITS _IA.sub', () => {
  test('a binary subtraction is one `_IA.sub` call', () => {
    const r = compileInterval('x - y');
    expect(r.code).toBe('_IA.sub(_.x, _.y)');
  });

  test('a chain of subtractions is a chain of `_IA.sub` calls', () => {
    const r = compileInterval('x - y - z');
    expect(r.code).toBe('_IA.sub(_IA.sub(_.x, _.y), _.z)');
  });

  test('a negated FIRST operand swaps with a pure second operand', () => {
    // Interval addition is commutative endpoint for endpoint, so the chain
    // starts from the second operand and subtracts the first. Canonical
    // ordering places a negated product before a bare symbol, which makes
    // this the common spelling of a subtraction in a corpus.
    expect(compileInterval('-x + y').code).toBe('_IA.sub(_.y, _.x)');
    expect(compileInterval('x - y z').code).toBe(
      '_IA.sub(_.x, _IA.mul(_.y, _.z))'
    );
    // Both operands negated: nothing to swap with, the first keeps its
    // negation and the second subtracts.
    expect(compileInterval('-x - y').code).toBe(
      '_IA.sub(_IA.negate(_.x), _.y)'
    );
  });

  test('an impure first operand keeps the original order', () => {
    // The swap reorders the evaluation of the two operands, which a random
    // draw can observe, so the negation stays in place. Canonical ordering
    // would put the symbol first, so the operand order is fixed structurally.
    const expr = ce.function(
      'Add',
      [ce.function('Negate', [ce.function('Random', [])]), ce.symbol('x')],
      { form: 'structural' }
    );
    // On this target a draw lowers to its range, and the negated range folds
    // to a literal; the witness is the chain shape: an addition whose FIRST
    // argument is that negated range, not a subtraction from `x`.
    const code = (compile(expr, { to: 'interval-js' }) as IntervalRun).code;
    expect(code).toMatch(/^_IA\.add\(/);
    expect(code).not.toContain('_IA.sub(');
  });

  test('a constant subtrahend that canonicalizes to a negative literal still adds', () => {
    // `x - 2` canonicalizes to `Add(x, -2)`: the operand is a number
    // literal, not a `Negate` node, so there is no negation to remove.
    expect(compileInterval('x - 2').code).toBe('_IA.add(_.x, _IA.point(-2))');
  });

  test('the chain-step fold still sees the subtraction step', () => {
    // Both operands are constants, so the whole step folds to one literal
    // and no call survives.
    const r = compileInterval('\\pi - e');
    expect(count(r.code, '_IA.')).toBe(0);
    expect(r.code).toBe(
      "{ kind: 'interval', value: { lo: 0.42331082513074714, hi: 0.4233108251307489 } }"
    );
  });

  test('`_IA.sub` answers what `_IA.add` of the negation answered', () => {
    const r = compileInterval('x - y');
    for (const args of SAMPLES) {
      const a = typeof args.x === 'number' ? IA.point(args.x) : args.x;
      const b = typeof args.y === 'number' ? IA.point(args.y) : args.y;
      expect(r.run(args)).toEqual(IA.add(a, IA.negate(b)));
    }
  });

  test('a subtraction chain answers what the add-and-negate chain answered', () => {
    const r = compileInterval('x - y - z');
    for (const args of SAMPLES) {
      const a = typeof args.x === 'number' ? IA.point(args.x) : args.x;
      const b = typeof args.y === 'number' ? IA.point(args.y) : args.y;
      const c = typeof args.z === 'number' ? IA.point(args.z) : args.z;
      expect(r.run(args)).toEqual(
        IA.add(IA.add(a, IA.negate(b)), IA.negate(c))
      );
    }
  });
});
