import { ComputeEngine } from '../../src/compute-engine';

//
// A single-uppercase-letter name that is BOTH a standard-library operator
// (`N`, `D`) and used as a free variable must bind CONSISTENTLY: every bare
// occurrence in one expression — and in a reparse of that expression's own
// MathJSON — denotes the same variable.
//
// The un-applied-operator repair (`devolveUnappliedOperator`) declares that
// variable lazily, when an occurrence lands where a value is required (`N+1`).
// Occurrences boxed BEFORE that point — the bare `N` of `N, N+1` — kept the
// operator binding, so one expression carried two bindings for one name, and
// boxing the same input again a third: byte-identical MathJSON compared
// `isSame` false (docs/mathnet/roundtrip-exceptions.json,
// `builtin-head-vs-value-def-drift`). `box()` now redoes the boxing when the
// repair declared a binding partway through it.
//
// Head/apply position is unaffected: `N(2.3)` and `D(f, x)` still mean the
// builtin operators.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('bare builtin single-letter name binds as a variable', () => {
  test('parse route: neutral position first', () => {
    const expr = ce.parse('N, N+1');
    const bare = expr.ops![0];
    const inSum = expr.ops![1].ops![0];
    expect(bare.type.toString()).toBe('number');
    expect(inSum.type.toString()).toBe('number');
    expect(bare.isSame(inSum)).toBe(true);
  });

  test('parse route: reversed order (unchanged behavior)', () => {
    const expr = ce.parse('N+1, N');
    const inSum = expr.ops![0].ops![0];
    const bare = expr.ops![1];
    expect(bare.type.toString()).toBe('number');
    expect(bare.isSame(inSum)).toBe(true);
  });

  test('parse route: a reparse of the same input is the same expression', () => {
    const first = ce.parse('N, N+1');
    const second = ce.parse('N, N+1');
    expect(first.isSame(second)).toBe(true);
  });

  test('box route: neutral position first', () => {
    const expr = ce.box(['Tuple', 'N', ['Add', 'N', 1]]);
    expect(expr.ops![0].isSame(expr.ops![1].ops![0])).toBe(true);
  });

  test('function route: neutral position first', () => {
    const expr = ce.function('Tuple', ['N', ['Add', 'N', 1]]);
    const bare = expr.ops![0];
    const inSum = expr.ops![1].ops![0];
    expect(bare.type.toString()).toBe('number');
    expect(inSum.type.toString()).toBe('number');
    expect(bare.isSame(inSum)).toBe(true);
  });

  test('function route: reversed order', () => {
    const expr = ce.function('Tuple', [['Add', 'N', 1], 'N']);
    const inSum = expr.ops![0].ops![0];
    const bare = expr.ops![1];
    expect(bare.type.toString()).toBe('number');
    expect(bare.isSame(inSum)).toBe(true);
  });

  test('box route: a rebox of the same MathJSON is the same expression', () => {
    const first = ce.box(['Tuple', 'N', ['Add', 'N', 1]]);
    const second = ce.box(['Tuple', 'N', ['Add', 'N', 1]]);
    expect(first.isSame(second)).toBe(true);
  });

  test('D behaves like N', () => {
    const expr = ce.parse('D, D+1');
    expect(expr.ops![0].type.toString()).toBe('number');
    expect(expr.ops![0].isSame(expr.ops![1].ops![0])).toBe(true);

    const boxed = ce.box(['Tuple', 'D', ['Add', 'D', 1]]);
    expect(boxed.ops![0].isSame(boxed.ops![1].ops![0])).toBe(true);
  });

  test('round trip of a corpus expression with a drifting `D`', () => {
    const first = ce.parse('(DB+BC)^2=AD^2+AC^2');
    const second = ce.parse(first.latex);
    expect(first.isSame(second)).toBe(true);
  });
});

