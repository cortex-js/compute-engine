/**
 * Tycho item 237 — the second interval-js lowering batch (the item-220 mold).
 *
 * Four heads confirmed missing on the `interval-js` target by Tycho's
 * 2026-08-30 compile-decline census:
 *
 * - `Choose` — the binomial coefficient; the interval runtime already had
 *   `_IA.binomial` (registered for `Binomial`), only the alias entry was
 *   missing.
 * - `Apply` — the `f'` prime-derivative spelling lowers to
 *   `Apply(Function(…), x)`; the function literal compiles to an arrow over
 *   intervals through the shared `Function` lowering, so the application is
 *   a direct call, as on the JavaScript target.
 * - `WithRandomSeed` / `Random` — a random draw is enclosed by its
 *   distribution's SUPPORT (`Random()` ⊆ [0, 1]), which is sound for any
 *   draw on any evaluation; threading the seeded sequence would be unsound
 *   (the interval lane samples at different points than the scalar lane).
 *   The seed therefore contributes nothing and only the body is emitted.
 *   Only nullary `Random()` is claimed; `Random(source)` fails closed.
 * - index-less `Sum` over a collection body — the Desmos sum-a-list
 *   spelling. A statically decomposable operand (literal list, literal
 *   `Range`, `Map` over one, or an element-wise head over one) folds its
 *   compiled elements with `_IA.add`; an indexed-collection-typed operand
 *   folds at run time; anything else fails closed.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let warn: jest.SpyInstance;
beforeAll(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => warn.mockRestore());

function ce(): ComputeEngine {
  const engine = new ComputeEngine();
  engine.precision = 'machine';
  return engine;
}

/** The scalar value of an interval result, or undefined for a wide one. */
function pointOf(v: any): number | undefined {
  const iv = v && typeof v === 'object' && 'value' in v ? v.value : v;
  if (!iv || typeof iv.lo !== 'number') return undefined;
  return iv.lo === iv.hi ? iv.lo : undefined;
}

