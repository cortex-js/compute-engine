import { ComputeEngine } from '../../src/compute-engine';

/**
 * A predicate can fail on the ELEMENT rather than on the predicate itself: the
 * callback parameter's `Typed` annotation (installed by `callbackElementOf`)
 * rejects an element whose type was retracted. That used to be reported as
 * `Filter predicate must return "True" or "False".` followed by a spell-check
 * hint about the LAMBDA'S OWN PARAMETER (`Unknown symbol "n". Did you mean
 * "i"?`).
 *
 * The predicate consumers now surface the element's `Error` value, the way
 * `Map` does — into the output stream for `Filter`, as the operator's result
 * for the scalar-valued consumers.
 */

/** `["Function", <body>, ["Typed", <param>, <type>]]` — the shape the
 * `callbackElementOf` rewrite produces once the element type is known. */
const annotatedPredicate = (param: string, type: string) => [
  'Function',
  ['Greater', param, 0],
  ['Typed', param, `'${type}'`],
];

describe('Filter with an Error-valued predicate result', () => {
  test('the retraction repro surfaces the element error, not a spell-check hint', () => {
    const ce = new ComputeEngine();
    ce.assign('ds', ce.box(['List', 1, 2, 3]));
    const f = ce.box(['Filter', 'ds', ['Function', ['Greater', 'n', 0], 'n']]);

    // First evaluation auto-annotates the parameter with `finite_integer`.
    expect(f.evaluate().toString()).toBe('[1,2,3]');

    // Retract the source to floats: every element is now rejected by the
    // annotation.
    ce.assign('ds', ce.box(['List', 1.5, 2.5]));
    const result = f.evaluate().toString();
    expect(result).toContain('incompatible-type');
    expect(result).not.toContain('Did you mean');
    expect(result).not.toContain('must return');
  });

  test('the error value is emitted per element, as Map does', () => {
    const ce = new ComputeEngine();
    const xs = ['List', 1.5, 2.5];
    const filtered = ce
      .box(['Filter', xs, annotatedPredicate('n', 'finite_integer')])
      .evaluate();
    const mapped = ce
      .box([
        'Map',
        xs,
        ['Function', ['Add', 'n', 0], ['Typed', 'n', "'finite_integer'"]],
      ])
      .evaluate();
    expect(filtered.toString()).toBe(mapped.toString());
    expect(filtered.toString()).toBe(
      '[Error(ErrorCode("incompatible-type", "finite_integer", "finite_real")),' +
        'Error(ErrorCode("incompatible-type", "finite_integer", "finite_real"))]'
    );
  });

  test('a genuine non-boolean predicate keeps the existing message', () => {
    const ce = new ComputeEngine();
    const result = ce
      .box(['Filter', ['List', 1, 2, 3], ['Function', ['Add', 'k', 1], 'k']])
      .evaluate()
      .toString();
    expect(result).toContain('Filter predicate must return "True" or "False"');
  });

  test('a valid unannotated Filter is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Filter',
          ['List', 1, 2, 3, 4],
          ['Function', ['Greater', 'k', 2], 'k'],
        ])
        .evaluate()
        .toString()
    ).toBe('[3,4]');
  });
});

describe('Sibling predicate consumers with an Error-valued result', () => {
  for (const op of [
    'CountIf',
    'Find',
    'Position',
    'IndexWhere',
    'Partition',
  ] as const) {
    test(`${op} returns the element error`, () => {
      const ce = new ComputeEngine();
      const result = ce
        .box([
          op,
          ['List', 1.5, 2.5],
          annotatedPredicate('n', 'finite_integer'),
        ])
        .evaluate();
      expect(result.operator).toBe('Error');
      expect(result.toString()).toContain('incompatible-type');
      expect(result.toString()).not.toContain('Did you mean');
    });

    test(`${op} keeps the existing message for a genuine non-boolean predicate`, () => {
      const ce = new ComputeEngine();
      expect(() =>
        ce
          .box([
            op,
            ['List', 1, 2, 3],
            ['Function', ['Add', 'k', 1], 'k'],
          ])
          .evaluate()
      ).toThrow('must return "True" or "False"');
    });
  }

  test('CountIf over valid elements is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'CountIf',
          ['List', 1, 2, 3, 4],
          ['Function', ['Greater', 'k', 2], 'k'],
        ])
        .evaluate()
        .toString()
    ).toBe('2');
  });
});
