import { ComputeEngine } from '../../src/compute-engine';
import { viewOfExpression } from '../../src/compute-engine/boxed-expression/boxed-function';

// Every evaluation of an application asks whether the operator's declared
// broadcast exemptions (`broadcastExemptions`) stand the generic element-wise
// broadcast down. An operator without exemptions answers "no" without reading
// its operands (the fast option); an operator with exemptions (`Add`,
// `Multiply`, `Equal`, `String`, ...) reads each operand through a lazy view
// (the slow option). These tests pin the broadcast decisions of both options.

const ce = new ComputeEngine({ precision: 'machine' });
ce.parse('f(x):=x^2+1').evaluate();
ce.assign('L', ce.box(['List', 1, 2, 3]));

function ev(json: any): string {
  return ce.box(json).evaluate().toString();
}
function n(json: any): string {
  return ce.box(json).N().toString();
}

describe('BROADCAST CHECK: operator without exemptions', () => {
  test('a scalar call does not broadcast', () => {
    expect(ev(['f', 3])).toBe('10');
    expect(n(['f', 3])).toBe('10');
  });
  test('a call with a list operand broadcasts', () => {
    expect(ev(['f', ['List', 1, 2, 3]])).toBe('[2,5,10]');
    expect(n(['Sin', ['List', 0, 1]])).toBe('[0,0.8414709848078965]');
  });
  test('a symbol whose value is a list broadcasts', () => {
    expect(ev(['f', 'L'])).toBe('[2,5,10]');
  });
  test('an undeclared symbol stays symbolic', () => {
    expect(ev(['f', 'y'])).toBe('y^2 + 1');
  });
  test('vector operators on points do not broadcast', () => {
    expect(ev(['Dot', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]])).toBe('32');
    expect(ev(['Cross', ['Tuple', 1, 0, 0], ['Tuple', 0, 1, 0]])).toBe(
      '(0, 0, 1)'
    );
    expect(ev(['Norm', ['Tuple', 3, 4]])).toBe('5');
  });
});

describe('BROADCAST CHECK: operator with exemptions', () => {
  test('a scalar application does not broadcast', () => {
    expect(ev(['Add', 2, 3])).toBe('5');
    expect(ev(['Add', 'y', 1])).toBe('y + 1');
  });
  test('a list operand broadcasts', () => {
    expect(ev(['Add', 'L', 1])).toBe('[2,3,4]');
    expect(ev(['Add', 'z', ['List', 1, 2]])).toBe('[z + 1,z + 2]');
    expect(ev(['Less', ['List', 1, 2], 3])).toBe('["True","True"]');
  });
  test('tuples are component-wise, not broadcast', () => {
    expect(ev(['Add', ['Tuple', 1, 2], ['Tuple', 3, 4]])).toBe('(4, 6)');
    expect(ev(['Multiply', 2, ['Tuple', 1, 2]])).toBe('(2, 4)');
    expect(ev(['Negate', ['Tuple', 1, 2]])).toBe('(-1, -2)');
    expect(ev(['Subtract', ['Tuple', 5, 7], ['Tuple', 1, 2]])).toBe('(4, 5)');
    expect(ev(['Divide', ['Tuple', 4, 6], 2])).toBe('(2, 3)');
  });
  test('a list of points broadcasts over the points', () => {
    expect(
      ev(['Add', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], ['Tuple', 10, 20]])
    ).toBe('[(11, 22),(13, 24)]');
  });
  test('a matrix product is not element-wise', () => {
    const A = ['List', ['List', 1, 2], ['List', 3, 4]];
    const B = ['List', ['List', 5, 6], ['List', 7, 8]];
    expect(ev(['Multiply', A, B])).toBe('[[19,22],[43,50]]');
    expect(ev(['Add', A, B])).toBe('[[6,8],[10,12]]');
  });
  test('two collections compare whole', () => {
    expect(ev(['Equal', ['List', 1, 2], ['List', 1, 2]])).toBe('"True"');
    expect(ev(['Equal', 'L', ['List', 1, 2, 3]])).toBe('"True"');
  });
  test('a lone collection is joined by String', () => {
    expect(ev(['String', ['List', "'a'", "'b'"]])).toBe('"ab"');
  });
});

describe('BROADCAST CHECK: operand view', () => {
  test('the view reads the operand facts', () => {
    const t = viewOfExpression(ce.box(['Tuple', 1, 2]));
    expect(t.tuple).toBe(true);
    expect(t.isApplication).toBe(true);
    expect(t.isSymbol).toBe(false);
    const s = viewOfExpression(ce.box('L'));
    expect(s.isSymbol).toBe(true);
    expect(s.isCollection).toBe(true);
    expect(s.tuple).toBe(false);
    const m = viewOfExpression(
      ce.box(['List', ['List', 1, 2], ['List', 3, 4]])
    );
    expect(m.tensorShape).toBe(true);
    expect(m.matrixFact).toBe(true);
    expect(m.finiteBroadcastParticipant).toBe(true);
    const x = viewOfExpression(ce.box(3));
    expect(x.isCollection).toBe(false);
    expect(x.textAtom).toBe(false);
    expect(x.typeIsUnknown).toBe(false);
    expect(viewOfExpression(ce.string('a')).textAtom).toBe(true);
  });
});
