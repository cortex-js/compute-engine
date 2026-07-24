import { ComputeEngine } from '../../src/compute-engine';

//
// `Declare` with a `Tuple` pattern in the name position — the engine form
// behind Cortex destructuring declarations (`let (x, y) = t`). The pattern is
// held raw (canonicalizing it would bind the about-to-be-declared names);
// each component declares in the current scope. Shape mismatches yield an
// incompatible-type error value and bind nothing else.
//

const attrs = (value: unknown, constant = false) =>
  [
    'Dictionary',
    ['KeyValuePair', { sym: 'value' }, value],
    ...(constant ? [['KeyValuePair', { sym: 'constant' }, 'True']] : []),
  ] as any;

describe('Declare with a Tuple pattern', () => {
  test('binds each component (box route)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y'], attrs(['Tuple', 3, 4])])
      .evaluate();
    expect(r.toString()).toBe('(3, 4)');
    expect(ce.parse('x + y').evaluate().isSame(7)).toBe(true);
  });

  test('a symbol value resolves to its tuple before splicing', () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.box(['Tuple', 3, 4]));
    ce.box(['Declare', ['Tuple', 'x', 'y'], attrs('p')]).evaluate();
    expect(ce.parse('10x + y').evaluate().isSame(34)).toBe(true);
  });

  test('nested patterns and `_` wildcards', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Declare',
      ['Tuple', ['Tuple', 'a', 'b'], '_', 'c'],
      attrs(['Tuple', ['Tuple', 1, 2], 99, 5]),
    ]).evaluate();
    expect(ce.parse('a + b + c').evaluate().isSame(8)).toBe(true);
  });

  test('constant attribute freezes every binding', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Declare',
      ['Tuple', 'x', 'y'],
      attrs(['Tuple', 3, 4], true),
    ]).evaluate();
    // Engine-level assignment to a constant throws (the Cortex runtime
    // surfaces this as a `runtime-error` diagnostic).
    expect(() => ce.box(['Assign', 'x', 9]).evaluate()).toThrow();
    expect(ce.symbol('x').evaluate().isSame(3)).toBe(true);
  });

  test('a length mismatch is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y', 'z'], attrs(['Tuple', 1, 2])])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a non-tuple value is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y'], attrs(5)])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a pattern without a value stays inert', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Declare', ['Tuple', 'x', 'y']]).evaluate();
    expect(r.operator).toBe('Declare');
  });
});

//
// Compilation: a destructuring declare with a LITERAL tuple value desugars to
// per-leaf declares (each element bound once, in order — observationally
// identical to the interpreter). A non-literal value or a shape mismatch
// fails closed (D6) so the engine falls back to the interpreter. Regression:
// the pattern used to compile as a single `let _ = …`, silently yielding NaN
// behind `success: true`.
//
describe('Declare with a Tuple pattern: compilation', () => {
  const {
    compile,
  } = require('../../src/compute-engine/compilation/compile-expression');
  const { parseCortex } = require('../../src/cortex/parse-cortex');
  const strip = (x: any) =>
    JSON.parse(
      JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
    );
  const boxed = (src: string) => {
    const ce = new ComputeEngine();
    const [ast] = parseCortex(src);
    return ce.box(strip(ast));
  };

  test('a literal tuple value compiles and matches the interpreter', () => {
    const expr = boxed('do { let (a, b) = (3, 4); 10*a + b }');
    const r = compile(expr);
    expect(r?.success).toBe(true);
    expect(r!.run!()).toBe(34);
    expect(expr.evaluate().isSame(34)).toBe(true);
  });

  test('nested patterns and wildcards compile', () => {
    const nested = compile(
      boxed('do { let ((a, b), c) = ((1, 2), 5); a + b + c }')
    );
    expect(nested?.success).toBe(true);
    expect(nested!.run!()).toBe(8);
    const wild = compile(boxed('do { let (a, _, c) = (1, 99, 5); a + c }'));
    expect(wild?.success).toBe(true);
    expect(wild!.run!()).toBe(6);
  });

  test('complex-valued leaves flow through the complex inference', () => {
    const r = compile(boxed('do { let (a, b) = (2 + 3i, 1 - i); a * b }'));
    expect(r?.success).toBe(true);
    expect(r!.run!()).toEqual({ re: 5, im: 1 });
  });

  test('a non-literal tuple value fails closed (interpreter fallback)', () => {
    const expr = boxed('do { let p = (3, 4); let (x, y) = p; 10*x + y }');
    const r = compile(expr);
    expect(r?.success).toBe(false);
    // The interpreter handles it correctly.
    expect(expr.evaluate().isSame(34)).toBe(true);
  });

  test('a shape mismatch fails closed', () => {
    const r = compile(boxed('do { let (x, y, z) = (1, 2); 0 }'));
    expect(r?.success).toBe(false);
  });
});
