import { ComputeEngine } from '../../src/compute-engine';

// `About` reports the documentation metadata of a definition: its examples
// and keywords as lists of strings, and its attributes as a list of flags
// (the algebraic flags, then `lazy`). GitHub issue #398.

const ce = new ComputeEngine();

function about(name: string): Record<string, unknown> {
  const json = ce.box(['About', name]).evaluate().json as {
    dict: Record<string, unknown>;
  };
  return json.dict;
}

describe('ABOUT', () => {
  test('a declared operator keeps and reports its examples and keywords', () => {
    ce.declare('Twice', {
      signature: '(number) -> number',
      description: 'Twice its argument.',
      examples: 'Twice(3)',
      keywords: ['double'],
      evaluate: ([x]) => x.mul(2),
    });
    expect(about('Twice')).toEqual({
      name: 'Twice',
      kind: 'function',
      signature: '(number) -> number',
      description: 'Twice its argument.',
      examples: ['Twice(3)'],
      keywords: ['double'],
    });
  });

  test('a library operator reports its examples and keywords', () => {
    const d = about('Sin');
    expect(d.examples).toEqual(['Sin(Pi / 6)', 'Sin(1)', 'N(Sin(1))']);
    expect(d.keywords).toEqual(['sine']);
  });

  test('a declared symbol keeps and reports its examples and keywords', () => {
    ce.declare('Pt', {
      type: 'real',
      examples: ['Pt + 1'],
      keywords: ['point'],
    });
    const d = about('Pt');
    expect(d.examples).toEqual(['Pt + 1']);
    expect(d.keywords).toEqual(['point']);
    // A library constant.
    expect(about('Pi').examples).toEqual(['N(Pi)', 'Cos(Pi)']);
  });

  test('attributes is a list of the algebraic flags, then lazy', () => {
    expect(about('Add').attributes).toEqual([
      'commutative',
      'associative',
      'idempotent',
      'lazy',
    ]);
    expect(about('Hold').attributes).toEqual(['lazy']);
    // An operator with no flag has no `attributes` entry.
    expect(about('Sin').attributes).toBeUndefined();
  });

  test('the boxed definition stores examples as a list', () => {
    const def = ce.lookupDefinition('Twice');
    expect(def && 'operator' in def && def.operator.examples).toEqual([
      'Twice(3)',
    ]);
  });
});
