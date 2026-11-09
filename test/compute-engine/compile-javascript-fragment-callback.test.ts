import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { MathJsonExpression } from '../../src/math-json/types';

const typed = (name: string, type = 'real'): MathJsonExpression => ['Typed', name, `'${type}'`];
function setup() {
  const ce = new ComputeEngine();
  ce.declare('offset', 'real'); ce.assign('offset', 2);
  ce.declare('helper', '(real) -> real');
  ce.assign('helper', ce.expr(['Function', ['Add', 'u', 'offset'], typed('u')]));
  return ce;
}
const callback: MathJsonExpression = ['Function', ['Block',
  ['Declare', 'total', "'real'", ['helper', 'x']],
  ['Assign', 'total', ['helper', 'total']],
  ['helper', 'total']], typed('x')];

for (const mode of ['strict', 'complex'] as const)
  for (const cse of [false, true])
    for (const constantFold of [false, true]) {
      test(`${mode} CSE=${cse} fold=${constantFold}: helper composes with local writes and capture`, () => {
        const ce = setup();
        const expression = ce.expr(callback);
        const options = { mode, cse, constantFold, fallback: false };
        const legacy = compile(expression, options);
        const target = new ScalarFragmentJavaScriptTarget();
        const result = target.compile(expression, options);
        expect(result.run!(3)).toBe(9);
        expect(result.run!(-5)).toBe(1);
        expect(result.run!(3)).toBe(legacy.run!(3));
        ce.assign('offset', 7);
        expect(result.run!(3)).toBe(9);
        expect(target.compile(expression, options).run!(3)).toBe(24);
      });
      test(`${mode} CSE=${cse} fold=${constantFold}: repeated identical call reads updated local`, () => {
        const ce = setup();
        const expression = ce.expr(['Function', ['Block',
          ['Declare', 'total', "'real'", 'x'],
          ['Assign', 'total', ['helper', 'total']],
          ['Assign', 'total', ['helper', 'total']],
          'total'], typed('x')]);
        const result = new ScalarFragmentJavaScriptTarget().compile(expression, { mode, cse, constantFold });
        expect(result.run!(3)).toBe(7);
        expect(result.run!(0)).toBe(4);
      });
    }

test.each(['offset', 'helper'])('root parameter %s cannot hide helper bindings', name => {
  const ce = setup();
  const expression = ce.expr(['Function', ['Block',
    ['Declare', 'total', "'real'", 0], ['helper', name]], typed(name)]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(expression, { fallback: false })).toThrow();
});

test('root local cannot hide the helper capture', () => {
  const ce = setup();
  const expression = ce.expr(['Function', ['Block',
    ['Declare', 'offset', "'real'", 'x'], ['helper', 'offset']], typed('x')]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(expression)).toThrow();
});

test('direct root capture remains unsupported', () => {
  const ce = setup();
  expect(() => new ScalarFragmentJavaScriptTarget().compile(ce.expr(['Function', ['Block',
    ['Declare', 'total', "'real'", 'offset'], ['helper', 'total']], typed('x')]))).toThrow(/unsupported capture/);
});

test('helper argument and assigned result representations remain fixed', () => {
  const ce = setup();
  const expression = ce.expr(['Function', ['Block',
    ['Declare', 'total', "'complex'", 'z'], ['helper', 'total']], typed('z', 'complex')]);
  expect(() => new ScalarFragmentJavaScriptTarget().compile(expression)).toThrow();
});

test('complex helper composes with same-shape local writes', () => {
  const ce = new ComputeEngine();
  ce.declare('helper', '(complex) -> complex');
  ce.assign('helper', ce.expr(['Function', ['Negate', 'u'], typed('u', 'complex')]));
  const expression = ce.expr(['Function', ['Block',
    ['Declare', 'total', "'complex'", 'z'],
    ['Assign', 'total', ['helper', 'total']], 'total'], typed('z', 'complex')]);
  for (const mode of ['strict', 'complex'] as const)
    expect(new ScalarFragmentJavaScriptTarget().compile(expression, { mode })
      .run!({ re: 2, im: -3 })).toEqual({ re: -2, im: 3 });
});


test('helper parameter may share a name with the caller local', () => {
  const ce = setup();
  ce.assign('helper', ce.expr(['Function', ['Add', 'total', 'offset'], typed('total')]));
  expect(new ScalarFragmentJavaScriptTarget().compile(ce.expr(callback)).run!(3)).toBe(9);
});

test('root conditional call sites use their enclosing block facts', () => {
  const ce = setup();
  const expression = ce.expr(['Function', ['Block',
    ['Declare', 'total', "'real'", 'x'],
    ['If', 'flag', ['helper', 'total'], ['Negate', ['helper', 'total']]]],
    typed('x'), typed('flag', 'boolean')]);
  const result = new ScalarFragmentJavaScriptTarget().compile(expression);
  expect(result.run!(3, true)).toBe(5);
  expect(result.run!(3, false)).toBe(-5);
});
