import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

// A Program retains a nested Block for a sole `do { … }` statement, so its
// declarations belong to the block rather than the caller's program scope.

function strip(x: unknown): unknown {
  return JSON.parse(
    JSON.stringify(x, (key, value) =>
      key === 'sourceOffsets' ? undefined : value
    )
  );
}

describe('a program whose only statement is a block', () => {
  test('the block is a nested scope', () => {
    // At the top level of a program, a `let` of the library constant `Pi` is
    // refused. In a nested block it shadows the constant.
    const alone = executeEpsil(new ComputeEngine(), 'do { let Pi = 3; Pi }');
    expect(alone.diagnostics).toEqual([]);
    expect(alone.value.toString()).toBe('3');

    const after = executeEpsil(
      new ComputeEngine(),
      'let x = 1\ndo { let Pi = 3; Pi }'
    );
    expect(after.diagnostics).toEqual([]);
    expect(after.value.toString()).toBe('3');
  });

  test('a declaration in the block does not leak into the program', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'do { let a = 3; a }');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('3');
    // A later run on the same engine does not see `a`.
    expect(executeEpsil(ce, 'a').value.toString()).toBe('a');
  });

  test('the parsed shape is a Block inside Program', () => {
    const [ast, diagnostics] = parseEpsil('do { let a = 3; a }');
    expect(diagnostics).toEqual([]);
    expect(strip(ast)).toEqual({
      fn: [
        'Program',
        {
          fn: [
            'Block',
            {
              fn: [
                'Declare',
                { sym: 'a' },
                {
                  fn: [
                    'Dictionary',
                    { fn: ['KeyValuePair', { sym: 'value' }, { num: '3' }] },
                  ],
                },
              ],
            },
            { sym: 'a' },
          ],
        },
      ],
    });
  });

  test.each([
    'do { let Pi = 3; Pi }',
    'do {}',
    'do { x }',
    'do { do { 1; 2 } }',
    '1; do { 2 }',
  ])('the serialization round trip keeps the shape: %s', (source) => {
    const [ast] = parseEpsil(source);
    const text = serializeEpsil(ast);
    const [again, diagnostics] = parseEpsil(text);
    expect(diagnostics).toEqual([]);
    expect(strip(again)).toEqual(strip(ast));
  });

  test('a wrapped program is written as the block alone', () => {
    const [ast] = parseEpsil('do { let a = 3; a }');
    expect(serializeEpsil(ast)).toBe('do {let a = 3; a}');
  });
});
