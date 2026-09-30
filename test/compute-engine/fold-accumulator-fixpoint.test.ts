/**
 * A fold's BARE accumulator is typed to the fixpoint of its seed and its
 * combiner's result (user decision 2026-09-29, option A of the design
 * question recorded for issue #369; `refineFoldAccumulator` in
 * `library/collections.ts`).
 *
 * The type is INFERRED, not an annotation: the printed literal is unchanged,
 * nothing is enforced at apply time, and a fold whose accumulator's inferred
 * type already says enough (a numeric fold) is not touched.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { canonicalFunctionLiteral } from '../../src/compute-engine/function-utils';
import { parseEpsil } from '../../src/epsil/parse-epsil';

const RANGE = ['Range', 1, ['Length', 'p'], 1];
const BODY = ['Join', 'acc', ['List', ['Multiply', 2, ['At', 'p', 'i']]]];
const FOLD = ['Fold', ['Function', BODY, 'acc', 'i'], ['List'], RANGE];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('p', 'list<integer>');
  ce.assign('p', ce.box(['List', 3, 1, 2]));
  return ce;
}

describe('a list-building fold is typed to the fixpoint of seed and result', () => {
  it('types the fold from the accumulator', () => {
    const ce = engine();
    const fold = ce.box(FOLD as any);
    expect(fold.type.toString()).toBe('list<integer | nan>');
    expect(fold.ops[1].type.toString()).toBe(
      '(acc: list<integer | nan>, i: integer) -> list<integer | nan>'
    );
    expect(fold.evaluate().toString()).toBe('[6,2,4]');
  });

  it('keeps the accumulator bare in the printed literal (an inferred type, not an annotation)', () => {
    const ce = engine();
    const fold = ce.box(FOLD as any);
    expect(fold.ops[1].toMathJson({ inferredAnnotations: true })).toEqual([
      'Function',
      BODY,
      'acc',
      ['Typed', 'i', "'integer'"],
    ]);
  });

  it('a view over the fold is a list on the interpreter, as it is compiled', () => {
    // Before: the fold was typed `collection<any>`, and `Map`/`Filter` over
    // it materialized as a `Set` while the compiled result was an array.
    const ce = engine();
    const mapped = ce.box([
      'Map',
      ['Function', ['Add', 'x', 1], 'x'],
      FOLD,
    ] as any);
    expect(mapped.type.toString()).toBe('list<integer | nan>');
    expect(mapped.evaluate().toString()).toBe('[7,3,5]');
    expect(
      ce
        .box(['Filter', FOLD, ['Function', ['Greater', 'x', 3], 'x']] as any)
        .evaluate()
        .toString()
    ).toBe('[6,4]');
    expect(compile(mapped, { fallback: false }).run!({ p: [3, 1, 2] })).toEqual(
      [7, 3, 5]
    );
  });

  it('types Scan, a seedless fold, an Append fold and a fold of lists the same way', () => {
    const ce = engine();
    expect(
      ce
        .box(['Scan', RANGE, ['Function', BODY, 'acc', 'i'], ['List']] as any)
        .type.toString()
    ).toBe('list<list<integer | nan>>');
    expect(
      ce
        .box([
          'Reduce',
          ['List', ['List', 1], ['List', 2]],
          ['Function', ['Join', 'a', 'x'], 'a', 'x'],
        ] as any)
        .type.toString()
    ).toBe('list<integer>');
    expect(
      ce
        .box([
          'Fold',
          ['Function', ['Append', 'acc', 'i'], 'acc', 'i'],
          ['List'],
          RANGE,
        ] as any)
        .type.toString()
    ).toBe('list<integer>');
    expect(
      ce
        .box([
          'Fold',
          [
            'Function',
            ['Join', 'acc', ['List', ['List', 'i', ['Multiply', 2, 'i']]]],
            'acc',
            'i',
          ],
          ['List'],
          RANGE,
        ] as any)
        .type.toString()
    ).toBe('list<vector<integer^2>>');
  });

  it('leaves a numeric fold as it was (its accumulator already infers a number)', () => {
    const ce = engine();
    const sum = ce.box([
      'Fold',
      ['Function', ['Add', 'acc', 'i'], 'acc', 'i'],
      0,
      RANGE,
    ] as any);
    expect(sum.ops[1].type.toString()).toBe('(unknown, i: integer) -> number');
    expect(sum.evaluate().toString()).toBe('6');
    // The fold tolerance of the Design D audit: an accumulator that changes
    // type mid-fold (1 → 1/2 → 1/6) is not rejected.
    const div = ce.box([
      'Reduce',
      ['List', 1, 2, 3],
      ['Function', ['Divide', 'a', 'x'], 'a', 'x'],
      1,
    ] as any);
    expect(div.evaluate().toString()).toBe('1/6');
  });

  it('keeps the literal as it was when the fixpoint does not settle', () => {
    // `[acc]` nests the list type one level deeper on every step.
    const ce = engine();
    const fold = ce.box([
      'Fold',
      ['Function', ['List', 'acc'], 'acc', 'i'],
      ['List'],
      RANGE,
    ] as any);
    expect(fold.ops[1].ops[1].type.toString()).not.toMatch(/^list<list<list/);
    expect(fold.evaluate().toString()).toBe('[[[[]]]]');
  });

  it('leaves a named combiner and a seedless Scan over scalars alone', () => {
    const ce = engine();
    ce.assign('step', ce.box(['Function', BODY, 'acc', 'i'] as any));
    const named = ce.box(['Fold', 'step', ['List'], RANGE] as any);
    expect(named.evaluate().toString()).toBe('[6,2,4]');
    const scan = ce.box([
      'Scan',
      'p',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
    ] as any);
    expect(scan.ops[1].type.toString()).toBe('(unknown, x: integer) -> number');
    expect(scan.evaluate().toString()).toBe('[3,4,6]');
  });

  it('types a seedless Scan that builds lists', () => {
    const ce = engine();
    const scan = ce.box([
      'Scan',
      ['List', ['List', 1], ['List', 2], ['List', 3]],
      ['Function', ['Join', 'a', 'x'], 'a', 'x'],
    ] as any);
    expect(scan.type.toString()).toBe('list<list<integer>^3>');
    expect(scan.evaluate().toString()).toBe('[[1],[1,2],[1,2,3]]');
  });

  it('leaves an annotated accumulator alone', () => {
    const ce = engine();
    const fold = ce.box([
      'Fold',
      ['Function', BODY, ['Typed', 'acc', 'list<integer>'], 'i'],
      ['List'],
      RANGE,
    ] as any);
    expect(fold.ops[1].type.toString()).toBe(
      '(acc: list<integer>, i: integer) -> list<integer | nan>'
    );
  });

  it('an inferred parameter type is not enforced at apply time', () => {
    // The mechanism the fixpoint relies on: a bare parameter pre-declared
    // with an inferred type accepts a value outside that type, where an
    // annotated one reports an error.
    const ce = new ComputeEngine();
    const raw = ce.box(['Function', ['Add', 'a', 1], 'a'] as any, {
      form: 'raw',
    });
    const inferred = canonicalFunctionLiteral(raw, {
      inferredParamTypes: new Map([['a', 'integer' as const]]),
    })!;
    // The literal's printed signature keeps a scalar bare parameter as
    // `unknown` (an existing rule of `functionLiteralSignatureType`); the
    // binding itself carries the hint, as an inferred type.
    expect(inferred.ops[1].type.toString()).toBe('integer');
    expect(inferred.ops[1].valueDefinition?.inferredType).toBe(true);
    expect(inferred.op1.type.toString()).toBe('integer');
    expect(
      ce
        .function('Apply', [inferred, ce.box(2.5)])
        .evaluate()
        .toString()
    ).toBe('3.5');
    const annotated = ce.box([
      'Function',
      ['Add', 'a', 1],
      ['Typed', 'a', 'integer'],
    ] as any);
    expect(
      ce
        .function('Apply', [annotated, ce.box(2.5)])
        .evaluate()
        .toString()
    ).toMatch(/Error/);
  });

  it('a block local holding the fold is typed precisely, so its consumers compile statically', () => {
    const ce = engine();
    const program = ce.box(
      parseEpsil(
        'let q = Fold((acc, i) => Join(acc, [2 * p[i]]), [], 1..Length(p))\nLength(q) + q[1]'
      )[0]
    );
    expect(program.evaluate().toString()).toBe('9');
    const r = compile(program, { fallback: false });
    expect(r.run!({ p: [3, 1, 2] })).toBe(9);
    expect(r.code).not.toContain('_SYS.arr');
  });
});
