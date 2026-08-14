import { ComputeEngine } from '../../src/compute-engine';

/**
 * A predicate can fail on the ELEMENT rather than on the predicate itself: the
 * callback parameter's `Typed` annotation (installed by the operator's
 * contextual `callback<S>` slot) rejects an element whose type was retracted. That used to be reported as
 * `Filter predicate must return "True" or "False".` followed by a spell-check
 * hint about the LAMBDA'S OWN PARAMETER (`Unknown symbol "n". Did you mean
 * "i"?`).
 *
 * The predicate consumers now surface the element's `Error` value, the way
 * `Map` does — into the output stream for `Filter`, as the operator's result
 * for the scalar-valued consumers.
 */

/** `["Function", <body>, ["Typed", <param>, <type>]]` — the shape the
 * contextual stamp produces once the element type is known. */
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
        ['Function', ['Add', 'n', 0], ['Typed', 'n', "'finite_integer'"]],
        xs,
      ])
      .evaluate();
    expect(filtered.toString()).toBe(mapped.toString());
    expect(filtered.toString()).toBe(
      '[Error(ErrorCode("incompatible-type", "finite_integer", "finite_real"), 1.5),' +
        'Error(ErrorCode("incompatible-type", "finite_integer", "finite_real"), 2.5)]'
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
          .box([op, ['List', 1, 2, 3], ['Function', ['Add', 'k', 1], 'k']])
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

/**
 * `Any`/`All` are the SHORT-CIRCUITING members of the scalar-consumer family,
 * so they need the sibling contract stated twice over: an element-valued
 * predicate failure is the operator's RESULT (it used to be absorbed into the
 * "undetermined" branch, discarding the error and leaving the quantifier
 * inert), AND the interaction with the short circuit is decided by ENUMERATION
 * ORDER — whichever the walk meets first wins.
 */
describe('Any/All with an Error-valued predicate result', () => {
  for (const op of ['Any', 'All'] as const) {
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
      expect(result.toString()).not.toContain('must return');
    });

    test(`${op} surfaces an error met BEFORE any decision`, () => {
      // `n > 0`: the float element fails its annotation at index 1, and the
      // element that would short-circuit (`7` → True for `Any`; `-1` → False
      // for `All`) sits AFTER it. The error wins.
      const ce = new ComputeEngine();
      const result = ce
        .box([
          op,
          ['List', 1.5, op === 'Any' ? 7 : -1],
          annotatedPredicate('n', 'finite_integer'),
        ])
        .evaluate();
      expect(result.operator).toBe('Error');
      expect(result.toString()).toContain('incompatible-type');
    });

    test(`${op} still short-circuits on a decision met BEFORE the error`, () => {
      // The same two elements, swapped: the walk answers and never looks at
      // the failing element — the family's laziness, unchanged.
      const ce = new ComputeEngine();
      expect(
        ce
          .box([
            op,
            ['List', op === 'Any' ? 7 : -1, 1.5],
            annotatedPredicate('n', 'finite_integer'),
          ])
          .evaluate()
          .toString()
      ).toBe(op === 'Any' ? '"True"' : '"False"');
    });

    test(`${op} over valid elements is unchanged`, () => {
      const ce = new ComputeEngine();
      expect(
        ce
          .box([op, ['List', 1, 2, 3], ['Function', ['Greater', 'k', 0], 'k']])
          .evaluate()
          .toString()
      ).toBe('"True"');
    });

    test(`${op} stays inert for a genuine non-boolean predicate`, () => {
      // Unlike the eager siblings, the quantifiers never threw here: a
      // non-boolean result is "undetermined" and the expression stays inert.
      // Surfacing the ERROR value must not change that.
      const ce = new ComputeEngine();
      const e = ce.box([
        op,
        ['List', 1, 2, 3],
        ['Function', ['Add', 'k', 1], 'k'],
      ]);
      expect(e.evaluate().operator).toBe(op);
    });
  }

  test('the retraction repro surfaces the element error', () => {
    const ce = new ComputeEngine();
    ce.assign('ds', ce.box(['List', 1, 2, 3]));
    const f = ce.box(['Any', 'ds', ['Function', ['Greater', 'n', 0], 'n']]);

    // First evaluation auto-annotates the parameter with `finite_integer`.
    expect(f.evaluate().toString()).toBe('"True"');

    // Retract the source to floats: the retained annotation now rejects every
    // element, and the quantifier reports it instead of going inert.
    ce.assign('ds', ce.box(['List', 1.5, 2.5]));
    const result = f.evaluate().toString();
    expect(result).toContain('incompatible-type');
    expect(result).not.toContain('Did you mean');
    expect(result).not.toContain('must return');
  });
});