describe('Tycho item 237 — interval-js lowering batch', () => {
  test('Choose compiles and matches the interpreter at a point', () => {
    const engine = ce();
    const mj = ['Multiply', ['Choose', 5, ['Floor', 'x']], 0.5];
    const r = compile(engine.box(mj), { to: 'interval-js' });
    expect(r.success).toBe(true);
    // C(5, 2) / 2 = 5, the interpreter's value at x = 2.3.
    expect(pointOf(r.run({ x: 2.3 }))).toBe(5);
  });

  test('Apply of a function literal compiles, scalar and interval inputs', () => {
    const mj = ['Apply', ['Function', ['Multiply', 't', 't'], 't'], 'x'];
    const r = compile(ce().box(mj), { to: 'interval-js' });
    expect(r.success).toBe(true);
    expect(pointOf(r.run({ x: 3 }))).toBe(9);
    const wide: any = r.run({ x: { lo: 1, hi: 2 } });
    expect(wide.value ?? wide).toEqual({ lo: 1, hi: 4 });
  });

  test('WithRandomSeed(Random()) encloses the support', () => {
    const r = compile(ce().box(['WithRandomSeed', 628117, ['Random']]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(true);
    const v: any = r.run({});
    expect(v.value ?? v).toEqual({ lo: 0, hi: 1 });
  });

  test('Random with a source argument fails closed', () => {
    const r = compile(ce().box(['Random', ['Range', 1, 5]]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nullary/);
  });

  test('index-less Sum over a literal list, and the empty identity', () => {
    const r = compile(ce().box(['Sum', ['List', 3, 4, 5]]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(true);
    expect(pointOf(r.run({}))).toBe(12);
    const empty = compile(ce().box(['Sum', ['List']]), { to: 'interval-js' });
    expect(empty.success).toBe(true);
    expect(pointOf(empty.run({}))).toBe(0);
  });

  test('index-less Sum over an element-wise body (the census witness)', () => {
    const r = compile(ce().box(['Sum', ['Power', ['List', 0.64, 0.77], 2]]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(true);
    // 0.64² + 0.77² = 1.0025, the interpreter's value.
    expect(pointOf(r.run({}))).toBeCloseTo(1.0025, 12);
  });

  test('index-less Sum over Map(fn, Range) — the Range-as-collection form', () => {
    const mj = [
      'Sum',
      ['Map', ['Function', ['Divide', 'x', 'k'], 'k'], ['Range', 1, 5]],
    ];
    const r = compile(ce().box(mj), { to: 'interval-js' });
    expect(r.success).toBe(true);
    // x(1 + 1/2 + 1/3 + 1/4 + 1/5) at x = 1.
    expect(pointOf(r.run({ x: 1 }))).toBeCloseTo(137 / 60, 12);
  });

  test('undecomposable collection bodies fail closed', () => {
    // A list of lists: the element compiles through `List`, which this
    // target deliberately does not lower (the item-220 design fact).
    const nested = compile(
      ce().box(['Sum', ['List', ['List', 1, 2], ['List', 3, 4]]]),
      { to: 'interval-js' }
    );
    expect(nested.success).toBe(false);
    // Two collection operands of an element-wise head: a zip, not a map —
    // left undecomposed rather than guessed at.
    const zip = compile(
      ce().box(['Sum', ['Add', ['List', 1, 2], ['List', 3, 4]]]),
      { to: 'interval-js' }
    );
    expect(zip.success).toBe(false);
  });

  test('Range decomposition follows the interpreter contract', () => {
    // Descending two-operand range infers step -1: 5+4+3+2+1 = 15.
    const desc = compile(ce().box(['Sum', ['Range', 5, 1]]), {
      to: 'interval-js',
    });
    expect(desc.success).toBe(true);
    expect(pointOf(desc.run({}))).toBe(15);
    // Real step: 0 + 0.25 + 0.5 + 0.75 + 1 = 2.5.
    const real = compile(ce().box(['Sum', ['Range', 0, 1, 0.25]]), {
      to: 'interval-js',
    });
    expect(real.success).toBe(true);
    expect(pointOf(real.run({}))).toBe(2.5);
    // Sign-mismatched step is empty: the identity.
    const empty = compile(ce().box(['Sum', ['Range', 1, 2, -1]]), {
      to: 'interval-js',
    });
    expect(empty.success).toBe(true);
    expect(pointOf(empty.run({}))).toBe(0);
    // A single element at the edge of the safe-integer range compiles
    // without hanging (the count-driven expansion makes no endpoint
    // progress assumption).
    const huge = compile(
      ce().box(['Sum', ['Range', 9007199254740992, 9007199254740992]]),
      { to: 'interval-js' }
    );
    expect(huge.success).toBe(true);
  });

  test('a non-literal seed fails closed', () => {
    const r = compile(ce().box(['WithRandomSeed', ['Add', 'n', 1], ['Random']]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/literal finite real or string seed/);
  });

  test('non-numeric elements fail closed', () => {
    const r = compile(ce().box(['Sum', ['List', { str: 'a' }]]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not.*numeric|Fail closed/);
  });

  test('Apply arity mismatches fail closed', () => {
    // Under-applied: the interpreter curries; a JS call would bind
    // `undefined`.
    const under = compile(
      ce().box([
        'Apply',
        ['Function', ['Add', 's', 't'], 's', 't'],
        'x',
      ]),
      { to: 'interval-js' }
    );
    expect(under.success).toBe(false);
  });

  test('the indexed Sum form is unchanged', () => {
    const r = compile(ce().box(['Sum', ['Power', 'x', 'k'], ['Tuple', 'k', 1, 5]]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(true);
    // 2 + 4 + 8 + 16 + 32 at x = 2.
    expect(pointOf(r.run({ x: 2 }))).toBe(62);
  });
});
