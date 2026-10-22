/**
 * Dimension variables: a `where` variable in a collection's length slot
 * (`list<T^N>`, `vector<T^N>`, `matrix<T^(MxN)>`), and the same variable as a
 * VALUE at a type position (`(n: N, x: vector<T^N>) -> T where T, N`).
 *
 * A dimension variable is solved by EQUALITY from a literal length or a
 * literal integer argument; a mismatch rejects the later operand. An operand
 * whose type states no length (`w: list<real>`) binds nothing and is admitted,
 * exactly as it is at a literal length (`list<integer^3>`) today. Design note:
 * `docs/plans/2026-09-29-dimension-variables-design.md` (issue #364).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { Expression } from '../../src/compute-engine/global-types';

function fresh(): ComputeEngine {
  return new ComputeEngine();
}

/** Declare an operator with the given signature and an inert evaluate. */
function declare(ce: ComputeEngine, name: string, signature: string): void {
  ce.declare(name, { signature, evaluate: () => ce.number(1) });
}

function errorOf(e: Expression): string {
  return JSON.stringify(e.json);
}

describe('DIMENSION VARIABLES — grammar and round trip', () => {
  const spellings: [string, string][] = [
    [
      '(x: list<integer^N>) -> integer where N',
      '(x: vector<integer^N>) -> integer where N',
    ],
    ['(x: vector<T^N>) -> T where T, N', '(x: vector<T^N>) -> T where T, N'],
    [
      '(x: matrix<real^(NxN)>) -> real where N',
      '(x: matrix<real^(NxN)>) -> real where N',
    ],
    [
      '(x: list<integer^(3xN)>) -> integer where N',
      '(x: matrix<integer^(3xN)>) -> integer where N',
    ],
    [
      '(x: list<integer^(MxNxP)>) -> integer where M, N, P',
      '(x: list<integer^(MxNxP)>) -> integer where M, N, P',
    ],
    // Spaced separators and a mixed literal/variable shape.
    [
      '(x: matrix<T^(M x 3)>) -> T where T, M',
      '(x: matrix<T^(Mx3)>) -> T where T, M',
    ],
    [
      '(n: N, x: vector<T^N>) -> T where T, N',
      '(n: N, x: vector<T^N>) -> T where T, N',
    ],
  ];
  test.each(spellings)('%s parses and prints as %s', (input, printed) => {
    const t = parseType(input);
    expect(typeToString(t)).toBe(printed);
    // The printed form re-parses to the same type.
    expect(typeToString(parseType(printed))).toBe(printed);
  });

  test('a dimension variable is the -1 wildcard plus a name', () => {
    const t = parseType('(x: list<T^(2xN)>) -> T where T, N') as any;
    const x = t.args[0].type;
    expect(x.dimensions).toEqual([2, -1]);
    expect(x.dimensionVariables).toEqual([undefined, 'N']);
    expect(t.typeParams.map((p: any) => [p.name, p.kind])).toEqual([
      ['T', undefined],
      ['N', 'value'],
    ]);
  });

  test('a value variable at a type position is the flagged variable node', () => {
    const t = parseType('(n: N, x: vector<T^N>) -> N where T, N') as any;
    expect(t.args[0].type).toEqual({
      kind: 'variable',
      name: 'N',
      value: true,
    });
    expect(t.result).toEqual({ kind: 'variable', name: 'N', value: true });
  });

  test('the leading position keeps its meaning: `vector<T>` is an element type', () => {
    // Only after `^` is a bare identifier a length; `vector<N>` is a vector of N.
    const t = parseType('(x: vector<N>) -> N where N') as any;
    expect(t.args[0].type).toEqual({
      kind: 'list',
      elements: { kind: 'variable', name: 'N' },
      dimensions: [-1],
    });
    expect(t.typeParams[0].kind).toBeUndefined();
  });

  test('an `x`-joined group of variables IS a shape in the leading position', () => {
    expect(
      typeToString(parseType('(x: matrix<MxN>) -> integer where M, N'))
    ).toBe('(x: matrix<number^(MxN)>) -> integer where M, N');
  });
});

