import { ComputeEngine } from '../../src/compute-engine';
import { typeHandlerContext } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
  describe as describeOperand,
  describeBoundSymbol,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

/**
 * The descriptor route of type derivation (`context.derive`, what a `type`
 * handler calls to type a body over its operands) applies the same broadcast
 * lift as the expression route (`expr.type`): a broadcastable operator over a
 * collection-typed operand is typed element-wise on both. Before the lift was
 * shared, `derive('Power', [list<integer^3>, 2])` answered `number`.
 */
describe('the descriptor route lifts like the expression route', () => {
  const T = (s: string) => parseType(s)!;

  // [operator, operand types]: the expression route is asked the same
  // application over declared symbols of those types.
  const cases: [string, string[]][] = [
    ['Power', ['list<integer^3>', 'integer']],
    ['Sin', ['list<integer^3>']],
    ['Add', ['list<integer^3>', 'integer']],
    ['Power', ['tuple<integer, integer>', 'integer']],
    // A nested list that is not a matrix (its rows have no length), so its
    // power is element-wise on both routes. A nested list with row
    // lengths IS a matrix, and its power to an integer literal is the
    // matrix power: the matrix cases are in the next block.
    ['Power', ['list<list<integer>^2>', 'integer']],
    ['Power', ['number | list<number>', 'integer']],
    ['Power', ['indexed_collection<integer>', 'integer']],
    ['Length', ['list<integer^3>']],
    ['Negate', ['list<list<integer^2>^2>']],
    ['Abs', ['list<tuple<integer, integer>>']],
    ['Power', ['vector<integer^2>', 'integer']],
    ['Multiply', ['list<integer^3>', 'list<integer^3>']],
  ];

  test.each(cases)('%s over %j', (operator, types) => {
    // One engine per case: the declared operand symbols share names.
    const ce = new ComputeEngine();
    const ctx = typeHandlerContext(ce as any);
    const descriptors = types.map((t, i) =>
      t === 'integer' && i > 0
        ? describeType(T(t))
        : describeBoundSymbol(T(t), `__${operator}${i}`)
    );
    const derived = ctx.derive(operator, descriptors);
    const operands = types.map((t, i) => {
      if (t === 'integer' && i > 0) return 2;
      const name = `s_${operator}_${i}`;
      ce.declare(name, t);
      return name;
    });
    const expression = ce.box([operator, ...operands]).type.toString();
    expect(derived === undefined ? 'undefined' : typeToString(derived)).toBe(
      expression
    );
  });

  // [base type, integer exponent]. Canonicalization writes a power of a
  // matrix to an integer literal as `MatrixPower` (or as `Inverse` for -1,
  // or as the base for 1), and the descriptor route types the same node
  // when its exponent is the same literal.
  const matrixCases: [string, number][] = [
    ['matrix<integer^(2x2)>', 2],
    ['matrix<integer^(2x2)>', 0],
    ['matrix<integer^(2x2)>', -1],
    ['matrix<integer^(2x2)>', -2],
    ['matrix<integer^(2x2)>', 1],
    ['list<list<integer^2>^2>', 2],
    ['list<list<integer^2>^2>', -2],
    ['matrix<real^(3x3)>', 3],
    ['matrix<integer>', -2],
    ['matrix<integer^(2x3)>', 2],
    ['matrix', 2],
  ];

  test.each(matrixCases)('Power of a %s to %d', (type, k) => {
    const ce = new ComputeEngine();
    const ctx = typeHandlerContext(ce as any);
    const derived = ctx.derive('Power', [
      describeBoundSymbol(T(type), '__base'),
      describeOperand(ce.number(k)),
    ]);
    ce.declare('m', type);
    const expression = ce.box(['Power', 'm', k]).type.toString();
    expect(derived === undefined ? 'undefined' : typeToString(derived)).toBe(
      expression
    );
  });

  test('a two-collection comparison stays a whole-value boolean', () => {
    const ctx = typeHandlerContext(new ComputeEngine() as any);
    expect(
      typeToString(
        ctx.derive('Equal', [
          describeBoundSymbol(T('list<integer^3>'), '__a'),
          describeBoundSymbol(T('list<integer^3>'), '__b'),
        ])!
      )
    ).toBe('boolean');
  });
});
