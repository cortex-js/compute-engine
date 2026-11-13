import { ComputeEngine } from '../../src/compute-engine';
import {
  memoDepsStillValid,
  snapshotMemoDeps,
} from '../../src/compute-engine/boxed-expression/collection-element-memo';

// The dependency snapshot of the memos of evaluated values
// (`snapshotMemoDeps()`, `collection-element-memo.ts`) walks the symbols of
// an expression. `Declare` and `Assign` hold their target as a raw symbol,
// and `Declare` holds its type as a raw symbol when the type is written as a
// symbol. When an enclosing `Block` binds the target, these operands name
// the local and its type and read no binding, so the walk skips them. Before
// this rule, the raw target made the expression ineligible, and a block with
// `Declare(c, "unknown", v)` (the form that a block local with a value must
// have since language 3.4.4) had no memo entry.

describe('the snapshot of a block with a local', () => {
  const statements: [string, unknown[]][] = [
    ['Declare with a string type', [['Declare', 'c', "'unknown'", 'P']]],
    ['Declare with a symbol type', [['Declare', 'c', 'unknown', 'P']]],
    [
      'an Assign of a declared local',
      [
        ['Declare', 'c', "'unknown'", 0],
        ['Assign', 'c', 'P'],
      ],
    ],
  ];

  test.each(statements)('%s', (_label, statements) => {
    const ce = new ComputeEngine();
    ce.declare('P', { type: 'real', value: 2 });
    const literal = ce.box([
      'Function',
      ['Block', ...statements, ['Add', 'c', 't']],
      't',
    ] as never);
    const deps = snapshotMemoDeps(literal);
    expect(deps).toBeDefined();
    expect(memoDepsStillValid(literal, deps!)).toBe(true);
    // The value that the local is made from is a dependency.
    ce.assign('P', 5);
    expect(memoDepsStillValid(literal, deps!)).toBe(false);
  });

  test('an Assign of a name that no block binds is not followed', () => {
    const ce = new ComputeEngine();
    ce.declare('P', { type: 'real', value: 2 });
    const expr = ce.box(['Assign', 'q', 'P']);
    expect(snapshotMemoDeps(expr)).toBeUndefined();
  });
});
