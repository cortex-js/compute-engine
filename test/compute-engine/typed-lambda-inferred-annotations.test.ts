import { ComputeEngine } from '../../src/compute-engine';

/**
 * A parameter annotation that INFERENCE wrote is not printed.
 *
 * Per-application element-type inference rewrites the callback literal of
 * `Filter(C, Z ↦ …)` with `["Typed", "Z", "'integer'"]` when `C` is a list
 * of integers (`annotateFunctionLiteralParams`, `function-utils.ts`), so the
 * body scope types `Z` and a call checks its argument. Since the typed-lambda
 * LaTeX notation landed, that inferred node printed as the written
 * `(Z\colon integer)\mapsto …`, and the printed form of one expression
 * depended on what else the engine had bound (ruled 2026-09-05: an
 * annotation marks a contract the author CHOSE). The inferred node is now
 * marked (`isInferredTypedParameter`) and left out of `.json` and `.latex`,
 * while the typing, the call-time check and every internal reader of the
 * node are unchanged.
 */

const LAMBDA = 'Z\\mapsto 0<\\left|Z\\right|';
const FILTER = `\\operatorname{Filter}\\left(C, ${LAMBDA}\\right)`;

describe('inferred parameter annotations are not printed', () => {
  test('the annotation is available on request', () => {
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3\\right]'));
    const e = ce.parse(FILTER);
    expect(e.toMathJson({ inferredAnnotations: true })).toEqual([
      'Filter',
      'C',
      ['Function', ['Less', 0, ['Abs', 'Z']], ['Typed', 'Z', "'integer'"]],
    ]);
  });

  test('the bound and the unbound engine print the same LaTeX and MathJSON', () => {
    const bare = new ComputeEngine();
    const bound = new ComputeEngine();
    bound.assign('C', bound.parse('\\left[1,2,3\\right]'));
    const e = bound.parse(FILTER);
    expect(e.latex).toBe(bare.parse(FILTER).latex);
    expect(e.latex).toBe('\\mathrm{Filter}(C, Z\\mapsto0\\lt\\vert Z\\vert)');
    expect(e.json).toEqual([
      'Filter',
      'C',
      ['Function', ['Block', ['Less', 0, ['Abs', 'Z']]], 'Z'],
    ]);
    expect(e.toMathJson({ prettify: false })).toEqual(e.json);
  });

  test('the inference itself is unchanged: the parameter is typed and checked', () => {
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3\\right]'));
    const e = ce.parse(FILTER);
    const lambda = e.ops![1];
    expect(lambda.type.toString()).toBe('(Z: integer) -> boolean');
    expect(lambda.ops![1].operator).toBe('Typed');
    expect(e.evaluate().toString()).toBe('[1,2,3]');
    // A violated inferred type is still refused at the call.
    const applied = ce.box(['Apply', lambda, "'abc'"]).evaluate();
    expect(applied.isValid).toBe(false);
  });

  test('re-boxing the printed form is stable', () => {
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3\\right]'));
    const e = ce.parse(FILTER);
    expect(ce.box(e.json).latex).toBe(e.latex);
    expect(ce.parse(e.latex).json).toEqual(e.json);
  });

  test('a written annotation is printed, beside an inferred one that is not', () => {
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3\\right]'));
    const written = ce.parse(
      '\\operatorname{Filter}\\left(C, (Z\\colon integer)\\mapsto 0<\\left|Z\\right|\\right)'
    );
    expect(written.latex).toBe(
      '\\mathrm{Filter}(C, (Z\\colon integer)\\mapsto0\\lt\\vert Z\\vert)'
    );
    expect(written.json).toEqual([
      'Filter',
      'C',
      [
        'Function',
        ['Block', ['Less', 0, ['Abs', 'Z']]],
        ['Typed', 'Z', "'integer'"],
      ],
    ]);
  });

  test('a self-referencing definition, re-boxed by the engine, keeps the annotation inferred', () => {
    // `assignFn` re-boxes a recursive definition through a structural MathJSON
    // walk (`jsonWithSourceOffsets`); an inferred annotation carried through
    // that walk would come back as a written one.
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3\\right]'));
    ce.parse(
      's(n) := \\operatorname{Filter}\\left(C, Z\\mapsto n<\\left|Z\\right|\\right) + s(n-1)'
    ).evaluate();
    const literal = ce.lookupDefinition('s') as {
      operator?: { _lambdaLiteral?: { latex: string } };
    };
    expect(literal?.operator?._lambdaLiteral?.latex).toBe(
      'n\\mapsto\\mathrm{Filter}(C, Z\\mapsto n\\lt\\vert Z\\vert)+s(n-1)'
    );
  });

  test('the option reaches a callback stored in a dictionary', () => {
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3\\right]'));
    const filter = [
      'Filter',
      'C',
      ['Function', ['Less', 0, ['Abs', 'Z']], 'Z'],
    ];
    const d = ce.box(['Dictionary', ['KeyValuePair', { str: 'f' }, filter]]);
    // A function literal is not plain data, so the dictionary serializes in
    // its `KeyValuePair` form on both routes.
    expect(d.toMathJson()).toEqual([
      'Dictionary',
      [
        'KeyValuePair',
        { str: 'f' },
        [
          'Filter',
          'C',
          ['Function', ['Block', ['Less', 0, ['Abs', 'Z']]], 'Z'],
        ],
      ],
    ]);
    expect(d.toMathJson({ inferredAnnotations: true })).toEqual([
      'Dictionary',
      [
        'KeyValuePair',
        { str: 'f' },
        [
          'Filter',
          'C',
          ['Function', ['Less', 0, ['Abs', 'Z']], ['Typed', 'Z', "'integer'"]],
        ],
      ],
    ]);
  });

  test('the annotations a broadcast over a declared parameter synthesizes are not printed either', () => {
    // A `broadcastable<number>` parameter applied to a large range answers a
    // lazy `Map` whose element function the engine synthesizes with typed
    // `_1` parameters; those annotations are the engine's, not an author's.
    const ce = new ComputeEngine();
    ce.declare('f', '(broadcastable<number>) -> number');
    ce.assign('f', ce.parse('x\\mapsto x+1'));
    const r = ce.box(['f', ['Range', 1, 100000]]).evaluate();
    expect(r.isLazyCollection).toBe(true);
    expect(JSON.stringify(r.json)).not.toContain('Typed');
    expect(
      JSON.stringify(r.toMathJson({ inferredAnnotations: true }))
    ).toContain('["Typed","_1","\'number\'"]');
  });

  test('a shared named literal is never rewritten, so nothing changes for it', () => {
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3\\right]'));
    ce.assign('f', ce.parse(LAMBDA));
    expect(ce.parse('\\operatorname{Filter}\\left(C, f\\right)').latex).toBe(
      '\\mathrm{Filter}(C, f)'
    );
  });
});
