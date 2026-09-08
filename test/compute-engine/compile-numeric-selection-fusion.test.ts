import { ComputeEngine, compile } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';

// Preserve ordinary CSE in the control while disabling only fusion admission.
class UnfusedTarget extends JavaScriptTarget {
  createTarget(options: Partial<CompileTarget<Expression>> = {}) {
    const target = super.createTarget(options);
    const selection = target.selection!;
    target.selection = (args, emit, current) =>
      selection(args, emit, { ...current, cse: undefined });
    return target;
  }
}
const shifts = [1, -1, 5, -5, 6, 4, -4, -6];
const neighbours = ['Add', ...shifts.map((x) => ['RotateLeft', 'S', x])];
const life = [
  'Which',
  ['Equal', neighbours, 3],
  1,
  ['Equal', neighbours, 2],
  'S',
  'True',
  0,
];

function pair(
  json: unknown,
  declarations: Record<string, string> = { S: 'list<number>' }
) {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(declarations))
    ce.declare(name, type);
  const expr = ce.expr(json as never);
  const options = { constantFold: false, fallback: false } as const;
  const fused = new JavaScriptTarget().compile(expr, options);
  const original = new UnfusedTarget().compile(expr, options);
  expect(fused.success).toBe(true);
  expect(original.success).toBe(true);
  return { ce, expr, fused, original };
}