describe('DIMENSION VARIABLES — declaration diagnostics', () => {
  const rejected: [string, string][] = [
    ['() -> vector<number^N> where N', 'unsolvable-type-variable'],
    ['(x: list<integer^K>) -> integer where N', 'unresolved-type-variable'],
    [
      '(x: matrix<integer^(MxN)>) -> integer where N',
      'unresolved-type-variable',
    ],
    [
      '(x: vector<number^N>) -> N where N: string',
      'dimension-bound-not-integer',
    ],
    ['(x: vector<number^N>) -> N where N: real', 'dimension-bound-not-integer'],
    [
      '(x: vector<number^N>) -> N where N is Hashable',
      'value-variable-protocol',
    ],
    [
      '(x: list<integer^N>, y: N & integer) -> integer where N',
      'unsupported-variable-position',
    ],
  ];
  test.each(rejected)('%s is rejected with %s', (signature, code) => {
    const ce = fresh();
    expect(() => declare(ce, 'f', signature)).toThrow(code);
  });

  test('an undeclared dimension variable without any clause is an open type', () => {
    const ce = fresh();
    expect(() => ce.declare('v', 'vector<integer^N>')).toThrow(
      'unresolved-type-variable'
    );
  });

  test('a ranged integer bound is accepted', () => {
    const ce = fresh();
    expect(() =>
      declare(ce, 'f', '(x: vector<number^N>) -> N where N: integer<2..>')
    ).not.toThrow();
  });

  test('each arm of an overload set decides the kind of its own variables', () => {
    // The `N` of the second arm is a type variable bounded by `string`; the
    // length `N` of the first arm is another variable. The order of the arms
    // does not change the decision.
    for (const signature of [
      '((vector<real^N>) -> real where N) & ((N) -> N where N: string)',
      '((N) -> N where N: string) & ((vector<real^N>) -> real where N)',
    ]) {
      const t = parseType(signature) as any;
      const kinds = t.types.map((arm: any) => arm.typeParams[0].kind);
      expect(kinds.sort()).toEqual(['value', undefined]);
      const typeArm = t.types.find(
        (arm: any) => arm.typeParams[0].kind !== 'value'
      );
      expect(typeArm.result).toEqual({ kind: 'variable', name: 'N' });
      expect(() => declare(fresh(), 'f', signature)).not.toThrow();
    }
  });
});

