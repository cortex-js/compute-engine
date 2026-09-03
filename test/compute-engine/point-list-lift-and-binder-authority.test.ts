import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Two residues of the Tycho 245/246 round (fixed 2026-09-03).
 *
 * 1. A scalar function lifted over a LIST OF POINTS keeps the point shape in
 *    its type: `Sqrt(P)` for `P: list<tuple<number, number>>` is
 *    `list<tuple<number, number>>`, as its value is a list of points. The
 *    lift used to re-wrap the per-component result as `list<number>`.
 *
 * 2. A comprehension binder's type comes from its binding site and is
 *    AUTHORITATIVE (ruled 2026-09-03): a body use that contradicts the
 *    source's element type is a type error, as it is anywhere else. The
 *    binder used to be retyped to `matrix` by the fresh-matrix repair in
 *    validation, so `[q.x + 1 for q in L]` boxed valid and failed only when
 *    evaluated.
 */

describe('a scalar function over a list of points keeps the point shape in its type', () => {
  const ce = new ComputeEngine();
  ce.declare('P', 'list<tuple<number, number>>');
  ce.declare('Q', 'list<tuple<integer, integer, integer>>');
  ce.declare('L', 'list<number>');

  test.each([
    ['Sqrt', ['Sqrt', 'P']],
    ['Sin', ['Sin', 'P']],
    ['Exp', ['Exp', 'P']],
    ['Power', ['Power', 'P', 2]],
  ])('%s(P) types list<tuple<number, number>>', (_h, json) => {
    expect(ce.box(json as never).type.toString()).toBe(
      'list<tuple<number, number>>'
    );
  });

  test('the arity follows the point: a list of triples', () => {
    expect(ce.box(['Sqrt', 'Q'] as never).type.toString()).toBe(
      'list<tuple<number, number, number>>'
    );
  });

  test('the value agrees: a list of points, one per element', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('P', ce2.box(['List', ['Tuple', 1, 4], ['Tuple', 9, 16]]));
    const e = ce2.box(['Sqrt', 'P']);
    // A literal value carries its length: `list<tuple<number, number>^2>`.
    expect(e.type.matches('list<tuple<number, number>>')).toBe(true);
    expect(e.type.toString()).toBe('list<tuple<number, number>^2>');
    expect(e.evaluate().json).toEqual([
      'List',
      ['Tuple', 1, 2],
      ['Tuple', 3, 4],
    ]);
  });

  test('a whole-point head keeps its scalar cell: Abs of a point is its norm', () => {
    expect(ce.box(['Abs', 'P'] as never).type.matches('list<number>')).toBe(
      true
    );
    expect(ce.box(['Abs', 'P'] as never).type.toString()).not.toContain(
      'tuple'
    );
  });

  test('a list of scalars is untouched', () => {
    expect(ce.box(['Sqrt', 'L'] as never).type.toString()).toBe(
      'list<number>'
    );
  });

  test('a point list zipped with a list of scalars is a list of points', () => {
    // `Power(P, E)` pairs each point with a scalar exponent: a scalar-element
    // sibling imposes no inner shape.
    ce.declare('E', 'list<number>');
    expect(ce.box(['Power', 'P', 'E'] as never).type.toString()).toBe(
      'list<tuple<number, number>>'
    );
    const ce2 = new ComputeEngine();
    ce2.assign('P', ce2.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    ce2.assign('E', ce2.box(['List', 2, 3]));
    expect(ce2.box(['Power', 'P', 'E'] as never).evaluate().json).toEqual([
      'List',
      ['Tuple', 1, 4],
      ['Tuple', 27, 64],
    ]);
  });

  test('dimensions and rank are kept: a fixed-length or rank-2 collection of points', () => {
    ce.declare('F', 'list<tuple<number, number>^3>');
    ce.declare('M', 'list<list<tuple<number, number>>>');
    expect(ce.box(['Sqrt', 'F'] as never).type.toString()).toBe(
      'list<tuple<number, number>^3>'
    );
    expect(ce.box(['Sqrt', 'M'] as never).type.toString()).toBe(
      'matrix<tuple<number, number>>'
    );
    const ce2 = new ComputeEngine();
    ce2.assign(
      'M',
      ce2.box(['List', ['List', ['Tuple', 1, 4]], ['List', ['Tuple', 9, 16]]])
    );
    expect(ce2.box(['Sqrt', 'M'] as never).evaluate().json).toEqual([
      'List',
      ['List', ['Tuple', 1, 2]],
      ['List', ['Tuple', 3, 4]],
    ]);
  });

  test('a union of point lists of one arity qualifies', () => {
    ce.declare(
      'U',
      'list<tuple<number, number>> | list<tuple<integer, integer>>'
    );
    expect(ce.box(['Sqrt', 'U'] as never).type.toString()).toBe(
      'list<tuple<number, number>>'
    );
  });

  test('a component that could be a collection declines the point shape', () => {
    // `number | list<number>` may be a list at run time, and the tuple would
    // then hold a collection component the claimed type does not admit; the
    // lift keeps its scalar-cell answer for such a list.
    ce.declare('X', 'list<tuple<number, number | list<number>>>');
    expect(ce.box(['Sqrt', 'X'] as never).type.toString()).not.toContain(
      'tuple'
    );
  });

  test('the JavaScript target reads the lifted result as a point list', () => {
    // `PointX` over `Sqrt(P)`: with the old `list<number>` type the lowering
    // read the operand as a flat list and indexed its first element.
    const r = compile(ce.box(['PointX', ['Sqrt', 'P']] as never), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    expect(
      r.run({
        P: [
          [1, 4],
          [9, 16],
        ],
      })
    ).toEqual([1, 3]);
  });
});

describe('a comprehension binder is typed by its binding site, authoritatively', () => {
  const ce = new ComputeEngine();
  ce.declare('C', 'tuple<number, number>');
  ce.declare('L', 'list<number>');
  ce.declare('P', 'list<tuple<number, number>>');

  test('a body use that contradicts the element type is a type error', () => {
    for (const source of ['C', 'L']) {
      const e = ce.box([
        'Comprehension',
        ['Add', ['PointX', 'q'], 1],
        ['Element', 'q', source],
      ] as never);
      expect(e.isValid).toBe(false);
      // The binder keeps the element type; it is not rewritten to `matrix`.
      expect(e.ops![1].ops![0].type.toString()).toBe('number');
    }
  });

  test('a body use compatible with the element type keeps the form valid', () => {
    const scalar = ce.box([
      'Comprehension',
      ['Add', 'q', 1],
      ['Element', 'q', 'C'],
    ] as never);
    expect(scalar.isValid).toBe(true);
    expect(scalar.ops![1].ops![0].type.toString()).toBe('number');
    const point = ce.box([
      'Comprehension',
      ['Add', ['PointX', 'q'], 1],
      ['Element', 'q', 'P'],
    ] as never);
    expect(point.isValid).toBe(true);
    expect(point.ops![1].ops![0].type.toString()).toBe(
      'tuple<number, number>'
    );
  });

  test('the evaluated form agrees with the static verdict', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('C', ce2.box(['Tuple', 5, 7]));
    // A comprehension evaluates to a LAZY collection; materialize it.
    expect(
      ce2
        .box(['Comprehension', ['Add', 'q', 1], ['Element', 'q', 'C']] as never)
        .evaluate({ materialization: true }).json
    ).toEqual(['List', 6, 8]);
  });

  test('the removal from the fresh-inference set composes with a rollback frame', () => {
    // A rollback frame journals every inference-driven engine mutation and
    // undoes them all, last write first, when it closes. Inside the frame the
    // element-type write adds the binder to the fresh-inference set and the
    // binding-site rule removes it again; each records its own undo. After
    // the rollback the set is as it was before the frame — the binder was
    // created inside it, so it is absent — which holds only if the removal's
    // undo (re-add) ran before the write's undo (delete). An unjournaled
    // removal would leave the same final state here by accident, so the
    // in-frame state is pinned too.
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<number>');
    ce2._withBoxingPassWindow(() => {
      let def: unknown;
      ce2._withRolledBackInference(() => {
        const e = ce2.box([
          'Comprehension',
          ['Add', 'q', 1],
          ['Element', 'q', 'L'],
        ] as never);
        def = e.ops![1].ops![0].valueDefinition;
        expect(def).toBeDefined();
        expect(ce2._freshlyInferred?.has(def as never)).toBe(false);
      });
      expect(ce2._freshlyInferred?.has(def as never) ?? false).toBe(false);
    });
  });

  test('the fresh-matrix repair still applies to a genuinely guessed symbol', () => {
    // `a · M` with `a` undeclared: the scalar fast path guesses `real` for
    // `a`, and the matrix-consuming context repairs it. Unaffected by the
    // binder rule.
    const ce2 = new ComputeEngine();
    ce2.declare('M', 'matrix');
    const e = ce2.box(['Determinant', ['Multiply', 'a', 'M']] as never);
    expect(e.isValid).toBe(true);
  });
});
