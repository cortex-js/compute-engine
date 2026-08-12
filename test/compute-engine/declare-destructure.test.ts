import { ComputeEngine } from '../../src/compute-engine';

//
// `Declare` with a `Tuple` pattern in the name position — the engine form
// behind Epsil destructuring declarations (`let (x, y) = t`). The pattern is
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
    // Engine-level assignment to a constant throws (the Epsil runtime
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

  test('a shape mismatch NESTED under a bound sibling declares nothing', () => {
    // The whole pattern is matched before anything is declared, so the
    // `(b, c)` mismatch stops `a` from being declared too.
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Declare',
        ['Tuple', 'a', ['Tuple', 'b', 'c']],
        attrs(['Tuple', 1, 5]),
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(ce.symbol('a').evaluate().symbol).toBe('a');
  });

  test('a pattern without a value stays inert', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Declare', ['Tuple', 'x', 'y']]).evaluate();
    expect(r.operator).toBe('Declare');
  });
});

//
// The POSITIONAL value form — `Declare(pattern, type, value)`, the same
// `(symbol, type?, value?, attributes?)` signature a symbol name uses, with
// `"unknown"` as the no-annotation filler in the type slot. The tuple path
// used to read the value ONLY from the attributes dictionary, so a positional
// value declared nothing at all and the statement silently evaluated to
// `Declare(…)` — while the compiler (which reads either shape) computed the
// right answer. Both forms now go through ONE operand resolution.
//
describe('Declare with a Tuple pattern: the positional value operand', () => {
  test('a positional tuple value binds each component (box route)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        ['Declare', ['Tuple', 'x', 'y'], { str: 'unknown' }, ['Tuple', 3, 4]],
        ['Add', ['Multiply', 10, 'x'], 'y'],
      ])
      .evaluate();
    expect(r.isSame(34)).toBe(true);
  });

  test('the declaration evaluates to the tuple value', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y'], { str: 'unknown' }, ['Tuple', 3, 4]])
      .evaluate();
    expect(r.toString()).toBe('(3, 4)');
    expect(ce.parse('10x + y').evaluate().isSame(34)).toBe(true);
  });

  test('a positional symbol value resolves to its tuple before splicing', () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.box(['Tuple', 3, 4]));
    ce.box(['Declare', ['Tuple', 'x', 'y'], { str: 'unknown' }, 'p']).evaluate();
    expect(ce.parse('10x + y').evaluate().isSame(34)).toBe(true);
  });

  test('nested patterns and `_` wildcards, positionally', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        [
          'Declare',
          ['Tuple', ['Tuple', 'a', 'b'], '_', 'c'],
          { str: 'unknown' },
          ['Tuple', ['Tuple', 1, 2], 99, 5],
        ],
        ['Add', 'a', 'b', 'c'],
      ])
      .evaluate();
    expect(r.isSame(8)).toBe(true);
  });

  test('a positional shape mismatch still fails fast', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Declare',
        ['Tuple', 'x', 'y', 'z'],
        { str: 'unknown' },
        ['Tuple', 1, 2],
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
    // Nothing was declared: the whole pattern is matched before any write.
    expect(ce.symbol('x').evaluate().symbol).toBe('x');
  });

  test('a positional non-tuple value is an error value', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Declare', ['Tuple', 'x', 'y'], { str: 'unknown' }, 5])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a positional value wins over an attributes `value` (as for a symbol)', () => {
    // The precedence the scalar path already has: `Declare(a, "unknown", 5,
    // {value -> 99})` binds 5.
    const scalar = new ComputeEngine();
    expect(
      scalar
        .box([
          'Declare',
          'a',
          { str: 'unknown' },
          5,
          ['Dictionary', ['KeyValuePair', 'value', 99]],
        ])
        .evaluate()
        .isSame(5)
    ).toBe(true);

    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        [
          'Declare',
          ['Tuple', 'x', 'y'],
          { str: 'unknown' },
          ['Tuple', 3, 4],
          ['Dictionary', ['KeyValuePair', 'value', ['Tuple', 7, 8]]],
        ],
        ['Add', ['Multiply', 10, 'x'], 'y'],
      ])
      .evaluate();
    expect(r.isSame(34)).toBe(true);
  });

  test('the `constant` attribute still applies with a positional value', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Declare',
      ['Tuple', 'x', 'y'],
      { str: 'unknown' },
      ['Tuple', 3, 4],
      ['Dictionary', ['KeyValuePair', 'constant', 'True']],
    ]).evaluate();
    expect(() => ce.box(['Assign', 'x', 9]).evaluate()).toThrow();
    expect(ce.symbol('x').evaluate().isSame(3)).toBe(true);
  });

  test('a scalar positional declaration is unchanged', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Block', ['Declare', 'a', { str: 'unknown' }, 5], ['Add', 'a', 1]])
      .evaluate();
    expect(r.isSame(6)).toBe(true);
  });

  test('a type in the type slot applies to each name (PINNED, not endorsed)', () => {
    // No route emits this — the Epsil surface rejects a `:` annotation on a
    // destructuring `let`, and `"unknown"` is the filler the positional form
    // needs. Recorded so a change is deliberate: the type reaches every bound
    // name, exactly as it does for a symbol name, so a type describing the
    // WHOLE tuple is an error value (not a silently-skipped declaration).
    const ok = new ComputeEngine();
    ok.box([
      'Declare',
      ['Tuple', 'x', 'y'],
      { str: 'integer' },
      ['Tuple', 3, 4],
    ]).evaluate();
    expect(ok.symbol('x').type.toString()).toBe('integer');

    const bad = new ComputeEngine();
    const r = bad
      .box([
        'Declare',
        ['Tuple', 'x', 'y'],
        { str: 'tuple<integer, integer>' },
        ['Tuple', 3, 4],
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a leaf that does not fit the type declares NOTHING (second leaf)', () => {
    // The declared type applies to each name, so `4.5` fails at `y`. That
    // failure is found before anything is written: `x` must not be left bound
    // — the same fail-fast a shape mismatch has always had.
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Declare',
        ['Tuple', 'x', 'y'],
        { str: 'integer' },
        ['Tuple', 3, 4.5],
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
    // The blamed name is the offending one, not the first one.
    expect(r.toString()).toContain('"y"');
    expect(ce.box('x').evaluate().symbol).toBe('x');
    expect(ce.box('y').evaluate().symbol).toBe('y');
  });

  test('a leaf that does not fit the type declares NOTHING (first leaf)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Declare',
        ['Tuple', 'x', 'y'],
        { str: 'integer' },
        ['Tuple', 3.5, 4],
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('"x"');
    expect(ce.box('x').evaluate().symbol).toBe('x');
    expect(ce.box('y').evaluate().symbol).toBe('y');
  });

  test('a failing leaf NESTED under bound siblings declares nothing', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Declare',
        ['Tuple', 'a', ['Tuple', 'b', 'c']],
        { str: 'integer' },
        ['Tuple', 1, ['Tuple', 2, 3.5]],
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('"c"');
    expect(ce.box('a').evaluate().symbol).toBe('a');
    expect(ce.box('b').evaluate().symbol).toBe('b');
    expect(ce.box('c').evaluate().symbol).toBe('c');
  });

  test('every leaf fitting the type binds them all', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Declare',
        ['Tuple', 'x', 'y'],
        { str: 'integer' },
        ['Tuple', 3, 4],
      ])
      .evaluate();
    expect(r.toString()).toBe('(3, 4)');
    expect(ce.box('x').evaluate().isSame(3)).toBe(true);
    expect(ce.box('y').evaluate().isSame(4)).toBe(true);
    expect(ce.symbol('x').type.toString()).toBe('integer');
    expect(ce.symbol('y').type.toString()).toBe('integer');
  });

  test('the Epsil surface route (dictionary form) still binds', () => {
    // `let (a, b) = (1, 2)` emits the trailing-attributes shape; the surface
    // language must be unaffected by the positional-form fix.
    const {
      executeEpsil,
    } = require('../../src/epsil/execute-epsil');
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let (a, b) = (1, 2)');
    expect(ce.parse('10a + b').evaluate().isSame(12)).toBe(true);
  });
});

