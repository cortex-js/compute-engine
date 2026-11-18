// The JavaScript lowerings of `Sort` with a sort key or a comparator, of
// `Iterate` under a consumer that bounds it, and of `Pipe`. Each compiled
// value is compared with the value of the interpreter for the same input.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type Json = any;

const ce = new ComputeEngine();
ce.declare('y', 'real');
ce.declare('L', 'list<real>');
ce.declare('n', 'real');
ce.declare('r', 'real');
ce.declare('z', 'complex');

/** The value of the compiled JavaScript of `expr` for the inputs `vars`. */
function compiled(expr: Json, vars: Record<string, unknown> = {}): unknown {
  const result: any = compile(
    ce.box(expr) as any,
    {
      to: 'javascript',
      fallback: false,
    } as any
  );
  expect(result.success).toBe(true);
  const value = result.run(vars);
  return Array.isArray(value) ? Array.from(value) : value;
}

/** The interpreter's value of `expr` with `values` substituted, as numbers.
 * An absent element is `undefined` and a `NaN` element is `NaN`. */
function interpreted(
  expr: Json,
  values: Record<string, Json> = {}
): number | Array<number | undefined> {
  const value = ce.box(expr).subs(values).evaluate();
  const number = (e: any): number | undefined =>
    e.symbol === 'Missing' ? undefined : e.N().re;
  if (value.isCollection) return Array.from(value.each(), number);
  return number(value)!;
}

const key = (body: Json): Json => ['Function', body, 'x'];

/** The real and imaginary parts of a compiled value. */
function complexParts(value: any): [number, number] {
  return typeof value === 'number' ? [value, 0] : [value.re, value.im];
}

const comparator = (body: Json): Json => ['Function', body, 'a', 'b'];

describe('COMPILED SORT WITH A COMPARATOR', () => {
  // A declared input cannot hold an absent element (a declared type cannot
  // name `missing`, `docs/ERROR-MODEL.md`, "`Missing` is a result only"), so
  // the absent element is written in the list, and only the interpreter is
  // checked.
  test('the result type is read over the present elements', () => {
    // The comparator is never called with an absent element, so a
    // `Missing` element does not make its result `boolean | missing`.
    const expr = [
      'Sort',
      ['List', 3, 'Missing', 1, 2],
      comparator(['Greater', 'a', 'b']),
    ];
    expect(interpreted(expr, {})).toEqual([3, 2, 1, undefined]);
  });
});

