import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// ROADMAP CE-808: an indexed `Sum` or `Product` over a list of unknown
// length is the number `0` or `1` for an empty range, as in the
// interpreter, so a value typed as a list can be a number at run time. The
// fold of `Sum` or `Product` over a list of numbers, and `Max` or `Min` of a
// list operand, alone or beside other operands, test the shape of a value
// that can be such a number (`foldNeedsNoShapeTest()` in
// `compilation/javascript-target.ts`): a number is the fold or the extremum
// of itself. An input typed as a list, a declared parameter, a `Take`, and
// an `If` or `Which` of such values get no test.

const DECLS: Record<string, string> = {
  L: 'list<real>',
  V: 'vector<3>',
  n: 'integer',
};

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(DECLS)) ce.declare(name, type);
  return ce;
}

describe('A VALUE THAT CANNOT BE AN EMPTY INDEXED SUM TESTS NO SHAPE (CE-808)', () => {

  // Each value branch of the `Which` is a list literal.
  test.each([true, false])('a Sum of a Which of list literals, c = %s', (c) => {
    const ce = engine();
    ce.declare('c', 'boolean');
    const expr = ['Sum', ['Which', 'c', ['List', 1, 2], 'True', ['List', 3]]];
    const r = compile(ce.box(expr as any), { to: 'javascript' } as any);
    expect(r.code).not.toContain('Array.isArray');
    expect(r.run!({ c } as never)).toBe(3);
  });

});
