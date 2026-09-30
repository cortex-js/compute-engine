/**
 * Two admission rules decided on 2026-09-30.
 *
 * 1. A function literal that annotates SOME of its parameters validates a
 *    call against the annotated slots only. A bare slot, whose type in the
 *    derived signature is inferred from its uses in the body, admits any
 *    argument, as every slot does when nothing is annotated
 *    (`OperatorDefinition._validationSignature`). Before, one annotation
 *    made the whole derived signature a contract.
 *
 * 2. A composite argument whose COMPONENTS are typed `unknown`
 *    (`tuple<unknown, integer>`, `list<tuple<unknown, …>>`) is admitted
 *    provisionally at a declared slot, as a whole argument typed `unknown`
 *    is. A component typed `any` is still refused, and so is a known
 *    component that does not fit.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, parseEpsil, resolveLibraryNames } from '../../src/epsil';

function box(src: string) {
  const [program, diagnostics] = parseEpsil(src);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const ce = new ComputeEngine();
  const expr = ce.box(resolveLibraryNames(program, src, ce));
  return { ce, expr };
}

function errorsIn(expr: any): string[] {
  const out: string[] = [];
  const walk = (e: any) => {
    if (e.operator === 'Error') out.push(e.toString());
    for (const op of e.ops ?? []) walk(op);
  };
  walk(expr);
  return out;
}

function signatureOf(expr: any, name: string): string | undefined {
  let found: string | undefined;
  const walk = (e: any) => {
    if (e.operator === 'DefineFunction' && e.op1.symbol === name)
      found = String(e.op2.type);
    for (const op of e.ops ?? []) walk(op);
  };
  walk(expr);
  return found;
}

const MAYBE_ABSENT =
  'let cands = [(1, 2, 3), (4, 5, 6)]\n' +
  'let C = first(filter(cands, c => c[1] > 2))\n' +
  'const A = (1, 2, 3)\n' +
  'let acc0 = [1]\n';

describe('only the annotated slots of a function literal are a contract', () => {
  test('a maybe-absent argument is admitted at a bare slot beside an annotated one', () => {
    const { expr } = box(
      'function k(p, d, acc: list<number>) { [...acc, p[1] + d] }\n' +
        MAYBE_ABSENT +
        'for gap in [(A, C)] { acc0 = k(gap[2], 1, acc0) }\nacc0'
    );
    expect(errorsIn(expr)).toEqual([]);
    // The reported signature keeps the inferred type of the bare slot.
    expect(signatureOf(expr, 'k')).toBe(
      '(p: indexed_collection<number>, unknown, acc: list<number>) -> list<number>'
    );
    expect(expr.evaluate().toString()).toBe('[1,5]');
  });

  test('an argument that does not fit a bare slot is no longer a static error', () => {
    const { expr } = box('function k(p, n: number) { p[1] + n }\nk(5, 1)');
    expect(signatureOf(expr, 'k')).toBe(
      '(p: indexed_collection<number>, n: number) -> number'
    );
    expect(errorsIn(expr)).toEqual([]);
  });

  test('an annotated slot is still enforced', () => {
    const { expr } = box(
      'function k(p, n: number) { p[1] + n }\nk((1, 2, 3), "a")'
    );
    expect(errorsIn(expr).join(' ')).toMatch(/incompatible-type/);
  });

  test('a fully annotated function enforces every slot', () => {
    const { expr } = box(
      'function k(p: indexed_collection<number>, n: number) { p[1] + n }\nk(5, 1)'
    );
    expect(errorsIn(expr).join(' ')).toMatch(/incompatible-type/);
  });

  test('the assign route with a Function literal follows the same rule', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'k',
      ce.box([
        'Function',
        ['Add', ['At', 'p', 1], 'n'],
        'p',
        ['Typed', 'n', { str: 'number' }],
      ])
    );
    expect(ce.box(['k', 5, 1]).isValid).toBe(true);
    expect(ce.box(['k', ['Tuple', 1, 2], { str: 'a' }]).isValid).toBe(false);
  });

  const partlyAnnotated = (ce: ComputeEngine) =>
    ce.box([
      'Function',
      ['Add', ['At', 'p', 1], 'n'],
      'p',
      ['Typed', 'n', { str: 'number' }],
    ]);

  test('assigning the same literal twice validates as the first assignment', () => {
    const ce = new ComputeEngine();
    ce.assign('k', partlyAnnotated(ce));
    ce.assign('k', partlyAnnotated(ce));
    expect(ce.box(['k', 5, 1]).isValid).toBe(true);
    expect(ce.box(['k', ['Tuple', 1, 2], { str: 'a' }]).isValid).toBe(false);
  });

  test('a fully annotated literal assigned over it enforces every slot again', () => {
    const ce = new ComputeEngine();
    ce.assign('k', partlyAnnotated(ce));
    ce.assign(
      'k',
      ce.box([
        'Function',
        ['Add', ['At', 'p', 1], 'n'],
        ['Typed', 'p', { str: 'indexed_collection<number>' }],
        ['Typed', 'n', { str: 'number' }],
      ])
    );
    expect(ce.box(['k', 5, 1]).isValid).toBe(false);
    expect(ce.box(['k', ['Tuple', 1, 2], 1]).isValid).toBe(true);
  });

  test('a bare slot still narrows an untyped symbol argument', () => {
    const ce = new ComputeEngine();
    ce.assign('k', partlyAnnotated(ce));
    ce.box(['k', 'zs', 1]);
    expect(ce.box('zs').type.toString()).toBe('indexed_collection<number>');
  });

  test('a rest parameter does not turn the bare slots back into contracts', () => {
    const { expr } = box(
      'function k(n: number, p, ...rest) { p[1] + n }\nk(1, 5, 3)'
    );
    expect(signatureOf(expr, 'k')).toBe(
      '(n: number, p: indexed_collection<number>, any*) -> number'
    );
    expect(errorsIn(expr)).toEqual([]);
    const { expr: refused } = box(
      'function k(n: number, p, ...rest) { p[1] + n }\nk("a", (1, 2), 3)'
    );
    expect(errorsIn(refused).join(' ')).toMatch(/incompatible-type/);
  });
});

describe('a declared placeholder slot is not a contract', () => {
  // `(unknown) -> unknown` is what a host writes when it declares a function
  // before its body is known (Tycho's document manager does). The reported
  // signature refines the placeholder from the body, `p[1]` giving
  // `indexed_collection<number>`; that type is inferred, not written by the
  // author, so it refuses nothing, at boxing or at run time.
  const PRESENT = ['First', ['List', ['Tuple', 1, 2]]];
  const ABSENT = ['First', ['List']];

  function declared(signature: string, literal: any): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', signature);
    ce.assign('f', ce.box(literal));
    return ce;
  }

  test('a maybe-absent argument is admitted and the absent value flows into the body', () => {
    const ce = declared('(unknown) -> unknown', [
      'Function',
      ['Add', ['At', 'p', 1], 1],
      'p',
    ]);
    expect(ce.box('f').type.toString()).toBe(
      '(indexed_collection<number>) -> number'
    );
    expect(ce.box(['f', PRESENT]).isValid).toBe(true);
    expect(ce.box(['f', PRESENT]).evaluate().toString()).toBe('2');
    // As the same body does with no declaration.
    expect(ce.box(['f', ABSENT]).evaluate().toString()).toBe('NaN');
    // Assigning the body again lands in the same state.
    ce.assign('f', ce.box(['Function', ['Add', ['At', 'p', 1], 1], 'p']));
    expect(ce.box(['f', PRESENT]).isValid).toBe(true);
    expect(ce.box(['f', ABSENT]).evaluate().toString()).toBe('NaN');
  });

  test('a slot the author typed beside a placeholder is still enforced', () => {
    const ce = declared('(unknown, number) -> unknown', [
      'Function',
      ['Add', ['At', 'p', 1], 'n'],
      'p',
      'n',
    ]);
    expect(ce.box(['f', PRESENT, 1]).isValid).toBe(true);
    expect(ce.box(['f', PRESENT, { str: 'a' }]).isValid).toBe(false);
  });

  test('a list at a placeholder refined to a scalar still maps', () => {
    const ce = declared('(unknown) -> unknown', [
      'Function',
      ['Add', 'x', 1],
      'x',
    ]);
    expect(
      ce
        .box(['f', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[2,3,4]');
  });

  test('a parameter the author declared keeps its contract', () => {
    const ce = declared('(tuple<number, number>) -> unknown', [
      'Function',
      ['Add', ['At', 'p', 1], 1],
      'p',
    ]);
    expect(ce.box(['f', PRESENT]).evaluate().toString()).toBe('2');
    expect(ce.box(['f', { str: 'abc' }]).isValid).toBe(false);
  });
});

describe('an unknown component is admitted at a declared slot', () => {
  test('in a tuple and in the tuple elements of a list, on the ground path', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { signature: '(list<tuple<number, number>>) -> number' });
    ce.declare('t', { signature: '(tuple<number, number>) -> number' });
    ce.declare('L', 'list<tuple<unknown, integer>>');
    ce.declare('P', 'tuple<unknown, integer>');
    expect(ce.box(['k', 'L']).isValid).toBe(true);
    expect(ce.box(['t', 'P']).isValid).toBe(true);
  });

  test('an any component and a known component that does not fit are refused', () => {
    const ce = new ComputeEngine();
    ce.declare('k', { signature: '(list<tuple<number, number>>) -> number' });
    ce.declare('La', 'list<tuple<any, integer>>');
    ce.declare('Ls', 'list<tuple<unknown, string>>');
    expect(ce.box(['k', 'La']).isValid).toBe(false);
    expect(ce.box(['k', 'Ls']).isValid).toBe(false);
  });

  test('a generic signature agrees with the ground one', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(tuple<T>) -> T where T: number' });
    ce.declare('u', 'tuple<unknown>');
    ce.declare('a', 'tuple<any>');
    expect(ce.box(['g', 'u']).isValid).toBe(true);
    expect(ce.box(['g', 'a']).isValid).toBe(false);
  });

  test('a nested unknown does not hide a conflicting bound from another operand', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(tuple<T>, tuple<T>) -> T where T: number' });
    ce.declare('gr', { signature: '(tuple<number>, tuple<number>) -> number' });
    ce.declare('u', 'tuple<unknown>');
    ce.declare('s', 'tuple<string>');
    ce.declare('i', 'tuple<integer>');
    for (const [a, b, admitted] of [
      ['u', 's', false],
      ['u', 'i', true],
      ['u', 'u', true],
      ['i', 's', false],
    ] as const) {
      expect([a, b, ce.box(['g', a, b]).isValid]).toEqual([a, b, admitted]);
      expect([a, b, ce.box(['gr', a, b]).isValid]).toEqual([a, b, admitted]);
    }
    // The concrete operand decides the solution.
    expect(ce.box(['g', 'u', 'i']).type.toString()).toBe('integer');
  });

  test('a union or scalar slot keeps the strict comparison', () => {
    const ce = new ComputeEngine();
    ce.declare('t', { signature: '(tuple<number, number>) -> number' });
    ce.declare('Pu', 'tuple<string | boolean, integer>');
    ce.declare('Pn', 'tuple<tuple<unknown, integer>, integer>');
    ce.declare('tn', {
      signature: '(tuple<tuple<number, number>, number>) -> number',
    });
    expect(ce.box(['t', 'Pu']).isValid).toBe(false);
    // A deeper unknown component defers through a composite slot.
    expect(ce.box(['tn', 'Pn']).isValid).toBe(true);
  });

  test('the interpreter pre-pass accepts a list built from untyped element reads', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'function total(acc: list<tuple<number, number>>) { acc[1][1] + acc[1][2] }\n' +
        'const A = (2, 3)\n' +
        'let pairs = [(A[1], A[2])]\n' +
        'total(pairs)'
    );
    expect(
      (result.diagnostics ?? []).filter((d) => d.severity === 'error')
    ).toEqual([]);
    expect(result.value?.toString()).toBe('5');
  });
});