describe('numeric selection fusion', () => {
  test('cse: false retains generic selection and equivalent results', () => {
    const { expr, fused } = pair(life);
    const disabled = new JavaScriptTarget().compile(expr, {
      constantFold: false,
      fallback: false,
      cse: false,
    });
    expect(disabled.success).toBe(true);
    expect(fused.code).toContain('_SYS.numericSelectionInputs(');
    expect(disabled.code).not.toContain('_SYS.numericSelectionInputs(');
    for (const size of [1, 5, 25]) {
      const S = Array.from({ length: size }, (_, i) => (i % 7 < 3 ? 1 : 0));
      expect(disabled.run!({ S })).toEqual(fused.run!({ S }));
    }
  });

  test('the Life step produces a fresh output and preserves its input', () => {
    const { fused, original } = pair(life);
    expect(fused.code).toContain('_SYS.numericSelectionInputs(');
    const fast = fused.code!.slice(fused.code!.lastIndexOf('const _tv'));
    expect(fast).not.toContain('_SYS.eq');
    for (const size of [1, 2, 5, 25, 400]) {
      const S = Array.from({ length: size }, (_, i) => (i % 7 < 3 ? 1 : 0));
      const before = [...S];
      const output = fused.run!({ S });
      expect(output).toEqual(original.run!({ S }));
      expect(output).not.toBe(S);
      expect(S).toEqual(before);
    }
  });

  test.each([
    'Equal',
    'NotEqual',
    'Less',
    'LessEqual',
    'Greater',
    'GreaterEqual',
  ])('%s matches the original comparison at numeric boundaries', (relation) => {
    const { fused, original } = pair([
      'Which',
      [relation, ['Add', 'S', 0], 2],
      7,
      'True',
      9,
    ]);
    expect(fused.code).toContain('_SYS.numericSelectionInputs(');
    const S = [
      -Infinity,
      -2,
      -0,
      0,
      Number.MIN_VALUE,
      2 - 1e-11,
      2,
      2 + 1e-11,
      Infinity,
      NaN,
    ];
    expect(fused.run!({ S })).toEqual(original.run!({ S }));
  });

  test('rotations and numeric arithmetic preserve rotations and scalars', () => {
    const json = [
      'Which',
      ['GreaterEqual', ['Abs', ['Subtract', ['RotateRight', 'S', -8], 'x']], 2],
      ['Divide', ['Multiply', ['Square', 'S'], 'x'], 3],
      'True',
      ['Floor', ['Negate', 'S']],
    ];
    const { fused, original } = pair(json, { S: 'list<number>', x: 'real' });
    expect(fused.code).toContain('_SYS.numericSelectionInputs(');
    for (const x of [-Infinity, -2, -0, 0, 0.5, Infinity, NaN]) {
      const vars = { S: [-2, -0, 0, 1.5, Infinity, NaN], x };
      expect(fused.run!(vars)).toEqual(original.run!(vars));
    }
  });

  test.each([2, 3, 4, 5])(
    'Power with exponent %i matches the original at numeric boundaries',
    (exponent) => {
      const { fused, original } = pair(
        ['Which', ['Equal', 'T', 1], ['Power', 'S', exponent], 'True', 0],
        { S: 'list<number>', T: 'list<number>' }
      );
      expect(fused.code).toContain('_SYS.numericSelectionInputs(');
      const S = [-3, -1.5, -0, 0, 0.5, 2, -Infinity, Infinity, NaN];
      // Select the power independently of its base, including NaN and infinities.
      const vars = { S, T: S.map(() => 1) };
      expect(fused.run!(vars)).toEqual(original.run!(vars));
    }
  );

  test('fallback preserves empty, nested, sparse, nonnumeric, and scalar inputs', () => {
    const { fused, original } = pair(life);
    for (const S of [
      [],
      [[1], [0]],
      [1, undefined, 0],
      [1, '2', 0],
      new Array(3),
      1,
      NaN,
      undefined,
    ]) {
      const outcome = (run: typeof fused.run) => {
        try {
          return { value: run!({ S }) };
        } catch (error) {
          return { error: (error as Error).message };
        }
      };
      expect(outcome(fused.run)).toEqual(outcome(original.run));
    }
  });

  test('array length mismatch is checked only when its arm is reached', () => {
    const { fused, original } = pair(
      ['Which', ['Equal', 'S', 2], 'T', 'True', 0],
      { S: 'list<number>', T: 'list<number>' }
    );
    for (const vars of [
      { S: [1, 1], T: [4] },
      { S: [2, 1], T: [4] },
      { S: [2, 1], T: [4, 5] },
    ])
      expect(fused.run!(vars)).toEqual(original.run!(vars));
  });

  test('equality uses the engine tolerance', () => {
    const ce = new ComputeEngine();
    ce.tolerance = 0.01;
    ce.declare('S', 'list<number>');
    const expr = ce.expr(['Which', ['Equal', 'S', 2], 7, 'True', 9]);
    const fused = new JavaScriptTarget().compile(expr);
    const original = new UnfusedTarget().compile(expr);
    expect(fused.run!({ S: [2.001, 2.02] })).toEqual(
      original.run!({ S: [2.001, 2.02] })
    );
  });

  test('array-array equality retains whole-value semantics', () => {
    const { fused, original } = pair(
      ['Which', ['Equal', 'S', 'T'], 7, 'True', 9],
      { S: 'list<number>', T: 'list<number>' }
    );
    expect(fused.code).not.toContain('_SYS.numericSelectionInputs(');
    expect(fused.run!({ S: [1, 2], T: [1, 2] })).toBe(
      original.run!({ S: [1, 2], T: [1, 2] })
    );
  });

  test('an early scalar true keeps the selected arm whole', () => {
    const { fused, original } = pair([
      'Which',
      'True',
      7,
      ['Equal', 'S', 2],
      9,
    ]);
    expect(fused.code).not.toContain('_SYS.numericSelectionInputs(');
    expect(fused.run!({ S: [1, 2] })).toBe(original.run!({ S: [1, 2] }));
  });

  test('unmatched positions and a false clause agree with selection', () => {
    const { fused, original } = pair([
      'Which',
      'False',
      5,
      ['Equal', 'S', 2],
      7,
    ]);
    expect(fused.run!({ S: [1, 2, NaN] })).toEqual(
      original.run!({ S: [1, 2, NaN] })
    );
  });

  test('If and arithmetic over multiple lists preserve shape and missing inputs', () => {
    const { fused, original } = pair(
      [
        'If',
        ['Less', ['Add', 'S', 'T'], 'x'],
        ['Subtract', 'S', 'T'],
        ['Divide', 'T', 'x'],
      ],
      { S: 'list<number>', T: 'list<number>', x: 'real' }
    );
    expect(fused.code).toContain('_SYS.numericSelectionInputs(');
    for (const vars of [
      { S: [1, 2, Infinity], T: [3, 4, -Infinity], x: 0 },
      { S: [1, 2], T: [3], x: 3 },
      { S: [1, 2], T: [3, 4] },
    ])
      expect(fused.run!(vars)).toEqual(original.run!(vars));
  });

  test('repeated compilation is deterministic and complex mode retains its own lowering', () => {
    const { expr, fused } = pair(life);
    expect(
      new JavaScriptTarget().compile(expr, { constantFold: false }).code
    ).toBe(fused.code);
    const complex = compile(expr, { mode: 'complex', constantFold: false });
    expect(complex.code).not.toContain('_SYS.numericSelectionInputs(');
  });

  test('caller mappings and effectful arms retain the generic path', () => {
    const { ce, expr } = pair(life);
    const mapped = compile(expr, {
      vars: { S: '_.read()' },
      constantFold: false,
    });
    expect(mapped.code).not.toContain('_SYS.numericSelectionInputs(');
    const custom = compile(expr, {
      functions: { Add: 'customAdd' },
      constantFold: false,
    });
    expect(custom.code).not.toContain('_SYS.numericSelectionInputs(');
    ce.declare('draw', '() -> real');
    const impure = compile(
      ce.expr(['Which', ['Equal', 'S', 2], ['draw'], 'True', 0]),
      { functions: { draw: '_.draw' }, constantFold: false }
    );
    expect(impure.code).not.toContain('_SYS.numericSelectionInputs(');
    let calls = 0;
    const draw = () => {
      calls++;
      return 7;
    };
    expect(impure.run!({ S: [1, 1], draw })).toEqual([0, 0]);
    expect(calls).toBe(0);
    expect(impure.run!({ S: [2, 2], draw })).toEqual([7, 7]);
    expect(calls).toBe(1);
  });
});

describe('numeric selection fusion — carrier declarations', () => {
  // The entry plan classes a `list` and an `indexed_collection` input alike
  // as a JS array (`isListEntryType`); the fusion gate must agree, or a
  // consumer that declares its lists `indexed_collection` stays on the
  // generic selection with no visible reason.
  test.each([
    'list<number>',
    'list<integer>',
    'indexed_collection<number>',
    // A bare kind declares `unknown` elements: the runtime guard, not the
    // declaration, establishes numeric cells.
    'list',
    'indexed_collection',
  ])('a carrier declared %s fuses', (type) => {
    const { fused, original } = pair(life, { S: type });
    expect(fused.code).toContain('_SYS.numericSelectionInputs(');
    for (const size of [1, 5, 25]) {
      const S = Array.from({ length: size }, (_, i) => (i % 7 < 3 ? 1 : 0));
      expect(fused.run!({ S })).toEqual(original.run!({ S }));
    }
  });

  test('an empty carrier takes the generic selection', () => {
    const { fused, original } = pair(life, { S: 'indexed_collection<number>' });
    // The runtime guard, not the declaration, selects the fused loop.
    expect(fused.run!({ S: [] })).toEqual(original.run!({ S: [] }));
  });
});