//
// `Assign` with a `Tuple` pattern in the target position — the engine form
// behind Epsil destructuring assignments (`(x, y) := t`). Same pattern
// grammar as the declaration form, but it WRITES existing bindings, so the
// targets keep their identity and their declared type. The RHS is evaluated
// once, up front, before any target is written — that is what makes a swap a
// swap.
//
describe('Assign with a Tuple pattern', () => {
  test('writes each target (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 1);
    ce.assign('b', 2);
    const r = ce
      .box(['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', 'a']])
      .evaluate();
    expect(r.toString()).toBe('(2, 1)');
    expect(ce.symbol('a').evaluate().isSame(2)).toBe(true);
    expect(ce.symbol('b').evaluate().isSame(1)).toBe(true);
  });

  test('the RHS is evaluated before any target is written (swap)', () => {
    // The whole point: a per-leaf rewrite `a = b; b = a` would give (2, 2).
    const ce = new ComputeEngine();
    ce.assign('a', 1);
    ce.assign('b', 2);
    ce.assign('c', 3);
    ce.box(['Assign', ['Tuple', 'a', 'b', 'c'], ['Tuple', 'c', 'a', 'b']])
      .evaluate();
    expect(
      ce.box(['Tuple', 'a', 'b', 'c']).evaluate().toString()
    ).toBe('(3, 1, 2)');
  });

  test('the pattern is held RAW through canonicalization', () => {
    // Canonicalizing the target would fold a single-letter name into the
    // library constant of that name — `i` into `ImaginaryUnit` — and the
    // assignment would write the wrong thing (or nothing).
    const ce = new ComputeEngine();
    const e = ce.box(['Assign', ['Tuple', 'i', 'j'], ['Tuple', 1, 2]]);
    expect(e.json).toEqual(['Assign', ['Tuple', 'i', 'j'], ['Tuple', 1, 2]]);
  });

  test('nested patterns and `_` wildcards', () => {
    const ce = new ComputeEngine();
    for (const n of ['a', 'b', 'c']) ce.assign(n, 0);
    ce.box([
      'Assign',
      ['Tuple', ['Tuple', 'a', 'b'], '_', 'c'],
      ['Tuple', ['Tuple', 1, 2], 99, 5],
    ]).evaluate();
    expect(ce.parse('a + b + c').evaluate().isSame(8)).toBe(true);
  });

  test('a length mismatch is an error value, and writes nothing', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.assign('y', 2);
    const r = ce
      .box(['Assign', ['Tuple', 'x', 'y'], ['Tuple', 1, 2, 3]])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
    expect(ce.symbol('x').evaluate().isSame(1)).toBe(true);
  });

  test('a non-tuple value is an error value', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.assign('y', 2);
    const r = ce.box(['Assign', ['Tuple', 'x', 'y'], 5]).evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a shape mismatch NESTED under a bound sibling writes nothing', () => {
    // Two-phase: the whole pattern is matched before anything is written, so
    // the `(b, c)` mismatch stops `a` from being written too. (When matching
    // and binding shared one pass, `a` was already 1 by the time the nested
    // level was checked.)
    const ce = new ComputeEngine();
    for (const n of ['a', 'b', 'c']) ce.assign(n, 0);
    const r = ce
      .box(['Assign', ['Tuple', 'a', ['Tuple', 'b', 'c']], ['Tuple', 1, 5]])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(ce.symbol('a').evaluate().isSame(0)).toBe(true);
  });

  test('a value that does not fit a target type is an error value', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.declare('y', 'integer');
    ce.assign('x', 1);
    ce.assign('y', 2);
    // A value DIFFERENT from `x`'s current one, so the assertion below cannot
    // pass by accident.
    const r = ce
      .box(['Assign', ['Tuple', 'x', 'y'], ['Tuple', 99, { str: 'oops' }]])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('incompatible-type');
    // ATOMIC, like a shape mismatch (above): every leaf is validated against
    // its target's existing binding before the first write, so `x` keeps its
    // OLD value. (Assignment failure preserves prior values — unlike the
    // destructuring `let`, where the names simply stay unbound.) This test used
    // to pin the opposite: `x` was already 99 by the time `y` was rejected.
    expect(ce.symbol('x').evaluate().isSame(1)).toBe(true);
  });

  test('a second-leaf type failure blames it and preserves the first', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.declare('y', 'integer');
    ce.assign('x', 1);
    ce.assign('y', 2);
    const r = ce
      .box(['Assign', ['Tuple', 'x', 'y'], ['Tuple', 7, 4.5]])
      .evaluate();
    expect(r.isValid).toBe(false);
    // The BLAMED name is the offending leaf, not the first one — the same
    // diagnostic the sequential write produced.
    expect(r.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "finite_real"), "y")'
    );
    expect(ce.symbol('x').evaluate().isSame(1)).toBe(true);
    expect(ce.symbol('y').evaluate().isSame(2)).toBe(true);
  });

  test('a FIRST-leaf type failure preserves both targets', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.declare('y', 'integer');
    ce.assign('x', 1);
    ce.assign('y', 2);
    const r = ce
      .box(['Assign', ['Tuple', 'x', 'y'], ['Tuple', 4.5, 7]])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('"x"');
    expect(ce.symbol('x').evaluate().isSame(1)).toBe(true);
    expect(ce.symbol('y').evaluate().isSame(2)).toBe(true);
  });

  test('a nested pattern with a failing inner leaf preserves every target', () => {
    const ce = new ComputeEngine();
    for (const n of ['a', 'b', 'c']) {
      ce.declare(n, 'integer');
      ce.assign(n, 0);
    }
    const r = ce
      .box([
        'Assign',
        ['Tuple', 'a', ['Tuple', 'b', 'c']],
        ['Tuple', 1, ['Tuple', 2, 3.5]],
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toContain('"c"');
    expect(ce.symbol('a').evaluate().isSame(0)).toBe(true);
    expect(ce.symbol('b').evaluate().isSame(0)).toBe(true);
    expect(ce.symbol('c').evaluate().isSame(0)).toBe(true);
  });

  test('a `const` target in second position writes nothing', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 1);
    ce.declare('b', { value: 2, isConstant: true });
    // A constant target is rejected by a THROW on the host route, exactly as
    // the scalar `b := 20` is — the pre-pass does not change the channel, only
    // the timing.
    expect(() =>
      ce.box(['Assign', ['Tuple', 'a', 'b'], ['Tuple', 10, 20]]).evaluate()
    ).toThrow('Cannot assign a value to the constant "b"');
    expect(ce.symbol('a').evaluate().isSame(1)).toBe(true);
    expect(ce.symbol('b').evaluate().isSame(2)).toBe(true);
  });

  test('the success path and the swap are unaffected by the pre-pass', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.declare('y', 'integer');
    ce.assign('x', 1);
    ce.assign('y', 2);
    const r = ce
      .box(['Assign', ['Tuple', 'x', 'y'], ['Tuple', 'y', 'x']])
      .evaluate();
    expect(r.toString()).toBe('(2, 1)');
    expect(ce.symbol('x').evaluate().isSame(2)).toBe(true);
    expect(ce.symbol('y').evaluate().isSame(1)).toBe(true);
  });

  test('the Epsil route: a rejected leaf leaves the first target alone', () => {
    const {
      executeEpsil,
    } = require('../../src/epsil/execute-epsil');
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'let x: integer = 1\nlet y: integer = 2\n(x, y) := (7, 4.5)'
    );
    // The failing statement is the LAST one, so the runtime error is the
    // program's value (not a diagnostic).
    expect(r.value.isValid).toBe(false);
    expect(r.value.toString()).toContain('incompatible-type');
    expect(ce.symbol('x').evaluate().isSame(1)).toBe(true);
    expect(ce.symbol('y').evaluate().isSame(2)).toBe(true);
  });

  test('it is a `scope` effect, typed by the RHS', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 1);
    ce.assign('b', 2);
    const e = ce.box(['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', 'a']]);
    expect([...(e.effects ?? [])]).toEqual(['scope']);
    expect(e.type.toString()).toBe('tuple<integer, integer>');
  });

  test('the `ce.function` route agrees with the box route', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 1);
    ce.assign('b', 2);
    const r = ce
      .function('Assign', [
        ce.function('Tuple', [ce.symbol('a'), ce.symbol('b')]),
        ce.function('Tuple', [ce.symbol('b'), ce.symbol('a')]),
      ])
      .evaluate();
    expect(r.toString()).toBe('(2, 1)');
    expect(ce.symbol('a').evaluate().isSame(2)).toBe(true);
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
  const { parseEpsil } = require('../../src/epsil/parse-epsil');
  const strip = (x: any) =>
    JSON.parse(
      JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
    );
  const boxed = (src: string) => {
    const ce = new ComputeEngine();
    const [ast] = parseEpsil(src);
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

  test('a destructuring declare in VALUE position fails closed', () => {
    // The rewrite ends on the last leaf's declare, whose value is that leaf's,
    // not the tuple's. Refused EXPLICITLY: it used to be desugared here too
    // and fail closed only because `return let b = 4` is a syntax error.
    const expr = boxed('do { let a = 1; let (x, y) = (3, 4) }');
    expect(compile(expr)?.success).toBe(false);
    expect(expr.evaluate().toString()).toBe('(3, 4)');
  });

  test('a scalar assignment still compiles', () => {
    const r = compile(boxed('do { let x = 1; x := 42; x }'));
    expect(r?.success).toBe(true);
    expect(r!.run!()).toBe(42);
  });
});

