import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// CE-1838: a named call of a library overload set whose arms are generic
// (`Slice`: `(value: T, start: number, end: number) -> T where T: string`
// and the `indexed_collection<T>` arm, each with a `span: range` twin). The
// names eliminate the twins, and the surviving arms are selected as for a
// positional call: by the value.

function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return {
    codes: r.diagnostics.map((d) => d.code),
    value: r.value?.toString(),
  };
}

describe('CE-1838: a named call of a generic overload set', () => {
  test('the witness: `start` and `end` by name on a list', () => {
    expect(run('slice([1, 2, 3, 4, 5], start: 2, end: 4)')).toEqual({
      codes: [],
      value: '[2,3,4]',
    });
  });

  test('the names in the other order', () => {
    expect(run('slice([1, 2, 3, 4, 5], end: 4, start: 2)')).toEqual({
      codes: [],
      value: '[2,3,4]',
    });
  });

  test('the string arm', () => {
    expect(run('slice("abcde", start: 2, end: 4)')).toEqual({
      codes: [],
      value: '"bcd"',
    });
  });

  test('the `span` arm by name', () => {
    expect(run('slice([1, 2, 3, 4, 5], span: 2..4)')).toEqual({
      codes: [],
      value: '[2,3,4]',
    });
  });

  test('every argument by name', () => {
    expect(run('slice(value: [1, 2, 3, 4, 5], start: 2, end: 4)')).toEqual({
      codes: [],
      value: '[2,3,4]',
    });
  });

  test('a value that no surviving arm admits is a type error', () => {
    expect(run('slice(5, start: 2, end: 4)').codes).toEqual([
      'incompatible-type',
    ]);
  });
});