/**
 * The While family stops (or stops dropping) at the first element the
 * predicate does not answer `True` for. An Error-VALUED result used to be
 * absorbed by that "not True" branch, so an undecidable element was
 * indistinguishable from a legitimate `False`: `TakeWhile` silently truncated
 * and `DropWhile` silently passed the element through as a value.
 *
 * Both now EMIT the element's `Error` in its place, as `Filter` does, at the
 * boundary the predicate stopped at:
 *  - `TakeWhile` emits it, then terminates (no later element can be in the
 *    prefix);
 *  - `DropWhile` emits it, then passes the rest of the source through (the
 *    predicate is never applied past the first non-True element).
 */
/** The failing element's value is now appended to the error, right after
 * `ErrorCode`, so the four call sites below each pass their own site value. */
const ERR = (site: string) =>
  'Error(ErrorCode("incompatible-type", "finite_integer", ' +
  `"finite_real"), ${site})`;

describe('While family with an Error-valued predicate result', () => {
  test('TakeWhile emits the error, then stops', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'TakeWhile',
          ['List', 1.5, 2.5],
          annotatedPredicate('n', 'finite_integer'),
        ])
        .evaluate()
        .toString()
    ).toBe(`[${ERR('1.5')}]`);
  });

  test('TakeWhile keeps the valid prefix before the error', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'TakeWhile',
          ['List', 1, 2.5, 3, 4],
          annotatedPredicate('n', 'finite_integer'),
        ])
        .evaluate()
        .toString()
    ).toBe(`[1,${ERR('2.5')}]`);
  });

  test('TakeWhile reports the error prefix as non-empty, of length 1', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'TakeWhile',
      ['List', 1.5, 2.5],
      annotatedPredicate('n', 'finite_integer'),
    ]);
    expect(expr.isEmptyCollection).toBe(false);
    expect(expr.count).toBe(1);
  });

  test('TakeWhile with a genuine False stop is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'TakeWhile',
          ['List', 1, 2, -3, 4],
          ['Function', ['Greater', 'k', 0], 'k'],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
    expect(
      ce
        .box([
          'TakeWhile',
          ['List', 1, 2, 3],
          ['Function', ['Greater', 'k', 0], 'k'],
        ])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]');
  });

  test('DropWhile emits the error in place, then passes the rest through', () => {
    const ce = new ComputeEngine();
    // The first element is already undecidable: the error stands in for it,
    // and the remaining elements follow unfiltered.
    expect(
      ce
        .box([
          'DropWhile',
          ['List', 1.5, 2.5],
          annotatedPredicate('n', 'finite_integer'),
        ])
        .evaluate()
        .toString()
    ).toBe(`[${ERR('1.5')},2.5]`);
  });

  test('DropWhile drops the valid True run before the error', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'DropWhile',
          ['List', 1, 2.5, 3, 4],
          annotatedPredicate('n', 'finite_integer'),
        ])
        .evaluate()
        .toString()
    ).toBe(`[${ERR('2.5')},3,4]`);
  });

  test('DropWhile with a genuine False stop is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'DropWhile',
          ['List', 1, 2, -3, 4],
          ['Function', ['Greater', 'k', 0], 'k'],
        ])
        .evaluate()
        .toString()
    ).toBe('[-3,4]');
    expect(
      ce
        .box([
          'DropWhile',
          ['List', 1, 2, 3],
          ['Function', ['Greater', 'k', 0], 'k'],
        ])
        .evaluate()
        .toString()
    ).toBe('[]');
  });
});

/**
 * `Filter`'s `contains` handler mapped every non-`True` predicate result to a
 * definite `false`. For an Error-VALUED result that is an unsound answer: the
 * predicate could not judge the element, so membership is UNDECIDED and the
 * handler must decline by returning `undefined` (the documented "cannot be
 * determined" signal of `CollectionHandlers.contains`).
 */
