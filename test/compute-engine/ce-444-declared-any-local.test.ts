/**
 * A block local declared `any` keeps its declared type: a use does not
 * narrow it (CE-444). Before, `xs = ReplaceAt(xs, i, "z")` after
 * `xs = "abc"` narrowed `xs` to `indexed_collection<string>`, which the
 * string it holds is not (the elements of a string are characters).
 *
 * An operand typed `any` (or `unknown`, when the type is not inferred from
 * the call) at a generic collection parameter can be any collection, so
 * the variables of the parameter are absorbed: `ReplaceAt(ys, 2, "z")` with
 * `ys: any` is typed `list<any>`, not the `list<string>` solved from `"z"`
 * alone, which its value `["a", "z", "c"]` is not.
 */
import { ComputeEngine } from '../../src/compute-engine';

const block = (decl: unknown[] | null): unknown[] => [
  'Block',
  ...(decl ? [decl] : []),
  ['Assign', 'xs', { str: 'abc' }],
  ['Assign', 'xs', ['ReplaceAt', 'xs', 2, { str: 'z' }]],
  'xs',
];

describe('a block local declared any', () => {
  test('is not narrowed by a use', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(block(['Declare', 'xs', "'any'"]) as any);
    expect(expr.type.toString()).toBe('any');
    const update = expr.ops![2];
    expect(update.ops![1].ops![0].type.toString()).toBe('any');
    const value = expr.evaluate();
    expect(value.toString()).toBe('["a","z","c"]');
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('in a loop', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'xs', "'any'"],
      ['Assign', 'xs', { str: 'abc' }],
      [
        'Loop',
        ['Assign', 'xs', ['ReplaceAt', 'xs', 'j', { str: 'z' }]],
        ['Element', 'j', ['Range', 1, 2]],
      ],
      'xs',
    ] as any);
    expect(expr.type.toString()).toBe('any');
    const value = expr.evaluate();
    expect(value.toString()).toBe('["z","z","c"]');
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('a local with no declaration is typed by its assignments', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(block(null) as any);
    const value = expr.evaluate();
    expect(value.type.matches(expr.type)).toBe(true);
  });
});

describe('an operand typed any at a generic collection parameter', () => {
  test('absorbs the element variable', () => {
    const ce = new ComputeEngine();
    ce.declare('ys', 'any');
    ce.assign('ys', ce.string('abc'));
    const expr = ce.box(['ReplaceAt', 'ys', 2, { str: 'z' }]);
    expect(expr.type.toString()).toBe('list<any>');
    const value = expr.evaluate();
    expect(value.toString()).toBe('["a","z","c"]');
    expect(value.type.matches(expr.type)).toBe(true);
  });
});

describe('an absent value of a block local declared any', () => {
  test('is NaN in arithmetic, as for a symbol declared any', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'xs', "'any'"],
      ['Assign', 'xs', 'Missing'],
      ['Add', 'xs', 1],
    ] as any);
    const value = expr.evaluate();
    expect(value.isNaN).toBe(true);
    expect(value.type.matches(expr.type)).toBe(true);
  });
});
