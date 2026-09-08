import { ComputeEngine } from '../../src/compute-engine';
import { typeHandlerContext } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
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
    ['Power', ['list<list<integer^2>^2>', 'integer']],
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