describe('Filter contains with an Error-valued predicate result', () => {
  test('membership is undecided, not false', () => {
    const ce = new ComputeEngine();
    const filtered = ce.box([
      'Filter',
      ['List', 1.5, 2.5],
      annotatedPredicate('n', 'finite_integer'),
    ]);
    expect(filtered.contains(ce.number(1.5))).toBe(undefined);
    // ...and the `Element` query stays symbolic instead of answering False.
    expect(
      ce
        .box([
          'Element',
          1.5,
          [
            'Filter',
            ['List', 1.5, 2.5],
            annotatedPredicate('n', 'finite_integer'),
          ],
        ])
        .evaluate().operator
    ).toBe('Element');
  });

  test('True and False answers are unchanged', () => {
    const ce = new ComputeEngine();
    const predicate = ['Function', ['Greater', 'k', 2], 'k'];
    const filtered = ce.box(['Filter', ['List', 1, 2, 3], predicate]);
    expect(filtered.contains(ce.number(3))).toBe(true);
    // In the source, but rejected by the predicate.
    expect(filtered.contains(ce.number(1))).toBe(false);
    // Not in the source at all.
    expect(filtered.contains(ce.number(9))).toBe(false);
    expect(
      ce
        .box(['Element', 3, ['Filter', ['List', 1, 2, 3], predicate]])
        .evaluate().symbol
    ).toBe('True');
    expect(
      ce
        .box(['Element', 1, ['Filter', ['List', 1, 2, 3], predicate]])
        .evaluate().symbol
    ).toBe('False');
  });
});

/**
 * A `contains` handler answers with THREE values: `true`, `false`, and
 * `undefined` for "membership cannot be determined" (`CollectionHandlers`,
 * `types-definitions.ts`). Several handlers collapsed an undecided sub-query
 * into a definite `false` — `?? false` on the source's own verdict, or an
 * `Array.prototype.some()`/`||` over sub-queries — so
 * `Element(x, Reverse(ys))` answered `False` for a source that had answered
 * "I don't know".
 */
