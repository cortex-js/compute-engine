import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The list carrier of the `javascript` target is the plain `Array`. The
 * contract of `run()` is: inputs of the shape the compiled code reads,
 * results read-only. On a binding whose declared type proves a JS array, the
 * entry refuses a string and a numeric typed array (`Float64Array`,
 * `Int32Array`, ...), and passes every other value as it is. A plain `Array`
 * gives the expected result. The typed array is refused with a `TypeError`
 * that names the binding (one brand check per binding per call): the
 * compiled code reads plain arrays only, and a host that holds a typed array
 * converts it once, on its side, with `Array.from`.
 *
 * Until 2026-10-13 the runner copied a typed-array input to a plain array on
 * every call. The user replaced that copy with the refusal on 2026-10-13,
 * because its cost grew with the data on every call (Tycho ledger row 371, a
 * kernel called about 1.2 million times with a 9 801-element list input, was
 * the motivating case). The design text is in `docs/COMPILATION-MODEL.md` (search for
 * "inputs of the shape"); the earlier typed-array study is in
 * `docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.
 */

/** An engine with `S` declared as a valueless list of numbers. */
function listEngine(type = 'list<number>'): ComputeEngine {
  const e = new ComputeEngine();
  e.declare('S', type as any);
  return e;
}

describe('COMPILE list entry check (vars route)', () => {
  it('leaves a real-typed symbol accepting a scalar', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    const r = compile(e.box(['Add', 'x', 1]), { to: 'javascript' })!;
    expect(r.success).toBe(true);
    expect(r.run!({ x: 5 } as any)).toBe(6);
  });
});

describe('COMPILE list entry check (args route)', () => {
  /** A compiled lambda with one `list<number>` parameter. */
  function lambdaUnit(): (arg: unknown) => unknown {
    const e = new ComputeEngine();
    const r = compile(
      e.box([
        'Function',
        ['Add', ['At', 'v', 1], 1],
        ['Typed', 'v', { str: 'list<number>' }],
      ]),
      { to: 'javascript' }
    )!;
    expect(r.success).toBe(true);
    return r.run as unknown as (arg: unknown) => unknown;
  }

  it('accepts a plain array; refuses a numeric typed array', () => {
    // The argument is not converted: the entry throws a `TypeError` that
    // names the parameter. A caller converts with `Array.from`.
    const run = lambdaUnit();
    expect(run([10, 20])).toBe(11);
    expect(() => run(new Float64Array([10, 20]))).toThrow(
      /argument 1 is compiled as a JavaScript array, and compiled code does not accept a typed array/
    );
    expect(run(Array.from(new Float64Array([10, 20])))).toBe(11);
  });

  it('leaves an unannotated parameter unchecked', () => {
    const e = new ComputeEngine();
    const r = compile(e.box(['Function', ['Add', 'w', 1], 'w']), {
      to: 'javascript',
    })!;
    expect(r.success).toBe(true);
    expect((r.run as unknown as (x: unknown) => unknown)(4)).toBe(5);
  });
});

describe('COMPILE list entry: interpreter fallback with text', () => {
  // `S: string | list<number>` is not provably a string, so `At` and
  // `Characters` do not compile and the interpreter runs them instead. A
  // character the interpreter answers is a JS string, as compiled code
  // answers `At(s, 1)` for `s: string` — never `NaN`.
  it('answers a character result as a string', () => {
    const e = listEngine('string | list<number>');
    const r = compile(e.box(['At', 'S', 1]), { to: 'javascript' })!;
    expect(r.success).toBe(false);
    expect(r.run!({ S: 'abc' } as any)).toBe('a');
    expect(r.run!({ S: [4, 5, 6] } as any)).toBe(4);
  });

  it('answers a list of characters as an array of strings', () => {
    const e = listEngine('string | list<number>');
    const r = compile(e.box(['Characters', 'S']), { to: 'javascript' })!;
    expect(r.success).toBe(false);
    expect(r.run!({ S: 'abc' } as any)).toEqual(['a', 'b', 'c']);
  });
});
