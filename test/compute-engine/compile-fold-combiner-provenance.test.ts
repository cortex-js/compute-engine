/**
 * The combiner of a compiled `Reduce` or `Scan` on the JavaScript target.
 *
 * The targets fold with the kernel that the name of the combiner spells
 * (`Math.max` for `Max`, `+` for `Add`), and the fixed-width pass
 * writes a `Reduce` over a written-out list as the n-ary head
 * (`Max(a, b, c)`). Both are correct only for the library operator. A user
 * definition with the same name can be binary and not associative:
 * `Reduce([1, 2, 3], Max)` with `Max(a, b) = 2a + b` is
 * `Max(Max(1, 2), 3) = 11`, where `Math.max` gives 3. A function that the
 * caller supplies under the name through the `functions` option is not the
 * library kernel either. In both cases the compilation now declines, and the
 * interpreter evaluates the fold.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const WRITTEN = ['List', 'x', ['Add', 'x', 1], ['Add', 'x', 2]];

/** Each fold, over a written-out list and over a list passed in `vars`. */
const FOLDS = [
  ['Reduce', WRITTEN, 'Max'],
  ['Reduce', WRITTEN, 'Max', 0],
  ['Scan', WRITTEN, 'Max'],
  ['Scan', WRITTEN, 'Max', 0],
  ['Reduce', 'V', 'Max', 0],
  ['Scan', 'V', 'Max'],
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('V', 'list<number>');
  return ce;
}

/** Does the compilation decline? A decline is a thrown error or a result
 * with `success: false`. */
function declines(ce: ComputeEngine, json: unknown, options: object): boolean {
  try {
    const r = compile(ce.box(json as never), {
      to: 'javascript',
      fallback: false,
      ...options,
    } as never);
    return r.success === false;
  } catch {
    return true;
  }
}

describe('a Reduce or Scan combiner that is not the library operator', () => {
  test('a user-declared binary Max declines; the interpreter answers 11', () => {
    const ce = engine();
    ce.declare('Max', {
      signature: '(number, number) -> number',
      evaluate: ([a, b], { engine: e }) =>
        e.box(['Add', ['Multiply', 2, a], b]).evaluate(),
    });
    // 2·(2·1 + 2) + 3
    expect(
      ce.box(['Reduce', WRITTEN, 'Max'] as never).subs({ x: 1 }).evaluate().re
    ).toBe(11);
    expect(
      ce
        .box(['Scan', WRITTEN, 'Max'] as never)
        .subs({ x: 1 })
        .evaluate()
        .toString()
    ).toBe('[1,4,11]');
    for (const json of FOLDS) {
      // Before: `Math.max`, which gave 3 and [1, 2, 3].
      expect(declines(ce, json, {})).toBe(true);
    }
  });

  test('a Max that the caller supplies in `functions` declines', () => {
    const ce = engine();
    for (const json of FOLDS) {
      // Before: `Math.max`, which ignored the caller's function.
      expect(
        declines(ce, json, {
          functions: { Max: (a: number, b: number) => 2 * a + b },
        })
      ).toBe(true);
    }
  });

  test('the library Max still compiles to the kernel', () => {
    const ce = engine();
    for (const json of FOLDS) {
      const r = compile(ce.box(json as never), {
        to: 'javascript',
        fallback: false,
      });
      expect(r.success).toBe(true);
      const want = ce
        .box(json as never)
        .subs({ x: 1, V: ce.box(['List', 1, 2, 3]) })
        .evaluate();
      const got = r.run!({ x: 1, V: [1, 2, 3] });
      expect(JSON.stringify(got)).toBe(
        want.isCollection
          ? JSON.stringify(Array.from(want.each()).map((c) => c.re))
          : JSON.stringify(want.re)
      );
    }
  });
});

/** The step `(a, b) ↦ 2a + b`, which a local `Max` is bound to below. */
const STEP = ['Function', ['Add', ['Multiply', 2, 'a'], 'b'], 'a', 'b'];

/**
 * Folds whose `Max` is bound by the expression itself: a lambda parameter
 * and a block-local function. The symbol has a VALUE definition there, and
 * no operator definition, so the library check must not read the name.
 */
const LOCAL_FOLDS: Record<string, unknown> = {
  'a parameter named Max': ['Function', ['Reduce', WRITTEN, 'Max', 0], 'Max'],
  'a seedless fold over a parameter named Max': [
    'Function',
    ['Reduce', WRITTEN, 'Max'],
    'Max',
  ],
  'a block-local Max': [
    'Block',
    ['Declare', 'Max', "'function'"],
    ['Assign', 'Max', STEP],
    ['Reduce', WRITTEN, 'Max', 0],
  ],
  'a seedless fold over a block-local Max': [
    'Block',
    ['Declare', 'Max', "'function'"],
    ['Assign', 'Max', STEP],
    ['Reduce', WRITTEN, 'Max'],
  ],
};

describe('a combiner named Max that the expression binds itself', () => {
  for (const [name, json] of Object.entries(LOCAL_FOLDS)) {
    for (const to of ['javascript', 'interval-js']) {
      test(`${name}, on ${to}: the local function, or a decline`, () => {
        const ce = engine();
        let r: ReturnType<typeof compile> | undefined;
        try {
          r = compile(ce.box(json as never), {
            to: to as never,
            fallback: false,
          });
        } catch {
          r = undefined;
        }
        if (r === undefined || !r.success) return;
        // A compiled block must fold with the local step: 2·(2·1 + 2) + 3
        // at `x = 1`, as the interpreter does. Before, the library kernel
        // gave 3. A compiled lambda is called with the step.
        expect(to).toBe('javascript');
        const got = name.includes('parameter')
          ? (r.run!({ x: 1 }) as unknown as (f: unknown) => number)(
              (a: number, b: number) => 2 * a + b
            )
          : r.run!({ x: 1 });
        expect(got).toBe(11);
      });
    }
  }
});

describe('a function-form `operators` option', () => {
  test('that overrides nothing keeps the library kernel', () => {
    // A function-form `operators` holds every head of the fixed-width pass
    // in `unrollSkipHeads`; the fold asks the function for the name instead.
    const ce = engine();
    for (const json of [
      ['Reduce', 'V', 'Add'],
      ['Scan', 'V', 'Max'],
    ]) {
      const r = compile(ce.box(json as never), {
        to: 'javascript',
        fallback: false,
        operators: () => undefined,
      } as never);
      expect(r.success).toBe(true);
      expect(r.code).toMatch(/_a \+ _b|Math\.max\(_a, _b\)/);
    }
  });

  test('that overrides Max declines a Max fold', () => {
    const ce = engine();
    for (const json of [
      ['Reduce', 'V', 'Max'],
      ['Scan', 'V', 'Max'],
    ]) {
      expect(
        declines(ce, json, {
          operators: (name: string) =>
            name === 'Max' ? ['Math.max', 10] : undefined,
        })
      ).toBe(true);
    }
  });
});

describe('a user-defined Max over strings', () => {
  test('is not refused with the message about the library kernel', () => {
    const ce = engine();
    ce.declare('Max', {
      signature: '(string, string) -> string',
      evaluate: ([a]) => a,
    });
    let message = '';
    try {
      compile(ce.box(['Reduce', ['List', "'a'", "'b'"], 'Max'] as never), {
        to: 'javascript',
        fallback: false,
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/elements are not numbers/);
  });
});