describe('contains propagates an undecided source verdict', () => {
  /** A symbolic collection: declared, never assigned, so `contains` on it is
   * undecided. */
  const symbolicSource = (ce: ComputeEngine) => {
    ce.declare('ys', 'list<number>');
    return 'ys';
  };

  test('Filter over a symbolic source is undecided, not false', () => {
    const ce = new ComputeEngine();
    const ys = symbolicSource(ce);
    const predicate = ['Function', ['Greater', 'k', 2], 'k'];
    // The source itself cannot decide...
    expect(ce.symbol('ys').contains(ce.symbol('x'))).toBe(undefined);
    // ...so neither can the filter of it.
    expect(ce.box(['Filter', ys, predicate]).contains(ce.symbol('x'))).toBe(
      undefined
    );
    // ...and the `Element` query stays symbolic instead of answering False.
    expect(
      ce.box(['Element', 'x', ['Filter', ys, predicate]]).evaluate().operator
    ).toBe('Element');
  });

  test('Filter over a definitely-refuting source still answers false', () => {
    const ce = new ComputeEngine();
    const predicate = ['Function', ['Greater', 'k', 2], 'k'];
    const filtered = ce.box(['Filter', ['List', 1, 2, 3], predicate]);
    // Not in the source at all: a DEFINITE `false` from the source.
    expect(filtered.contains(ce.number(9))).toBe(false);
    expect(
      ce
        .box(['Element', 9, ['Filter', ['List', 1, 2, 3], predicate]])
        .evaluate().symbol
    ).toBe('False');
  });

  // Reverse/RotateLeft/RotateRight are permutations of the source and Cycle
  // repeats it, so each one's membership is EXACTLY the source's — including
  // the source's undecided verdict (these all had `?? false`).
  for (const [op, args] of [
    ['Reverse', []],
    ['RotateLeft', [2]],
    ['RotateRight', [2]],
    ['Cycle', []],
  ] as const) {
    test(`${op} propagates an undecided source verdict`, () => {
      const ce = new ComputeEngine();
      const ys = symbolicSource(ce);
      expect(ce.box([op, ys, ...args]).contains(ce.symbol('x'))).toBe(
        undefined
      );
      // A concrete source still decides both ways.
      expect(
        ce.box([op, ['List', 1, 2, 3], ...args]).contains(ce.number(2))
      ).toBe(true);
      expect(
        ce.box([op, ['List', 1, 2, 3], ...args]).contains(ce.number(9))
      ).toBe(false);
    });
  }

  test('Join is a three-valued OR over its operands', () => {
    const ce = new ComputeEngine();
    const ys = symbolicSource(ce);
    // One operand cannot decide: the whole query cannot either (`.some()`
    // used to report a definite `false`).
    expect(ce.box(['Join', ['List', 1, 2], ys]).contains(ce.symbol('x'))).toBe(
      undefined
    );
    // ...unless another operand settles it affirmatively.
    expect(ce.box(['Join', ['List', 1, 2], ys]).contains(ce.number(1))).toBe(
      true
    );
    expect(
      ce.box(['Join', ['List', 1, 2], ['List', 3]]).contains(ce.number(3))
    ).toBe(true);
    expect(
      ce.box(['Join', ['List', 1, 2], ['List', 3]]).contains(ce.number(9))
    ).toBe(false);
  });

  test('Append defers to the source when no appended operand matches', () => {
    const ce = new ComputeEngine();
    const ys = symbolicSource(ce);
    // `op1.contains(target) || …` turned the source's `undefined` into
    // `false`.
    expect(ce.box(['Append', ys, 5]).contains(ce.symbol('x'))).toBe(undefined);
    // An appended operand that matches settles the query outright.
    expect(ce.box(['Append', ys, 5]).contains(ce.number(5))).toBe(true);
    expect(ce.box(['Append', ['List', 1, 2], 5]).contains(ce.number(2))).toBe(
      true
    );
    expect(ce.box(['Append', ['List', 1, 2], 5]).contains(ce.number(9))).toBe(
      false
    );
  });
});

/**
 * A genuinely non-boolean predicate result is a MALFORMED predicate, and every
 * other `Filter` facet says so out loud: `each()`, `count`, `isEmptyCollection`
 * and `isEqual` all throw `Filter predicate must return "True" or "False".`,
 * as do the five sibling predicate consumers (`Find`, `CountIf`, `Position`,
 * `IndexWhere`, `Partition`). Only `contains` answered `false` — a definite
 * membership verdict derived from a predicate that never produced one.
 *
 * The throw surfaces where the loud siblings' does (out of `evaluate()`) and
 * leaves boxing/canonicalization and the assumptions machinery untouched.
 */
describe('Filter contains with a non-boolean predicate result', () => {
  /** `k ↦ k + 1` — well-formed as a function, useless as a predicate. */
  const nonBoolean = ['Function', ['Add', 'k', 1], 'k'];
  const filter = ['Filter', ['List', 1, 2, 3], nonBoolean];
  const MESSAGE = 'Filter predicate must return "True" or "False"';

  test('contains reports the malformed predicate instead of answering false', () => {
    const ce = new ComputeEngine();
    expect(() => ce.box(filter).contains(ce.number(2))).toThrow(MESSAGE);
  });

  test('the other Filter facets already reported it the same way', () => {
    const ce = new ComputeEngine();
    expect(() => ce.box(filter).count).toThrow(MESSAGE);
    expect(() => ce.box(filter).isEmptyCollection).toThrow(MESSAGE);
  });

  test('an Element query surfaces it, as the sibling consumers do', () => {
    const ce = new ComputeEngine();
    expect(() => ce.box(['Element', 2, filter]).evaluate()).toThrow(MESSAGE);
    expect(() => ce.box(['Contains', filter, 2]).evaluate()).toThrow(MESSAGE);
  });

  test('boxing and canonicalization are unaffected', () => {
    const ce = new ComputeEngine();
    // `contains` is not consulted while boxing, so the malformed predicate
    // does not corrupt canonicalization.
    expect(ce.box(['Element', 2, filter]).operator).toBe('Element');
    expect(ce.box(['Element', 2, filter]).simplify().operator).toBe('Element');
  });

  test('a well-formed predicate is unaffected', () => {
    const ce = new ComputeEngine();
    const ok = ce.box([
      'Filter',
      ['List', 1, 2, 3],
      ['Function', ['Greater', 'k', 2], 'k'],
    ]);
    expect(ok.contains(ce.number(3))).toBe(true);
    expect(ok.contains(ce.number(1))).toBe(false);
  });
});

