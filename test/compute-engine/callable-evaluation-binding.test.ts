import { validateArguments } from '../../src/compute-engine/boxed-expression/validate';
import { parseType } from '../../src/common/type/parse';
import { ComputeEngine } from '../../src/compute-engine';
import { apply } from '../../src/compute-engine/function-utils';

describe('callable evaluation follows lexical binding', () => {
  test.each(['value', 'operator'] as const)(
    '%s declarations agree across eager and lazy calls',
    async (kind) => {
      for (const jit of ['off', 'auto'] as const) {
        const ce = new ComputeEngine();
        ce.jit = jit;
        ce.pushScope();
        if (kind === 'value') ce.declare('h', '(real) -> string');
        ce.assign('h', ce.box(['Function', "'local'", 'u']));
        const direct = ce.box(['h', 1]);
        const lambda = ce.box(['Function', ['h', 'x'], 'x']);
        const bare = ce.box(['Map', 'h', ['List', 1, 2]]);
        const wrapped = ce.box(['Map', lambda, ['List', 1, 2]]);
        const eager = ce.box([
          'Reduce',
          ['List', 1, 2],
          ['Function', ['h', 'x'], 'a', 'x'],
          "''",
        ]);
        ce.popScope();
        ce.assign('h', ce.box(['Function', 9, 'u']));
        expect(direct.type.toString()).toBe('string');
        expect(direct.evaluate().json).toBe("'local'");
        expect((await direct.evaluateAsync()).json).toBe("'local'");
        expect(apply(lambda, [ce.number(1)]).json).toBe("'local'");
        expect(eager.evaluate().json).toBe("'local'");
        for (const view of [bare, wrapped]) {
          expect(view.type.toString()).toBe('list<string^2>');
          expect(view.at(1)?.json).toBe("'local'");
          expect([...view.each()].map((x) => x.json)).toEqual([
            "'local'",
            "'local'",
          ]);
          const listed = ce.box(['ListFrom', view]);
          expect(listed.evaluate().json).toEqual([
            'List',
            "'local'",
            "'local'",
          ]);
          expect((await listed.evaluateAsync()).json).toEqual([
            'List',
            "'local'",
            "'local'",
          ]);
        }
      }
    }
  );

  test('updates to the original binding remain visible through cached views', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', 1, 'u']));
    const direct = ce.box(['h', 0]);
    const bare = ce.box(['Map', 'h', ['List', 1, 2]]);
    const wrapped = ce.box([
      'Map',
      ['Function', ['h', 'x'], 'x'],
      ['List', 1, 2],
    ]);
    for (const result of [1, 7]) {
      ce.assign('h', ce.box(['Function', result, 'u']));
      expect(direct.evaluate().json).toBe(result);
      for (const view of [bare, wrapped]) {
        expect(view.at(1)?.json).toBe(result);
        expect(ce.box(['ListFrom', view]).evaluate().json).toEqual([
          'List',
          result,
          result,
        ]);
      }
    }
    ce.pushScope();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', 9, 'u']));
    expect(direct.evaluate().json).toBe(7);
    expect(bare.at(1)?.json).toBe(7);
    expect(wrapped.at(1)?.json).toBe(7);
    ce.popScope();
  });

  test('forward calls resolve in their original lexical environment', async () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['g', 'x'], 'x']);
    ce.assign('g', ce.box(['Function', ['Tuple', 'u', 'u'], 'u']));
    ce.pushScope();
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', "'shadow'", 'u']));
    const view = ce.box(['Map', literal, ['List', 1, 2]]);
    expect(view.type.toString()).toBe('list<tuple<integer, integer>^2>');
    expect(ce.box(['ListFrom', view]).evaluate().json).toEqual([
      'List',
      ['Tuple', 1, 1],
      ['Tuple', 2, 2],
    ]);
    expect((await ce.box(['ListFrom', view]).evaluateAsync()).json).toEqual([
      'List',
      ['Tuple', 1, 1],
      ['Tuple', 2, 2],
    ]);
    ce.popScope();
  });

  test('an unresolved forward call never borrows an unrelated shadow', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['g', 'x'], 'x']);
    ce.pushScope();
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', 9, 'u']));
    expect(apply(literal, [ce.number(1)]).json).toEqual(['g', 1]);
    const view = ce.box(['Map', literal, ['List', 1, 2]]);
    expect(view.type.toString()).toBe('list<unknown^2>');
    ce.popScope();
  });

  test('a bare callback symbol never borrows an unrelated definition', () => {
    // `h` is declared with no value in a scope that is then popped. The
    // symbol keeps that binding, so a later global `h` is another binding
    // and does not run.
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('h', 'function');
    const callback = ce.symbol('h');
    ce.popScope();
    ce.assign('h', ce.box(['Function', ['Multiply', 'u', 100], 'u']));
    expect(apply(callback, [ce.number(1)]).json).toEqual(['h', 1]);
  });

  test('a closure keeps its callback from the creating invocation', async () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'If',
          ['Equal', 'n', 0],
          ['c', 1],
          ['f', ['Function', 9, 'u'], ['Function', ['h', 'x'], 'x'], 0],
        ],
        'h',
        'c',
        'n',
      ])
    );
    const call = ce.box(['f', ['Function', 7, 'u'], ['Function', 0, 'u'], 1]);
    expect(call.evaluate().json).toBe(7);
    expect((await call.evaluateAsync()).json).toBe(7);
  });

  test('a captured operator callback keeps nested broadcast shapes', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('h', {
      signature: '(real) -> real',
      broadcastable: true,
      evaluate: ([x]) => x,
    });
    const view = ce.box(['Map', 'h', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    ce.popScope();
    ce.assign('h', ce.box(['Function', "'shadow'", 'u']));
    expect(view.type.toString()).toBe('list<vector<real^2>^2>');
    expect(ce.box(['ListFrom', view]).evaluate().json).toEqual([
      'List',
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
  });
});

describe('empty point-list validation', () => {
  test.each(['tuple<real, real>', 'tuple<real, real>?'])(
    'a literal empty list is admitted at %s',
    (parameter) => {
      const ce = new ComputeEngine();
      const signature = parseType(`(integer, ${parameter}) -> integer`);
      const validate = (arg: ReturnType<typeof ce.box>) =>
        validateArguments(
          ce,
          [ce.number(1), arg],
          signature,
          false,
          false,
          undefined,
          undefined,
          { mapsPointLists: true }
        );
      expect(validate(ce.box(['List']))).toBeNull();
      const invalid = validate(ce.box(['List', 1, 2]));
      expect(invalid?.some((x) => !x.isValid)).toBe(true);
    }
  );
});
