import { ComputeEngine } from '../../src/compute-engine';
import { checkEpsil } from '../../src/epsil/check-epsil';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';

//
// CE-1682: the domain of a `for` loop or a comprehension that cannot be a
// collection (a number, a boolean, a function). The static check reports
// `incompatible-type` when the static type of the domain is disjoint from
// `collection`. At run time, a loop whose domain has such a value stops on
// the `incompatible-type` error, the error that a comprehension gives. Before,
// the loop ran no iteration and reported nothing.
//

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.iterationLimit = 200;
  return ce;
}

function messages(diagnostics: { message: unknown }[]): string[] {
  return diagnostics.map((d) =>
    Array.isArray(d.message) ? d.message.join(' | ') : String(d.message)
  );
}

function check(source: string): string[] {
  return messages(checkEpsil(engine(), source).diagnostics);
}

function run(source: string): { value: string; diagnostics: string[] } {
  const r = executeEpsil(engine(), source);
  return { value: r.value.toString(), diagnostics: messages(r.diagnostics) };
}

describe('CE-1682: the static check of the domain of a loop', () => {
  test('a loop over a number is incompatible-type', () => {
    expect(check('let n = 5\nlet t = 0\nfor i in n { t = t + i }\nt')).toEqual([
      'static-type-error | expected `collection`, got `number` at `n` | i in n | incompatible-type',
    ]);
  });

  test('a loop over a boolean is incompatible-type', () => {
    expect(check('for i in true { print(i) }')).toEqual([
      'static-type-error | expected `collection`, got `boolean` at `True` | i in True | incompatible-type',
    ]);
  });

  test('a comprehension over a number is incompatible-type', () => {
    expect(check('let n = 5\n[i for i in n]')).toEqual([
      'static-type-error | expected `collection`, got `number` at `n` | i in n | incompatible-type',
    ]);
  });

  test('the diagnostic has no note on the signature of Element', () => {
    const [d] = checkEpsil(engine(), 'for i in true { print(i) }').diagnostics;
    expect(d.notes).toBeUndefined();
  });

  test('a loop over a list, a string, a range or an unknown name is not reported', () => {
    expect(check('let t = 0\nfor i in [1, 2] { t = t + i }\nt')).toEqual([]);
    expect(check('for c in "ab" { print(c) }')).toEqual([]);
    expect(
      check('let n = 3\nlet t = 0\nfor i in 1..n { t = t + i }\nt')
    ).toEqual([]);
    expect(check('let x: any = [1]\nfor i in x { print(i) }')).toEqual([]);
  });
});

describe('CE-1682: the run of a loop over a value that is not a collection', () => {
  test('a loop over a number of static type any stops on the error', () => {
    expect(run('let x: any = 5\nfor i in x { print(i) }\n"after"')).toEqual({
      value: '"after"',
      diagnostics: [
        'runtime-error | expected `collection`, got `5` at `5` |  | incompatible-type',
      ],
    });
  });

  test('a loop over a function value stops on the error', () => {
    const ce = engine();
    const value = ce
      .box([
        'Block',
        ['Declare', 'x', 'any'],
        ['Assign', 'x', ['Function', 'y', 'y']],
        ['Loop', ['Print', 'i'], ['Element', 'i', 'x']],
      ])
      .evaluate();
    expect(value.operator).toBe('Error');
    expect(value.toString()).toMatch(/incompatible-type", "collection"/);
  });

  test('the loop and the comprehension give the same error', () => {
    const ce = engine();
    const program = (term: unknown) =>
      ce
        .box([
          'Block',
          ['Declare', 'x', 'any'],
          ['Assign', 'x', 5],
          term as never,
        ])
        .evaluate()
        .toString();
    const loop = program(['Loop', 'i', ['Element', 'i', 'x']]);
    expect(loop).toBe(
      'Error(ErrorCode("incompatible-type", "collection", "5"), 5)'
    );
    expect(program(['Comprehension', 'i', ['Element', 'i', 'x']])).toBe(loop);
  });

  test('the asynchronous run reports the same error', async () => {
    const r = await executeEpsilAsync(
      engine(),
      'let x: any = 5\nfor i in x { print(i) }\n"after"'
    );
    expect(messages(r.diagnostics)).toEqual([
      'runtime-error | expected `collection`, got `5` at `5` |  | incompatible-type',
    ]);
  });

  test('a loop over an unknown name or a range with an unknown bound runs no iteration', () => {
    const ce = engine();
    expect(
      ce
        .box(['Loop', ['Print', 'i'], ['Element', 'i', ['Range', 1, 'm']]])
        .evaluate()
        .toString()
    ).toBe('"Nothing"');
    expect(
      ce
        .box(['Loop', ['Print', 'i'], ['Element', 'i', 'u']])
        .evaluate()
        .toString()
    ).toBe('"Nothing"');
  });

  test('the canonical form does not read the value of a symbol that is reassigned later', () => {
    const ce = engine();
    ce.declare('s', 'integer');
    ce.assign('s', 0);
    ce.assign('y', 5);
    const loop = ce.box(['Loop', ['AddTo', 's', 'i'], ['Element', 'i', 'y']]);
    expect(loop.isValid).toBe(true);
    expect(loop.evaluate().operator).toBe('Error');
    ce.assign('y', ['List', 1, 2]);
    loop.evaluate();
    expect(ce.box('s').evaluate().toString()).toBe('3');
  });

  test('a domain that holds a symbol with an inferred type is not refused by the canonical form', () => {
    const ce = engine();
    ce.assign('y', 5);
    expect(
      ce.box(['Loop', ['Print', 'i'], ['Element', 'i', ['Negate', 'y']]])
        .isValid
    ).toBe(true);
  });

  test('a loop over Missing runs no iteration', () => {
    const ce = engine();
    const loop = ce.box(['Loop', ['Print', 'i'], ['Element', 'i', 'Missing']]);
    expect(loop.isValid).toBe(true);
    expect(loop.evaluate().toString()).toBe('"Nothing"');
  });

  test('a ParallelLoop over a number stops on the error', () => {
    const ce = engine();
    const value = ce
      .box([
        'Block',
        ['Declare', 'x', 'any'],
        ['Assign', 'x', 5],
        ['ParallelLoop', ['Print', 'i'], ['Element', 'i', 'x']],
      ])
      .evaluate();
    expect(value.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "collection", "5"), 5)'
    );
  });

  test('a guarded clause over a number is refused', () => {
    const ce = engine();
    expect(
      ce.box(['Loop', ['Print', 'i'], ['Element', 'i', 5, 'True']]).isValid
    ).toBe(false);
    const value = ce
      .box([
        'Block',
        ['Declare', 'x', 'any'],
        ['Assign', 'x', 5],
        ['Loop', ['Print', 'i'], ['Element', 'i', 'x', 'True']],
      ])
      .evaluate();
    expect(value.operator).toBe('Error');
  });
});
