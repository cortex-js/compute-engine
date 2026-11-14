import { ComputeEngine } from '../../src/compute-engine';
import { checkEpsil } from '../../src/epsil/check-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A `static-type-error` diagnostic carries the engine error code in its
// `code` field, so a host can tell one static error from another without
// reading the message. The diagnostic of a read of a local before its
// declaration (`read-before-declaration`) has the range of the name that is
// read, not of the whole statement.
//

/** The `code` of each diagnostic and the source text at its range. */
function check(source: string): [string | undefined, string][] {
  return checkEpsil(new ComputeEngine(), source).diagnostics.map((d) => [
    d.code,
    source.slice(d.range[0], d.range[1]),
  ]);
}

describe('THE CODE OF A STATIC ERROR', () => {
  test('An assignment to an undeclared name', () => {
    const source = 'let a = 1\nx1 = 2\n';
    const [d] = checkEpsil(new ComputeEngine(), source).diagnostics;
    expect(d.message[0]).toBe('static-type-error');
    expect(d.code).toBe('assignment-to-undeclared-variable');
    expect(source.slice(d.range[0], d.range[1])).toBe('x1 = 2');
  });

  test('An assignment to a constant', () =>
    expect(check('const c = 1\nc = 2\n')).toEqual([
      ['constant-assignment', 'c = 2'],
    ]));

  test('A diagnostic other than a static error has no code field', () => {
    const [d] = checkEpsil(new ComputeEngine(), 'let a = (1').diagnostics;
    expect(d.message[0]).not.toBe('static-type-error');
    expect(d.code).toBeUndefined();
  });
});

describe('A READ BEFORE A DECLARATION HAS THE RANGE OF THE NAME', () => {
  test('At the top level', () =>
    expect(check('let a = b1 + 1\nlet b1 = 2\n')).toEqual([
      ['read-before-declaration', 'b1'],
    ]));

  test('In a block', () =>
    expect(check('let a = do { let c = k + 1; let k = 2; c }\n')).toEqual([
      ['read-before-declaration', 'k'],
    ]));

  test('An assignment before the declaration', () =>
    expect(check('do { k = 5; let k = 2 }\n')).toEqual([
      ['read-before-declaration', 'k'],
    ]));

  test('A call of a local has the range of its name', () =>
    expect(check('let a = do { let c = h(1); let h = (x) => x; c }\n')).toEqual(
      [['read-before-declaration', 'h']]
    ));

  test('Each statement that reads the name is reported', () =>
    expect(
      check('do { let a = k + 1; let b = 2 * k; let k = 2; a }\n')
    ).toEqual([
      ['read-before-declaration', 'k'],
      ['read-before-declaration', 'k'],
    ]));

  test('The run reports the same diagnostic once', () => {
    const source = 'let a = b1 + 1\nlet b1 = 2\n';
    const { diagnostics } = executeEpsil(new ComputeEngine(), source);
    expect(
      diagnostics.map((d) => [d.code, source.slice(d.range[0], d.range[1])])
    ).toEqual([['read-before-declaration', 'b1']]);
  });
});
