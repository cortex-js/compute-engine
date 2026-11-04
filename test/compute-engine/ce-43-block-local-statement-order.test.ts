import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json';

// CE-43: the static type of a block local does not depend on the order of
// its uses and its assignments. The type of a local with assignment evidence
// is the join of the types of its assigned values. A use (an argument at a
// typed parameter) narrows only a local that has no assignment evidence, and
// the first assignment replaces a type that came from uses only.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('mutate', '(list<real>) -> integer');
  ce.declare('ik', '(integer) -> integer');
  ce.declare('lk', '(list<integer>) -> integer');
  ce.declare('rk', '(real) -> real');
  return ce;
}

/** The static type of the block, and whether its value is in that type. */
function typeOf(mj: MathJsonExpression): { type: string; sound: boolean } {
  const e = engine().box(mj);
  const type = e.type.toString();
  const value = e.evaluate();
  return { type, sound: value.type.matches(type) };
}

describe('CE-43: block local types do not depend on statement order', () => {
  test('a list local used at a list<real> parameter', () => {
    const assignFirst = typeOf([
      'Block',
      ['Declare', 'v', "'unknown'", ['List', 1.5, 2]],
      ['mutate', 'v'],
      'v',
    ]);
    expect(assignFirst).toEqual({ type: 'vector<real^2>', sound: true });
  });

  test('a scalar local used at a real parameter', () => {
    expect(
      typeOf([
        'Block',
        ['Declare', 'u', "'unknown'", 3],
        ['rk', 'u'],
        'u',
      ])
    ).toEqual({ type: 'integer', sound: true });
  });

  test('a use does not narrow the type of an assigned local below its value', () => {
    // A meet with the use would give `vector<integer^1>`, a type that
    // `[1.5]` is not in.
    for (const mj of [
      ['Block', ['Declare', 'v', "'unknown'", ['List', 1.5]], ['lk', 'v'], 'v'],
    ] as MathJsonExpression[]) {
      const ce = engine();
      const e = ce.box(mj);
      expect(e.type.toString()).toBe('vector<real^1>');
    }
  });
});

describe('CE-43: an assignment in a match case is an assignment of the block local', () => {
  function run(src: string): { type: string; value: string; sound: boolean } {
    const ce = new ComputeEngine();
    const [ast, diags] = parseEpsil(src);
    expect(diags).toEqual([]);
    const e = ce.box(ast!);
    const type = e.type.toString();
    const value = e.evaluate();
    return {
      type,
      value: value.toString(),
      sound: value.type.matches(type),
    };
  }

  test('a while-let body that consumes the list', () => {
    // Before: typed `vector<integer^3>`, evaluated to `[]`.
    expect(
      run('let xs = [1, 2, 3]\nwhile let [h, ...] = xs { xs = Rest(xs) }\nxs')
    ).toEqual({ type: 'list<integer>', value: '[]', sound: true });
  });

  test('a match case that assigns a value of another kind', () => {
    // The value of a local has the type of the local, in a match case as in
    // a branch of an `if`.
    const r = run(
      'let xs = [1, 2, 3]\nmatch 1 { 1 => do { xs = "abc" } }\nxs'
    );
    expect(r.value).toBe(
      'Error(ErrorCode("assignment-type-mismatch", "xs", "list<number>", "string"))'
    );
  });

  test('the compiled while-let loop reads the block local', () => {
    const ce = new ComputeEngine();
    const [ast] = parseEpsil(
      'let xs = [1, 2, 3]\nlet s = 0\nwhile let [h, ...] = xs { s = s + h; xs = Rest(xs) }\ns'
    );
    const result = compile(ce.box(ast!));
    expect(result.success).toBe(true);
    expect(result.run()).toBe(6);
  });
});