//
// A destructuring ASSIGNMENT lowers to per-leaf temporaries followed by
// per-leaf writes: `(a, b) := (b, a + b)` ⟶ `let _tv1 = b; let _tv2 = a + b;
// a = _tv1; b = _tv2`. The temporaries are what make it sound — the targets
// already exist, so the naive per-leaf rewrite `a = b; b = a` would read the
// `a` it just clobbered. Regression: a tuple target used to compile as
// `_ = …`, leaving every target at its old value behind `success: true`.
//
describe('Assign with a Tuple pattern: compilation', () => {
  const {
    compile,
  } = require('../../src/compute-engine/compilation/compile-expression');
  const { parseEpsil } = require('../../src/epsil/parse-epsil');
  const strip = (x: any) =>
    JSON.parse(
      JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
    );
  const boxed = (src: string) => {
    const ce = new ComputeEngine();
    const [ast] = parseEpsil(src);
    return ce.box(strip(ast));
  };
  /** Compile `src`, assert it compiled, and assert it agrees with the
   * interpreter — the property that matters for every case below. */
  const agrees = (src: string, expected: number) => {
    const expr = boxed(src);
    const r = compile(expr);
    expect(r?.success).toBe(true);
    expect(r!.run!()).toBe(expected);
    expect(expr.evaluate().isSame(expected)).toBe(true);
  };

  test('a swap compiles, via temporaries', () => {
    agrees('do { let a = 1; let b = 2; (a, b) := (b, a); 10*a + b }', 21);
    // The lowering, pinned: both reads land in temporaries BEFORE either
    // write. `a = b; b = a` would be the bug this exists to prevent.
    const code = compile(
      boxed('do { let a = 1; let b = 2; (a, b) := (b, a); 10*a + b }')
    )!.code as string;
    expect(code).toMatch(/_tv\d+/);
    const firstWrite = code.search(/\ba = _tv/);
    const lastTempInit = code.search(/_tv\d+ = a\b/);
    expect(lastTempInit).toBeGreaterThan(-1);
    expect(lastTempInit).toBeLessThan(firstWrite);
  });

  test('the pair-carrying loop step compiles (Fibonacci)', () => {
    agrees(
      'do { let a = 0; let b = 1; for k in 1..10 { (a, b) := (b, a + b) }; a }',
      55
    );
  });

  test('a `while` loop step compiles (Euclid)', () => {
    agrees(
      'do { let a = 1071; let b = 462; ' +
        'while b != 0 { (a, b) := (b, a % b) }; a }',
      21
    );
  });

  test('a rotation compiles', () => {
    agrees(
      'do { let a=1; let b=2; let c=3; (a,b,c) := (c,a,b); 100*a+10*b+c }',
      312
    );
  });

  test('nested patterns and wildcards compile', () => {
    agrees(
      'do { let a=0; let b=0; let c=0; (a,(b,c)) := (1,(2,3)); 100*a+10*b+c }',
      123
    );
    agrees('do { let a=0; let c=0; (a,_,c) := (1,2,3); 10*a+c }', 13);
  });

  test('a temporary never captures a name the program already uses', () => {
    // `tempVar` skips every name in the compilation's inventory, so a user
    // binding literally named `_tv1` is not shadowed.
    agrees(
      'do { let _tv1 = 5; let a=1; let b=2; (a,b) := (b, a + _tv1); 10*a+b }',
      26
    );
  });

  test('two destructuring assigns in one block do not collide', () => {
    agrees(
      'do { let a=1; let b=2; (a,b) := (b,a); (a,b) := (b,a); 10*a+b }',
      12
    );
  });

  test('a non-literal tuple value fails closed (interpreter fallback)', () => {
    const expr = boxed(
      'do { let a=0; let b=0; let p = (3,4); (a,b) := p; 10*a+b }'
    );
    expect(compile(expr)?.success).toBe(false);
    expect(expr.evaluate().isSame(34)).toBe(true);
  });

  test('the Python target emits the temporaries too', () => {
    // Python has its own statement path (`compilePythonStatements`) that
    // mirrors `compileLoopBody`, and a `declare` hook that emits ONLY the
    // declaration — so a value-carrying `Declare` dropped the initializer and
    // left every temporary unbound (`a = _tv1` with no `_tv1 = …`). The
    // lowering emits declaration and initializer as separate statements.
    const r = compile(
      boxed(
        'do { let a = 0; let b = 1; ' +
          'for k in 1..10 { (a, b) := (b, a + b) }; a }'
      ),
      { to: 'python' }
    );
    expect(r?.success).toBe(true);
    const code = r!.code as string;
    // Every temporary that is READ is also WRITTEN.
    for (const name of new Set(code.match(/_tv\d+/g) ?? []))
      expect(code).toMatch(new RegExp(`${name} = `));
  });

  test.each(['glsl', 'wgsl'] as const)(
    'the %s target compiles it, with no stray `return` in the loop',
    (to) => {
      const r = compile(
        boxed(
          'do { let a = 0; let b = 1; ' +
            'for k in 1..10 { (a, b) := (b, a + b) }; a }'
        ),
        { to }
      );
      expect(r?.success).toBe(true);
      const code = r!.code as string;
      const loop = code.slice(code.indexOf('for ('), code.lastIndexOf('}'));
      // A `return` inside the loop exits the shader on iteration 1.
      expect(loop).not.toMatch(/\breturn\b/);
      for (const name of new Set(code.match(/_tv\d+/g) ?? []))
        expect(code).toMatch(new RegExp(`${name} = `));
    }
  );

  test('a multi-statement loop body emits no `return` either', () => {
    // PRE-EXISTING bug, fixed by the same statement-list path: a shader loop
    // body compiled for its VALUE emitted `return <last statement>` inside
    // the loop. Nothing to do with destructuring — two scalar assigns hit it.
    const r = compile(
      boxed(
        'do { let a = 0; let b = 1; ' +
          'for k in 1..10 { a := a + k; b := b * 2 }; a }'
      ),
      { to: 'glsl' }
    );
    expect(r?.success).toBe(true);
    const code = r!.code as string;
    const loop = code.slice(code.indexOf('for ('), code.lastIndexOf('}'));
    expect(loop).not.toMatch(/\breturn\b/);
  });

  test('a destructuring assign in VALUE position fails closed', () => {
    // The rewrite ends on a write, whose value is one leaf's — not the
    // tuple's. A block's last statement is its value, so it is left alone and
    // fails closed rather than silently returning the wrong thing.
    const expr = boxed('do { let a=1; let b=2; (a,b) := (b,a) }');
    expect(compile(expr)?.success).toBe(false);
    expect(expr.evaluate().toString()).toBe('(2, 1)');
  });

  test('any other non-symbol Assign target fails closed', () => {
    // A `Subscript` LHS (a sequence definition, kept raw by `Assign`'s
    // canonicalization) is the reachable shape. Regression: the generic
    // lowering emitted the silent no-op `_ = 5` behind `success: true` —
    // and in sloppy mode that write creates a stray global `_`.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Assign', ['Subscript', { sym: 'L' }, 0], 5],
      42,
    ] as any);
    expect(compile(expr)?.success).toBe(false);
  });
});