describe('an operand boxed by the caller is rebound too', () => {
  // A canonical expression passes through boxing unchanged, so redoing the
  // construction is not enough: the pre-boxed occurrence would keep the
  // operator binding it got before the shadow existed.
  test('pre-boxed symbol first', () => {
    const n = ce.box('N');
    const expr = ce.function('Tuple', [n, ['Add', 'N', 1]]);
    const bare = expr.ops![0];
    const inSum = expr.ops![1].ops![0];
    expect(bare.type.toString()).toBe('number');
    expect(inSum.type.toString()).toBe('number');
    expect(bare.isSame(inSum)).toBe(true);
    // The rebinding happens in the OUTPUT tree: the caller's expression is
    // never mutated.
    expect(n.operatorDefinition).toBeDefined();
  });

  test('pre-boxed symbol last', () => {
    const n = ce.box('N');
    const expr = ce.function('Tuple', [['Add', 'N', 1], n]);
    const inSum = expr.ops![0].ops![0];
    const bare = expr.ops![1];
    expect(bare.type.toString()).toBe('number');
    expect(bare.isSame(inSum)).toBe(true);
    expect(n.operatorDefinition).toBeDefined();
  });

  test('a pre-boxed symbol with nothing to repair is untouched', () => {
    // Nothing devolves here (a `Tuple` operand requires no value type), so the
    // pre-boxed operator symbol is passed through as-is and `N` remains
    // applicable.
    const n = ce.box('N');
    const expr = ce.function('Tuple', [n, 2]);
    expect(expr.ops![0]).toBe(n);
    expect(expr.ops![0].operatorDefinition).toBeDefined();
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
  });
});

describe('scoped constructs use one devolved binding', () => {
  test('Block rebuilds against its retained local scope', () => {
    const expr = ce.box(['Block', 'N', ['Add', 'N', 1]]);
    const bare = expr.ops![0];
    const inSum = expr.ops![1].ops![0];
    expect(bare.operatorDefinition).toBeUndefined();
    expect(bare.type.toString()).toBe('number');
    expect(inSum.type.toString()).toBe('number');
    expect(bare.isSame(inSum)).toBe(true);
  });
});

describe('head position keeps the operator meaning', () => {
  test('parse route', () => {
    expect(ce.parse('N(2.3)').evaluate().toString()).toBe('2.3');
    expect(ce.parse('D(x^2,x)').evaluate().toString()).toBe('2x');
  });

  test('box route', () => {
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
    expect(
      ce
        .box(['D', ['Power', 'x', 2], 'x'])
        .evaluate()
        .toString()
    ).toBe('2x');
  });
});

describe('the repair is limited to single-letter library operators', () => {
  test('a multi-letter operator in value position stays the builtin', () => {
    expect(
      ce
        .box(['Map', 'Sin', ['List', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('[0,sin(1)]');
    expect(ce.box('Sin').operatorDefinition).toBeDefined();
  });

  test('a bare occurrence on its own does not redefine the name', () => {
    // Nothing devolves here — no occurrence lands where a value is required —
    // so the operator definition is intact for a later application.
    expect(ce.parse('N').json).toEqual('N');
    expect(ce.expr(['N', 'Pi']).evaluate().isSame(ce.Pi.N())).toBe(true);
  });

  test('a bare library operator in callback position stays the operator', () => {
    expect(ce.parse('x^2 \\rhd \\operatorname{D}').evaluate().json).toEqual([
      'Multiply',
      2,
      'x',
    ]);
  });

  test('a user-declared single-letter value keeps its declared type', () => {
    ce.declare('V', 'tuple<number, number>');
    expect(ce.box('V').type.toString()).toBe('tuple<number, number>');
  });

  test('`G` is a plain variable (no operator definition)', () => {
    const expr = ce.parse('G, G+1');
    expect(expr.ops![0].isSame(expr.ops![1].ops![0])).toBe(true);
    expect(expr.ops![0].operatorDefinition).toBeUndefined();
  });

  test('the standard library still exposes the operators to a fresh engine', () => {
    expect(ce.box(['N', 2.3]).evaluate().toString()).toBe('2.3');
    // The engine's own definitions are not devolved: `Mu0` is N/A^2.
    expect(ce.box('Mu0').evaluate().toString()).toContain('N/A^2');
  });
});