describe('COMPILED PIPE', () => {

  test('an assignment in a chained pipe is invalid, and the compile declines', () => {
    // An assignment as an operand of `Pipe` is the static error
    // `assignment-in-operand`.
    const expr = [
      'Block',
      ['Assign', 'c', 0],
      [
        'Pipe',
        ['Pipe', ['Assign', 'c', ['Add', 'c', 1]], 'Abs'],
        ['Function', 0, 'x'],
      ],
      'c',
    ];
    const engine = (): ComputeEngine => {
      const e = new ComputeEngine();
      e.declare('c', 'integer');
      return e;
    };
    expect(engine().box(expr).isValid).toBe(false);
    expect(() =>
      compile(
        engine().box(expr) as any,
        { to: 'javascript', fallback: false } as any
      )
    ).toThrow(/Could not compile/);
  });

  test('an application of a literal whose body is a list is not a scalar', () => {
    // `x ↦ [x, x]` returns a list, so the application that receives it maps
    // over it, as in the interpreter.
    const expr = [
      'Apply',
      key(['Multiply', 'x', 2]),
      ['Apply', key(['List', 'x', 'x']), 'y'],
    ];
    expect(interpreted(expr, { y: 4 })).toEqual([8, 8]);
    expect(compiled(expr, { y: 4 })).toEqual([8, 8]);
    const sum = ['Add', 1, ['Apply', key(['List', 'x', 'x']), 'y']];
    expect(interpreted(sum, { y: 4 })).toEqual([5, 5]);
    expect(compiled(sum, { y: 4 })).toEqual([5, 5]);
  });

  test('in strict mode, a real argument of an applied literal compiles', () => {
    // Strict mode keeps `√y` in the real lane, as for a call of a named
    // function: the argument is a real number (`NaN` for a negative `y`),
    // and the literal compiles.
    const sqrt: any = compile(
      ce.box(['Apply', key(['Multiply', 'x', 2]), ['Sqrt', 'y']]) as any,
      { to: 'javascript', fallback: false, mode: 'strict' } as any
    );
    expect(sqrt.success).toBe(true);
    expect(sqrt.run({ y: 4 })).toBe(4);
    expect(sqrt.run({ y: -4 })).toBeNaN();
  });

  test('a real argument of an applied literal compiles in strict mode', () => {
    const expr = ['Apply', key(['Multiply', 'x', 2]), 'y'];
    const strict: any = compile(
      ce.box(expr) as any,
      { to: 'javascript', fallback: false, mode: 'strict' } as any
    );
    const auto: any = compile(
      ce.box(expr) as any,
      { to: 'javascript', fallback: false } as any
    );
    expect(strict.success).toBe(true);
    expect(auto.mode).not.toBe('complex');
    expect(auto.code).toBe(strict.code);
    expect(strict.run({ y: 3 })).toBe(6);
  });

  test('an argument whose call-site type is a scalar that can be complex', () => {
    // The call `gc(y)` has the type `any`, but the variant of `gc` for a
    // real argument gives a number, so the call is emitted as a direct call
    // and its complex value reaches the parameter. The check reads the type
    // at the call site, for an applied literal and for a user function.
    ce.declare('gc', '(real) -> any');
    ce.assign(
      'gc',
      ce.box([
        'Function',
        [
          'Block',
          ['Declare', 'w', "'unknown'", ['Add', 'u', 'ImaginaryUnit']],
          'w',
        ],
        'u',
      ])
    );
    ce.assign('dbl2', ce.box(['Function', ['Multiply', 't', 2], 't']));
    // The compiler declines the call `dbl2(gc(y))`: its argument is not real.
    for (const expr of [
      ['Apply', ['Function', ['Multiply', 2, 't'], 't'], ['gc', 'y']],
    ]) {
      const value = ce.box(expr).subs({ y: 3 }).evaluate().N();
      expect([value.re, value.im]).toEqual([6, 2]);
      const cx: any = compile(
        ce.box(expr) as any,
        { to: 'javascript', fallback: false, mode: 'complex' } as any
      );
      expect(cx.success).toBe(true);
      expect(cx.mode).toBe('complex');
      expect(complexParts(cx.run({ y: 3 }))).toEqual([6, 2]);
      expect(complexParts(cx.run({ y: -1 }))).toEqual([-2, 2]);
      // In strict mode the complex value on the real lane is `NaN`: the
      // compilation is not checked.
    }
  });

  test('a point with a complex coordinate at an applied literal declines', () => {
    // The point is passed whole, and the compiled literal would read it as
    // one number (`{re: NaN, im: NaN}`). The application declines, and the
    // fallback gives the interpreter's value.
    const tuple = ['Tuple', ['Add', 'y', 'ImaginaryUnit'], 1];
    const one = ['Apply', ['Function', ['Multiply', 2, 't'], 't'], tuple];
    const value = ce.box(one).subs({ y: 3 }).evaluate();
    expect(value.ops!.map((c) => [c.N().re, c.N().im])).toEqual([
      [6, 2],
      [2, 0],
    ]);
    const two = [
      'Apply',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      tuple,
      'y',
    ];
    for (const expr of [one, two]) {
      for (const mode of [undefined, 'complex', 'strict']) {
        const result: any = compile(
          ce.box(expr) as any,
          { to: 'javascript', mode } as any
        );
        expect(result.success).toBe(false);
      }
    }
    const fallback: any = compile(ce.box(one) as any, { to: 'javascript' } as any);
    const run = fallback.run({ y: 3 });
    expect(Array.from(run, (c: any) => complexParts(c))).toEqual([
      [6, 2],
      [2, 0],
    ]);
  });

  test('other targets: an applied literal with a complex argument', () => {
    // The lane-mismatch check is for the JavaScript target only.
    const expr = ['Apply', key(['Multiply', 'x', 2]), ['Sqrt', 'y']];
    for (const to of ['interval-javascript', 'glsl']) {
      for (const mode of ['strict', undefined]) {
        let message = '';
        try {
          const r: any = compile(
            ce.box(expr) as any,
            { to, fallback: false, mode } as any
          );
          message = r.success ? '' : String(r.message ?? r.error);
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).not.toMatch(/function-literal parameter/);
      }
    }
  });
});