describe('DIMENSION VARIABLES — solving across positions', () => {
  const ce = fresh();
  declare(ce, 'dot', '(a: vector<real^N>, b: vector<real^N>) -> real where N');
  ce.declare('v', 'vector<3>');
  ce.declare('w', 'list<real>');
  const L = (s: string) => ce.parse(s);

  test('equal literal lengths are accepted', () => {
    const e = ce.box(['dot', L('[1,2,3]'), L('[4,5,6]')]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('real');
  });

  test('a different length rejects the LATER operand, expecting the earlier length', () => {
    const e = ce.box(['dot', L('[1,2,3]'), L('[4,5]')]);
    expect(e.isValid).toBe(false);
    expect(errorOf(e)).toContain('incompatible-type');
    expect(errorOf(e)).toContain("'vector<real^3>'");
    expect(errorOf(e)).toContain("'vector<integer^2>'");
    // Operand 1 is untouched; operand 2 carries the error.
    expect(e.op1.isValid).toBe(true);
    expect(e.op2.isValid).toBe(false);
  });

  test('a declared dimensioned symbol pins the length', () => {
    expect(ce.box(['dot', 'v', L('[1,2,3]')]).isValid).toBe(true);
    expect(ce.box(['dot', 'v', L('[1,2]')]).isValid).toBe(false);
  });

  test('an operand with no length in its type binds nothing and is admitted', () => {
    expect(ce.box(['dot', 'w', L('[1,2,3]')]).isValid).toBe(true);
    expect(ce.box(['dot', 'w', 'w']).isValid).toBe(true);
  });

  test('the same result on the box, parse and function routes', () => {
    const boxed = ce.box(['dot', ['List', 1, 2, 3], ['List', 4, 5]]);
    const parsed = ce.parse('\\operatorname{dot}([1,2,3],[4,5])');
    const fn = ce.function('dot', [L('[1,2,3]'), L('[4,5]')]);
    for (const e of [boxed, parsed, fn]) {
      expect(e.isValid).toBe(false);
      expect(errorOf(e)).toContain("'vector<real^3>'");
    }
  });
});

describe('DIMENSION VARIABLES — shapes and substitution into the result', () => {
  const ce = fresh();
  const L = (s: string) => ce.parse(s);
  declare(
    ce,
    'mm',
    '(a: matrix<T^(MxN)>, b: matrix<T^(NxP)>) -> matrix<T^(MxP)> where T, M, N, P'
  );
  declare(ce, 'sq', '(x: matrix<T^(NxN)>) -> N where T, N');
  declare(ce, 'rows', '(x: matrix<T^(MxN)>) -> M where T, M, N');
  declare(ce, 'first', '(x: list<T^N>) -> T where T, N');
  declare(ce, 'len', '(x: list<T^N>) -> N where T, N');
  ce.declare('w', 'list<real>');

  test('a matrix product relates three lengths and writes the result shape', () => {
    const e = ce.box([
      'mm',
      L('[[1,2,3],[4,5,6]]'),
      L('[[1,2,3,4],[1,2,3,4],[1,2,3,4]]'),
    ]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix<integer^(2x4)>');
  });

  test('an inner-length mismatch rejects the second matrix', () => {
    const e = ce.box([
      'mm',
      L('[[1,2,3],[4,5,6]]'),
      L('[[1,2,3,4],[1,2,3,4]]'),
    ]);
    expect(e.isValid).toBe(false);
    expect(errorOf(e)).toContain("'matrix<integer^(3x4)>'");
    expect(errorOf(e)).toContain("'matrix<integer^(2x4)>'");
  });

  test('under a rank-2 pattern the element variable is the SCALAR element', () => {
    // `T` binds to `integer`, not to the row `vector<integer^3>`.
    const e = ce.box(['mm', L('[[1,2,3],[4,5,6]]'), L('[[1,2],[3,4],[5,6]]')]);
    expect(e.type.toString()).toBe('matrix<integer^(2x2)>');
  });

  test('a square constraint accepts a square matrix and rejects a rectangular one', () => {
    expect(ce.box(['sq', L('[[1,2],[3,4]]')]).type.toString()).toBe('2');
    const e = ce.box(['sq', L('[[1,2,3],[4,5,6]]')]);
    expect(e.isValid).toBe(false);
    expect(errorOf(e)).toContain("'matrix<integer^(2x2)>'");
  });

  test('a solved dimension in the result is the value-literal type', () => {
    expect(ce.box(['rows', L('[[1,2,3],[4,5,6]]')]).type.toString()).toBe('2');
    expect(ce.box(['len', L('[1,2,3]')]).type.toString()).toBe('3');
  });

  test('an unsolved dimension in the result reads as its bound', () => {
    // A length is a non-negative integer (the empty list has length 0).
    expect(ce.box(['len', 'w']).type.toString()).toBe('integer<0..>');
  });

  test('a rank-1 pattern binds the element from a rank-1 actual', () => {
    expect(ce.box(['first', L('[1,2,3]')]).type.toString()).toBe('integer');
  });

  test('a rank-2 actual at a rank-1 pattern is read as a list of its rows', () => {
    // The `T` of `list<T^N>` and of `vector<T>` is the type of the CELLS of
    // a rank-1 tensor, and a matrix has rank 2, so a matrix is not a value
    // of either pattern and the call is an `incompatible-type` error, for a
    // literal matrix as for a symbol declared `list<integer^(2x2)>`. The
    // plain `list<T>` is read by its elements: a matrix is a list of its
    // rows, and `T` is the row type.
    declare(ce, 'gu', '(x: vector<unknown>) -> unknown');
    declare(ce, 'gl', '(x: list<T>) -> T where T');
    ce.declare('nl2', 'list<integer^(2x2)>');
    const flat = ce.box(['first', L('[[1,2],[3,4]]')]);
    const nested = ce.box(['first', 'nl2']);
    expect(flat.isValid).toBe(false);
    expect(nested.isValid).toBe(false);
    expect(ce.box(['gu', L('[[1,2],[3,4]]')]).isValid).toBe(false);
    expect(ce.box(['gl', L('[[1,2],[3,4]]')]).type.toString()).toBe(
      'vector<integer^2>'
    );
    expect(ce.box(['gl', 'nl2']).type.toString()).toBe('vector<integer^2>');
  });
});

describe('DIMENSION VARIABLES — a value parameter (`n: N`)', () => {
  const ce = fresh();
  const L = (s: string) => ce.parse(s);
  declare(ce, 'foo', '(n: N, x: vector<T^N>) -> T where T, N');
  declare(ce, 'big', '(x: vector<number^N>) -> N where N: integer<2..>');
  ce.declare('k', 'integer');
  ce.declare('k3', 'integer<3..3>');
  ce.assign('m', ce.number(3));

  test('a literal integer pins the length', () => {
    expect(ce.box(['foo', 3, L('[1,2,3]')]).isValid).toBe(true);
    expect(ce.box(['foo', 3, L('[1,2,3]')]).type.toString()).toBe('integer');
  });

  test('a literal that disagrees with the list rejects the later operand', () => {
    const e = ce.box(['foo', 4, L('[1,2,3]')]);
    expect(e.isValid).toBe(false);
    expect(e.op1.isValid).toBe(true);
    expect(errorOf(e)).toContain("'vector<integer^4>'");
    expect(errorOf(e)).toContain("'vector<integer^3>'");
  });

  test('a float-spelled integer literal pins too (its type is the value `3`)', () => {
    expect(ce.box(['foo', L('3.0'), L('[1,2,3]')]).isValid).toBe(true);
  });

  test('a symbol declared `integer` pins nothing and is admitted', () => {
    expect(ce.box(['foo', 'k', L('[1,2,3]')]).isValid).toBe(true);
  });

  test('a symbol declared as a singleton range pins the length', () => {
    expect(ce.box(['foo', 'k3', L('[1,2,3]')]).isValid).toBe(true);
    const e = ce.box(['foo', 'k3', L('[1,2]')]);
    expect(e.isValid).toBe(false);
    expect(errorOf(e)).toContain("'vector<integer^3>'");
  });

  test('an assigned symbol pins nothing but is checked against its held value', () => {
    // `m := 3` is typed `integer` (stored types widen literals), so it pins no
    // length; the post-solve check then reads the held value, as the ground
    // route does for `(n: integer<3..3>)`: admitted beside a length-3 list,
    // rejected beside a length-2 one.
    expect(ce.box(['foo', 'm', L('[1,2,3]')]).isValid).toBe(true);
    const e = ce.box(['foo', 'm', L('[1,2]')]);
    expect(e.isValid).toBe(false);
    expect(e.op1.isValid).toBe(false);
  });

  test('a value outside the bound is rejected at its own position', () => {
    for (const bad of [-1, 2.5]) {
      const e = ce.box(['foo', bad, L('[1,2,3]')]);
      expect(e.isValid).toBe(false);
      expect(e.op1.isValid).toBe(false);
      expect(e.op2.isValid).toBe(true);
    }
  });

  test('the length 0 is a length: a disagreeing list is the operand rejected', () => {
    const e = ce.box(['foo', 0, L('[1,2,3]')]);
    expect(e.isValid).toBe(false);
    expect(e.op1.isValid).toBe(true);
    expect(e.op2.isValid).toBe(false);
  });

  test('a declared bound is checked against the solved length', () => {
    expect(ce.box(['big', L('[1]')]).isValid).toBe(false);
    const ok = ce.box(['big', L('[1,2]')]);
    expect(ok.isValid).toBe(true);
    expect(ok.type.toString()).toBe('2');
  });
});

describe('DIMENSION VARIABLES — a nominal type with a length parameter', () => {
  const ce = fresh();
  const L = (s: string) => ce.parse(s);
  ce.declareType('permutation', 'list<integer^N>', { typeParams: ['N'] });
  ce.declare('w', 'list<integer>');
  declare(
    ce,
    'compose',
    '(p: permutation<N>, q: permutation<N>) -> permutation<N> where N'
  );

  test('the constructor solves the length from its operand', () => {
    const p = ce.box(['permutation', L('[2,1,3]')]);
    expect(p.isValid).toBe(true);
    expect(p.type.toString()).toBe('permutation<3>');
  });

  test('an unknown length reads as the family of all lengths, and re-parses', () => {
    const p = ce.box(['permutation', 'w']);
    expect(p.type.toString()).toBe('permutation<integer<0..>>');
    expect(ce.type('permutation<integer<0..>>').toString()).toBe(
      'permutation<integer<0..>>'
    );
  });

  test('a signature over the type relates the lengths of its operands', () => {
    const p3 = ce.box(['permutation', L('[2,1,3]')]);
    const p4 = ce.box(['permutation', L('[2,1,3,4]')]);
    expect(ce.box(['compose', p3, p3]).type.toString()).toBe('permutation<3>');
    const e = ce.box(['compose', p3, p4]);
    expect(e.isValid).toBe(false);
    expect(errorOf(e)).toContain("'permutation<3>'");
    expect(errorOf(e)).toContain("'permutation<4>'");
  });

  test('two solved lengths are unrelated; a solved length is within the family', () => {
    expect(ce.type('permutation<3>').matches('permutation<4>')).toBe(false);
    expect(ce.type('permutation<3>').matches('permutation<3>')).toBe(true);
    expect(ce.type('permutation<3>').matches('permutation<integer<1..>>')).toBe(
      true
    );
    expect(ce.type('permutation<integer<1..>>').matches('permutation<3>')).toBe(
      false
    );
  });

  test('a type where a length belongs is rejected', () => {
    expect(() => ce.type('permutation<integer>')).toThrow('type-argument-kind');
    expect(() => ce.type('permutation<string>')).toThrow('type-argument-kind');
  });

  test('a declared symbol of a specific length', () => {
    ce.declare('q3', 'permutation<3>');
    expect(ce.box('q3').type.toString()).toBe('permutation<3>');
  });
});

describe('DIMENSION VARIABLES — the Epsil route', () => {
  test('a trailing `where` clause on a function head', () => {
    const ok = executeEpsil(
      fresh(),
      'function dot(a: vector<real^N>, b: vector<real^N>) -> real where N { 1 }\ndot([1,2,3],[4,5,6])'
    );
    expect(ok.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ok.value?.toString()).toBe('1');

    const bad = executeEpsil(
      fresh(),
      'function dot(a: vector<real^N>, b: vector<real^N>) -> real where N { 1 }\ndot([1,2,3],[4,5])'
    );
    expect(bad.value?.isValid).toBe(false);
    expect(bad.value?.toString()).toContain('incompatible-type');
  });

  test('the sugared `function f<N>(…)` head', () => {
    const bad = executeEpsil(
      fresh(),
      'function dot<N>(a: vector<real^N>, b: vector<real^N>) -> real { 1 }\ndot([1,2,3],[4,5])'
    );
    expect(bad.value?.isValid).toBe(false);
    expect(bad.value?.toString()).toContain('vector<real^3>');
  });

  test('a length in the result, and a nominal type statement', () => {
    const len = executeEpsil(
      fresh(),
      'function len(x: list<T^N>) -> N where T, N { 3 }\nlen([1,2,3])'
    );
    expect(len.diagnostics.map((d) => d.message)).toEqual([]);
    expect(len.value?.type.toString()).toBe('3');

    const perm = executeEpsil(
      fresh(),
      'type perm<N> = list<integer^N>\nlet p = perm([2,1,3])\np'
    );
    expect(perm.diagnostics.map((d) => d.message)).toEqual([]);
    expect(perm.value?.type.toString()).toBe('perm<3>');
  });
});

describe('DIMENSION VARIABLES — review follow-ups (2026-09-29)', () => {
  test('a ground dimensioned pattern binds the SCALAR element: `matrix<T>` on a 2x2 matrix', () => {
    // Subtyping reads `matrix<T>` as a rank-2 list OF `T`, so `T` is the
    // scalar element, not the row the one-index reading gives `list<T>`.
    const ce = fresh();
    declare(ce, 'mt', '(x: matrix<T>) -> T where T');
    expect(ce.box(['mt', ce.parse('[[1,2],[3,4]]')]).type.toString()).toBe(
      'integer'
    );
  });

  test('a variable named with an `x` inside is one name, and prints with a spaced separator', () => {
    for (const [input, printed] of [
      [
        '(a: vector<real^idx>, b: vector<real^idx>) -> real where idx',
        '(a: vector<real^idx>, b: vector<real^idx>) -> real where idx',
      ],
      [
        '(x: matrix<T^(M x idx)>) -> T where T, M, idx',
        '(x: matrix<T^(M x idx)>) -> T where T, M, idx',
      ],
      [
        '(x: matrix<T^(idx x N)>) -> T where T, idx, N',
        '(x: matrix<T^(idx x N)>) -> T where T, idx, N',
      ],
      [
        '(x: matrix<Max x 2>) -> integer where Max',
        '(x: matrix<number^(Max x 2)>) -> integer where Max',
      ],
      [
        '(x: matrix<M x N>) -> integer where M, N',
        '(x: matrix<number^(MxN)>) -> integer where M, N',
      ],
    ]) {
      const t = parseType(input);
      expect(typeToString(t)).toBe(printed);
      expect(typeToString(parseType(printed))).toBe(printed);
    }
    // Fused, two names cannot be told apart from one: `Mxidx` is one name.
    expect(() =>
      parseType('(x: matrix<T^(Mxidx)>) -> T where T, M, idx')
    ).toThrow('`Mxidx` is not quantified');
  });

  test('the Epsil route accepts such a name before its clause is in scope', () => {
    const r = executeEpsil(
      fresh(),
      'function f(a: vector<real^idx>, b: vector<real^idx>) -> real where idx { 1 }\nf([1,2,3],[4,5])'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value?.toString()).toContain('vector<real^3>');
  });

  test('a clause variable given to a value parameter must satisfy its bound', () => {
    const ce = fresh();
    ce.declareType('big', 'list<integer^N>', {
      typeParams: ['N: integer<2..>'],
    });
    expect(() => declare(ce, 'mk', '(n: N) -> big<N> where N')).toThrow(
      'generic-alias-bound'
    );
    expect(() =>
      declare(ce, 'mk2', '(n: N) -> big<N> where N: integer<2..>')
    ).not.toThrow();
    expect(() =>
      declare(ce, 'mk3', '(n: N) -> big<N> where N: integer<3..5>')
    ).not.toThrow();
  });

  test('an explicit length bound restricts the non-negative length bound, it does not replace it', () => {
    const ce = fresh();
    ce.declareType('perm', 'list<integer^N>', { typeParams: ['N: integer'] });
    ce.declareType('mid', 'list<integer^N>', {
      typeParams: ['N: integer<-5..5>'],
    });
    for (const t of [
      'perm<-1>',
      'perm<-2>',
      'perm<integer>',
      'mid<-1>',
      'mid<6>',
    ])
      expect(() => ce.type(t)).toThrow('type-argument-kind');
    expect(ce.type('perm<0>').toString()).toBe('perm<0>');
    expect(ce.type('perm<3>').toString()).toBe('perm<3>');
    expect(ce.type('mid<0>').toString()).toBe('mid<0>');
    expect(ce.type('mid<integer<0..5>>').toString()).toBe('mid<integer<0..5>>');
    // An unsolved application reads as the non-negative part of the bound,
    // and that printed form is itself admitted.
    ce.declare('w', 'list<integer>');
    expect(ce.box(['perm', 'w']).type.toString()).toBe('perm<integer<0..>>');
    // A clause variable is compared by the positive part of both bounds.
    expect(() => declare(ce, 'mk', '(n: N) -> mid<N> where N')).toThrow(
      'generic-alias-bound'
    );
    expect(() =>
      declare(ce, 'mk2', '(n: N) -> mid<N> where N: integer<-3..5>')
    ).not.toThrow();
    // A signature whose length bound is `integer` reads an unsolved length
    // as `integer<0..>`.
    declare(ce, 'len', '(x: list<T^N>) -> N where T, N: integer');
    expect(ce.box(['len', 'w']).type.toString()).toBe('integer<0..>');
  });

  test('a length bound spelled by a transparent alias is the bound it names', () => {
    // The non-negative part of a bound that only partly overlaps
    // `integer<0..>` is computed from the interval of the bound. A reference
    // to an alias has no interval, so the bound `Small` was `never` and
    // refused every length, where `integer<-5..5>` written inline admits 0
    // to 5.
    const ce = fresh();
    ce.declareType('Small', 'integer<-5..5>', { alias: true });
    declare(ce, 'zs', '(n: N, x: vector<T^N>) -> T where T, N: Small');
    expect(ce.box(['zs', 3, ce.parse('[1,2,3]')]).isValid).toBe(true);
    expect(ce.box(['zs', 5, ce.parse('[1,2,3,4,5]')]).isValid).toBe(true);
    expect(ce.box(['zs', 6, ce.parse('[1,2,3,4,5,6]')]).isValid).toBe(false);
    ce.declareType('mid', 'list<integer^N>', { typeParams: ['N: Small'] });
    expect(ce.type('mid<3>').toString()).toBe('mid<3>');
    expect(ce.type('mid<0>').toString()).toBe('mid<0>');
    for (const t of ['mid<-1>', 'mid<6>'])
      expect(() => ce.type(t)).toThrow('type-argument-kind');
  });

  test('a nominal length parameter with a non-integer bound is rejected at declaration', () => {
    const ce = fresh();
    expect(() =>
      ce.declareType('bad', 'list<integer^N>', { typeParams: ['N: string'] })
    ).toThrow('dimension-bound-not-integer');
  });

  test('a length outside the declared bound pins nothing, so the right operand is blamed', () => {
    const ce = fresh();
    declare(ce, 'lb', '(x: vector<T^N>, n: N) -> T where T, N: integer<3..>');
    const e = ce.box(['lb', ce.parse('[1,2]'), 3]);
    expect(e.isValid).toBe(false);
    expect(e.op1.isValid).toBe(false);
    expect(e.op2.isValid).toBe(true);
    expect(errorOf(e)).toContain("'vector<integer^3>'");
  });

  test('`where N: integer` admits the length 0 but no negative length', () => {
    const ce = fresh();
    declare(ce, 'zi', '(n: N, x: vector<T^N>) -> T where T, N: integer');
    const e = ce.box(['zi', -1, ce.parse('[1,2,3]')]);
    expect(e.isValid).toBe(false);
    expect(e.op1.isValid).toBe(false);
    expect(e.op2.isValid).toBe(true);
    expect(ce.box(['zi', 0, ce.parse('[]')]).isValid).toBe(true);
  });

  test("a sum type decides a shared parameter's kind before any variant is declared", () => {
    // `N` is a length in `poly` and a value in `circ`; the variants share one
    // clause, so the outcome must not depend on their order.
    for (const decl of [
      'type shape<N> = circ(N) | poly(list<real^N>)',
      'type shape<N> = poly(list<real^N>) | circ(N)',
    ]) {
      const a = executeEpsil(fresh(), decl + '\npoly([1,2,3])');
      expect(a.diagnostics.map((d) => d.message)).toEqual([]);
      expect(a.value?.type.toString()).toBe('poly<3>');
      const b = executeEpsil(fresh(), decl + '\ncirc(3)');
      expect(b.diagnostics.map((d) => d.message)).toEqual([]);
      expect(b.value?.type.toString()).toBe('circ<3>');
    }
  });
});

// The shape of a tensor is spelled in one place, on the outer list: a list
// with dimensions cannot have list cells, so the nested spelling
// `list<vector<integer^3>^2>` is not a type, and two rows of three integers
// are `list<integer^(2x3)>`, that is `matrix<integer^(2x3)>`. A plain list
// of rows (`list<vector<integer^3>>`) is read by its elements: it is a
// list of vectors, not a matrix (its rows may be anything that is a
// vector of three integers, and it carries no length), so it is admitted
// at a `matrix<T^(MxN)>` parameter only provisionally and pins no length.
// A matrix is a list of its rows: `matrix<integer^(2x3)>` is a
// `list<vector<integer^3>>`, and the reverse does not hold.
describe('DIMENSION VARIABLES — a list of rows is not a matrix', () => {
  const ce = fresh();
  declare(ce, 'rows', '(x: matrix<T^(MxN)>) -> M where T, M, N');
  declare(ce, 'cols', '(x: matrix<T^(MxN)>) -> N where T, M, N');
  declare(ce, 'sq', '(x: matrix<T^(NxN)>) -> N where T, N');
  declare(
    ce,
    'mm',
    '(a: matrix<T^(MxN)>, b: matrix<T^(NxP)>) -> matrix<T^(MxP)> where T, M, N, P'
  );
  ce.declare('nl', 'list<integer^(2x3)>');
  ce.declare('nq', 'list<integer^(3x3)>');
  ce.declare('nu', 'list<vector<integer^3>>');
  ce.declare('nb', 'list<integer^(3x4)>');

  test('the lengths are pinned', () => {
    expect(ce.box(['rows', 'nl']).type.toString()).toBe('2');
    expect(ce.box(['cols', 'nl']).type.toString()).toBe('3');
    // An outer list with no length is admitted provisionally and pins
    // nothing: its values can have any number of axes above the rows.
    expect(ce.box(['rows', 'nu']).type.toString()).toBe('integer<0..>');
    expect(ce.box(['cols', 'nu']).type.toString()).toBe('integer<0..>');
  });

  test('a square constraint and a matrix product', () => {
    expect(ce.box(['sq', 'nq']).type.toString()).toBe('3');
    expect(ce.box(['sq', 'nl']).isValid).toBe(false);
    expect(ce.box(['mm', 'nl', 'nb']).type.toString()).toBe(
      'matrix<integer^(2x4)>'
    );
    expect(ce.box(['mm', 'nl', 'nl']).isValid).toBe(false);
  });

  test.each([
    ['list<integer^(2x3)>', 'matrix<integer>', true],
    ['list<integer^(2x3)>', 'matrix<integer^(2x3)>', true],
    ['list<integer^(2x3)>', 'matrix<integer^(3x2)>', false],
    ['list<integer^(2x3)>', 'matrix<real>', true],
    // A plain list of rows is read by its elements: a list of vectors, not
    // a matrix, and not a list of integers.
    ['list<vector<integer^3>>', 'matrix<integer>', false],
    ['list<vector<integer^3>>', 'matrix<integer^(2x3)>', false],
    ['list<vector<integer^3>>', 'list<integer^(?x3)>', false],
    ['list<vector<integer^3>>', 'list<integer>', false],
    ['list<vector<integer^3>>', 'collection<integer>', false],
    ['list<vector<integer^3>>', 'list<list<integer>>', true],
    ['list<vector<integer^3>>', 'collection<vector<integer>>', true],
    // Plain lists nested around a matrix or a vector are not a tensor of
    // the larger rank.
    ['list<list<vector<integer^2>>>', 'list<integer^(4x3x2)>', false],
    ['list<matrix<integer^(2x2)>>', 'list<integer^(3x2x2)>', false],
    // Rows with no length can differ in length: not a matrix.
    ['list<list<integer>>', 'matrix<integer>', false],
    // Rows of length `-1` (any length) can differ in length too: `[[1],
    // [2, 3]]` is a `list<vector<integer^1> | vector<integer^2>>`.
    ['list<vector<integer>>', 'matrix<integer>', false],
    ['list<list<string>>', 'matrix<integer>', false],
    // A matrix is a list of its rows, and a tensor of rank 3 a list of its
    // matrices.
    ['matrix<integer^(2x3)>', 'list<vector<integer^3>>', true],
    ['list<integer^(3x2x2)>', 'list<matrix<integer^(2x2)>>', true],
  ])('%s <: %s is %s', (a, b, expected) => {
    expect(ce.type(a).matches(ce.type(b))).toBe(expected);
  });

  test('rows of any length are not a matrix: an integer power stays a Power', () => {
    ce.declare('nr', 'list<vector<integer>>');
    expect(ce.box(['Power', 'nr', 2]).operator).toBe('Power');
    expect(ce.box(['Power', 'nq', 2]).operator).toBe('MatrixPower');
  });
});