/**
 * `color` is a concrete leaf primitive, so it is admitted by the element-type
 * gate of the per-application lambda-parameter inference: an inline callback
 * over a `list<color>` gets its parameter stamped `(c: color)`.
 */
describe('color is an admissible inferred element type', () => {
  /** A two-element `list<color>`, built through the public `Color` operator. */
  const colorList = (ce: ComputeEngine) =>
    ce.box(['List', ['Color', "'red'"], ['Color', "'blue'"]]).evaluate();

  test('a Map callback over a color list is stamped (c: color)', () => {
    const ce = new ComputeEngine();
    ce.assign('cs', colorList(ce));
    const expr = ce.box([
      'Map',
      ['Function', ['ColorToString', 'c'], 'c'],
      'cs',
    ]);
    expect(expr.ops[0].type.toString()).toBe('(c: color) -> string');
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['Function', ['ColorToString', 'c'], ['Typed', 'c', "'color'"]],
      'cs',
    ]);
    expect(expr.evaluate().toString()).toBe('["#d7170b","#0d80f2"]');
  });

  test('a Filter callback over a color list is stamped and evaluates', () => {
    const ce = new ComputeEngine();
    ce.assign('cs', colorList(ce));
    const expr = ce.box([
      'Filter',
      'cs',
      ['Function', ['Equal', ['ColorToString', 'c'], "'#d7170b'"], 'c'],
    ]);
    expect(expr.ops[1].type.toString()).toBe('(c: color) -> boolean');
    expect(expr.evaluate().count).toBe(1);
  });
});

/**
 * `FlatMap`'s finiteness facet (reviewed 2026-08-09): a FINITE source is not
 * on its own enough — a callback returning an INFINITE inner collection makes
 * the flattened stream infinite, and every finite-guarded consumer (`Reduce`,
 * `Sum`, …) enumerates on the strength of this facet.
 */
describe('FlatMap isFiniteCollection', () => {
  test('a fixed-extent callback result over a finite source is finite', () => {
    const ce = new ComputeEngine();
    const fm = ce.box([
      'FlatMap',
      ['List', 1, 2],
      ['Function', ['List', 'n', ['Multiply', 10, 'n']], 'n'],
    ]);
    expect(fm.isFiniteCollection).toBe(true);
    // The pinned fold survives.
    expect(
      ce
        .box(['Reduce', fm, ['Function', ['Add', 'a', 'x'], 'a', 'x'], 0])
        .evaluate()
        .toString()
    ).toBe('33');
  });

  test('a SCALAR callback result over a finite source is finite', () => {
    const ce = new ComputeEngine();
    const fm = ce.box([
      'FlatMap',
      ['List', 1, 2],
      ['Function', ['Multiply', 2, 'n'], 'n'],
    ]);
    expect(fm.isFiniteCollection).toBe(true);
    expect(fm.evaluate().toString()).toBe('[2,4]');
  });

  test('an INFINITE callback result is not claimed finite', () => {
    const ce = new ComputeEngine();
    const fm = ce.box([
      'FlatMap',
      ['List', 1, 2],
      ['Function', ['Range', 1, 'PositiveInfinity'], 'n'],
    ]);
    expect(fm.isFiniteCollection).toBe(undefined);
  });

  test('an unprovable callback result type is not claimed finite', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    expect(
      ce.box(['FlatMap', ['List', 1, 2], 'h']).isFiniteCollection
    ).toBe(undefined);
  });

  test('a provably infinite source still reports false', () => {
    const ce = new ComputeEngine();
    const fm = ce.box([
      'FlatMap',
      ['Range', 1, 'PositiveInfinity'],
      ['Function', ['List', 'n'], 'n'],
    ]);
    expect(fm.isFiniteCollection).toBe(false);
  });
});
