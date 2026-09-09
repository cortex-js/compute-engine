import { ComputeEngine } from '../../src/compute-engine';

/**
 * A parameter spelled as a union of a CALLABLE arm and a NUMERIC arm — the
 * "size or predicate" shape, of which `Partition`'s
 * `integer | ((T) any -> boolean)` is the only instance in the standard
 * library — used to refuse an operand its single-arm siblings accept.
 *
 * The operand in question is one whose type only MAY be absent: a piecewise
 * with no default arm types `integer | missing` and evaluates to `Missing`
 * where it has no value (ruled 2026-09-09; that typing is not changed here).
 * At a plain `integer`/`number` parameter — `Take`, `Drop`, `Chunk`,
 * `SlidingWindow` — such an operand is admitted at canonicalization because
 * the two types overlap, and the verdict is deferred to the runtime
 * conformance check. A union carrying a callable arm was exempt from that
 * admission, so `Partition(xs, k)` errored at boxing where every sibling
 * boxed. The exemption exists for the arrow-slot rules, whose authority is
 * over a CALLABLE operand only, so it no longer covers a non-callable one
 * (`unionOfCallableAndNumericArms`, `boxed-expression/validate.ts`).
 *
 * The three verdicts pinned below, on the box route and the parse route:
 *  - a PRESENT size boxes and partitions;
 *  - an ABSENT size boxes and answers the same `incompatible-type` error at
 *    evaluation that `Chunk` answers (`docs/ERROR-MODEL.md` §2, rule 2);
 *  - a genuinely non-numeric size (a string) is still refused at boxing.
 */

/** An engine with `k`, a default-less piecewise: `k(t) = 2` when `t < 1`,
 * absent otherwise. `k(0)` is present (`2`), `k(3)` is absent (`Missing`). */
function engineWithPiecewise(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.parse('k(t) := \\begin{cases} 2 & t < 1 \\end{cases}').evaluate();
  return ce;
}

describe('the maybe-absent operand', () => {
  test('types `integer | missing` and evaluates to `2` / `Missing`', () => {
    const ce = engineWithPiecewise();
    expect(ce.box(['k', 0]).type.toString()).toBe('integer | missing');
    expect(ce.box(['k', 0]).evaluate().toString()).toBe('2');
    expect(ce.box(['k', 3]).evaluate().symbol).toBe('Missing');
  });
});

describe('`Partition`: a maybe-absent size is admitted', () => {
  test('box route: a present size partitions', () => {
    const ce = engineWithPiecewise();
    const expr = ce.box(['Partition', ['List', 1, 2, 3, 4], ['k', 0]]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('[[1,2],[3,4]]');
  });

  test('parse route: a present size partitions', () => {
    const ce = engineWithPiecewise();
    const expr = ce.parse(
      '\\operatorname{Partition}(\\lbrack 1,2,3,4\\rbrack, k(0))'
    );
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('[[1,2],[3,4]]');
  });

  test('box route: an absent size errors at evaluation, not at boxing', () => {
    const ce = engineWithPiecewise();
    const expr = ce.box(['Partition', ['List', 1, 2, 3, 4], ['k', 3]]);
    expect(expr.isValid).toBe(true);
    // The same wording `Chunk` answers for an absent size.
    expect(expr.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "missing"), "Missing")'
    );
  });

  test('parse route: an absent size errors at evaluation', () => {
    const ce = engineWithPiecewise();
    const expr = ce.parse(
      '\\operatorname{Partition}(\\lbrack 1,2,3,4\\rbrack, k(3))'
    );
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "missing"), "Missing")'
    );
  });

  test('a proven `Missing` written in the source is still refused at boxing', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Partition', ['List', 1, 2, 3, 4], 'Missing']).isValid).toBe(
      false
    );
  });

  test('a string size is still refused at boxing', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Partition', ['List', 1, 2, 3, 4], { str: 'ab' }]);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain('incompatible-type');
  });

  test('the two present forms are unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Partition', ['List', 1, 2, 3, 4], 2])
        .evaluate()
        .toString()
    ).toBe('[[1,2],[3,4]]');
    expect(
      ce
        .box([
          'Partition',
          ['List', 1, 2, 3, 4],
          ['Function', ['Less', 'x', 3], 'x'],
        ])
        .evaluate()
        .toString()
    ).toBe('[[1,2],[3,4]]');
  });
});

describe('the single-arm siblings agree, before and after', () => {
  // These operators declare a plain numeric size parameter and were never
  // affected; they are the behavior `Partition` is aligned with.
  test.each(['Take', 'Drop', 'Chunk', 'SlidingWindow'])(
    '%s admits a maybe-absent size',
    (operator) => {
      const ce = engineWithPiecewise();
      expect(ce.box([operator, ['List', 1, 2, 3, 4], ['k', 0]]).isValid).toBe(
        true
      );
    }
  );

  test('`Chunk` answers `incompatible-type` for an absent size', () => {
    const ce = engineWithPiecewise();
    expect(
      ce
        .box(['Chunk', ['List', 1, 2, 3, 4], ['k', 3]])
        .evaluate()
        .toString()
    ).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "missing"), "Missing")'
    );
  });
});

describe('the admission is a property of the SIGNATURE, not of `Partition`', () => {
  test('a user function with the same parameter shape admits it too', () => {
    const ce = engineWithPiecewise();
    ce.declare(
      'sizeOrPred',
      '(list<number>, integer | ((number) -> boolean)) -> number'
    );
    expect(ce.box(['sizeOrPred', ['List', 1, 2, 3], ['k', 0]]).isValid).toBe(
      true
    );
    // A non-numeric operand overlaps neither arm and is still refused.
    expect(
      ce.box(['sizeOrPred', ['List', 1, 2, 3], { str: 'ab' }]).isValid
    ).toBe(false);
  });

  test('a callable-plus-NON-numeric union is untouched', () => {
    // Only numeric value arms qualify: a union whose other arm polices a
    // different shape keeps the strict reading.
    const ce = engineWithPiecewise();
    ce.declare(
      'fnOrString',
      '(list<number>, string | ((number) -> boolean)) -> number'
    );
    expect(ce.box(['fnOrString', ['List', 1, 2, 3], ['k', 0]]).isValid).toBe(
      false
    );
  });
});

describe('a settled non-integer size is a type error, as for `Chunk`', () => {
  test('a call that evaluates to 1.5 is not rounded to a size of 2', () => {
    const ce = new ComputeEngine();
    ce.parse('h(t) := t/2').evaluate();
    const partition = ce.box(['Partition', ['List', 1, 2, 3, 4], ['h', 3]]);
    const chunk = ce.box(['Chunk', ['List', 1, 2, 3, 4], ['h', 3]]);
    const p = partition.evaluate();
    const c = chunk.evaluate();
    expect(p.operator).toBe('Error');
    expect(c.operator).toBe('Error');
    expect(JSON.stringify(p.json)).toContain('incompatible-type');
    expect(JSON.stringify(p.json)).toContain("'integer'");
  });
});
