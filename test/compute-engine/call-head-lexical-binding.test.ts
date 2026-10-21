import { retainOperatorCallee } from '../../src/compute-engine/boxed-expression/callee-type-derivation';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { typeToString } from '../../src/common/type/serialize';
import {
  deriveApplicationOf,
  describeType,
  describe as describeOperand,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';

describe('call-head inference follows lexical bindings', () => {
  test.each([7, 'Nothing', "'global'"])(
    'a global result %j cannot replace a callback parameter contract',
    (globalResult) => {
      for (const [contract, result, mapped] of [
        ['(real) -> real', 'real', 'vector<real^2>'],
        ['(real) -> any', 'any', 'list<any^2>'],
      ]) {
        const ce = new ComputeEngine();
        ce.assign('h', ce.box(['Function', globalResult, 'u']));
        const direct = ce.box(['Function', ['h', 1], ['Typed', 'h', contract]]);
        expect(direct.type.toString()).toBe(`(h: ${contract}) -> ${result}`);
        const call = direct.op1.op1;
        expect(call.valueDefinition).toBe(direct.ops[1].op1.valueDefinition);
        expect(call.valueDefinition!.type.toString()).toBe(contract);
        const wrapper = ce.box([
          'Function',
          ['Map', ['Function', ['h', 'x'], 'x'], ['List', 1, 2]],
          ['Typed', 'h', contract],
        ]);
        expect(wrapper.type.toString()).toBe(`(h: ${contract}) -> ${mapped}`);
        ce.assign('unrelated', 1);
        expect(wrapper.op1.op1.type.toString()).toBe(mapped);
      }
    }
  );

  test.each(['Sqrt', 'IsPrime', 'First'])(
    'a parameter named %s supplies its own result',
    (name) => {
      const ce = new ComputeEngine();
      const fn = ce.box([
        'Function',
        ['Map', ['Function', [name, 'x'], 'x'], ['List', 1, 2]],
        ['Typed', name, '(real) -> string'],
      ]);
      expect(fn.isValid).toBe(true);
      expect(fn.op1.op1.type.toString()).toBe('list<string^2>');
    }
  );

  test('a callable named Return is not an omission control marker', () => {
    const ce = new ComputeEngine();
    const fn = ce.box([
      'Function',
      ['Map', ['Function', ['Return'], 'x'], ['List', 1, 2]],
      ['Typed', 'Return', '() -> real'],
    ]);
    expect(fn.op1.op1.type.toString()).toBe('vector<real^2>');
    expect(compile(fn).success).toBe(false);
  });

  test('an opaque function parameter cannot borrow a global body', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    const fn = ce.box(['Function', ['h', 1], ['Typed', 'h', 'function']]);
    expect(fn.op1.op1.type.toString()).toBe('unknown');
  });

  test.each(['(string) -> real', '(real, real) -> real'])(
    'an incompatible global %s contract cannot validate the local call',
    (contract) => {
      const ce = new ComputeEngine();
      ce.declare('h', contract);
      const fn = ce.box([
        'Function',
        ['h', 1],
        ['Typed', 'h', '(real) -> real'],
      ]);
      expect(fn.isValid).toBe(true);
      expect(fn.op1.op1.type.toString()).toBe('real');
    }
  );

  test('the local callable contract still rejects an incompatible argument', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    const fn = ce.box([
      'Function',
      ['h', 1],
      ['Typed', 'h', '(string) -> real'],
    ]);
    expect(fn.isValid).toBe(false);
  });

  test('parsed nested callbacks preserve the enclosing callable contract', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 'Nothing', 'u']));
    const source = '(h: (real) -> real) ↦ map(x ↦ h(x), [1, 2])';
    const [program, diagnostics] = parseEpsil(source);
    expect(diagnostics).toEqual([]);
    const fn = ce.box(resolveLibraryNames(program, source, ce));
    expect(fn.type.toString()).toBe('(h: (real) -> real) -> vector<real^2>');
    const applied = ce.box(['Apply', fn, ['Function', 9, 'u']]);
    expect(applied.evaluate({ materialization: true }).json).toEqual([
      'List',
      9,
      9,
    ]);
  });

  test('opaque nested callbacks retain the compiler omission refusal', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    const fn = ce.box([
      'Function',
      ['Map', ['Function', ['h', 'x'], 'x'], ['List', 1, 2]],
      ['Typed', 'h', '(real) -> any'],
    ]);
    expect(fn.op1.op1.type.toString()).toBe('list<any^2>');
    expect(compile(fn).success).toBe(false);
  });

  test('a captured operator is not replaced by an ambient same-named operator', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('h', {
      signature: '(real) -> string',
      evaluate: () => ce.string('local'),
    });
    const fn = ce.box([
      'Function',
      ['Map', ['Function', ['h', 'x'], 'x'], ['List', 1, 2]],
    ]);
    ce.popScope();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    expect(fn.op1.op1.type.toString()).toBe('list<string^2>');
    const call = fn.op1.op1.op1.op1.op1;
    const shape = describeOperand(call).structureOf?.();
    expect(shape?.kind).toBe('application');
    if (shape?.kind === 'application') expect(shape.callee).toBeDefined();
  });

  test('forwarding a wildcard-declared function retains tuple refinement', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Tuple', 'u', 'u'], 'u']));
    ce.assign('g', ce.box(['Function', ['h', 'x'], 'x']));
    expect(ce.box(['g', 2]).type.toString()).toBe('tuple<integer, integer>');
  });

  test('a captured value-held function refines its own tuple body', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(['Function', ['Tuple', 'u', 'u'], 'u']));
    const literal = ce.box(['Function', ['h', 'x'], 'x']);
    ce.popScope();
    ce.assign('h', ce.box(['Function', 9, 'u']));
    ce.assign('g', literal);
    expect(ce.box(['g', 2]).type.toString()).toBe('tuple<integer, integer>');
  });

  test.each([false, true])(
    'a captured function compiles its own result or explicitly refuses (bare: %s)',
    (bare) => {
      const ce = new ComputeEngine();
      ce.pushScope();
      ce.declare('h', '(real) -> real');
      ce.assign('h', ce.box(['Function', 7, 'u']));
      const map = ce.box([
        'Map',
        bare ? 'h' : ['Function', ['h', 'x'], 'x'],
        ['List', 1, 2],
      ]);
      ce.popScope();
      ce.assign('h', ce.box(['Function', 9, 'u']));
      const result = compile(map);
      expect(ce.box(['ListFrom', map]).evaluate().json).toEqual(['List', 9, 9]);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/different binding/);
    }
  );

  test.each([false, true])(
    'returned omission in a held body remains visible (captured: %s)',
    (captured) => {
      const ce = new ComputeEngine();
      ce.declare('c', 'boolean');
      if (captured) ce.pushScope();
      ce.declare('h', '(real) -> real');
      ce.assign(
        'h',
        ce.box([
          'Function',
          ['Block', ['If', 'c', ['Return', 'Nothing']], 7],
          'u',
        ])
      );
      const map = ce.box([
        'Map',
        ['Function', ['h', 'x'], 'x'],
        ['List', 1, 2],
      ]);
      if (captured) {
        ce.popScope();
        ce.assign('h', ce.box(['Function', 9, 'u']));
      }
      expect(map.type.matches('list<real | nothing>')).toBe(true);
      expect(map.type.matches('list<real>')).toBe(false);
      expect(compile(map).success).toBe(false);
    }
  );

  test.each([
    ['(h: (real) -> real) ↦ [h(k) for k in 1..3]', 'list<real>'],
    ['(h: (real) -> real) ↦ [1,2] |> (x ↦ h(x))', 'vector<real^2>'],
    ['(h: (real) -> real) ↦ (x ↦ h(x))([1,2])', 'vector<real^2>'],
    [
      '(h: (real) -> real) ↦ map(x ↦ h(x), [[1,2],[3,4]])',
      'list<vector<real^2>^2>',
    ],
  ])('structural derivation retains the callee in %s', (source, result) => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    const [program, diagnostics] = parseEpsil(source);
    expect(diagnostics).toEqual([]);
    const fn = ce.box(resolveLibraryNames(program, source, ce));
    expect(fn.type.toString()).toBe(`(h: (real) -> real) -> ${result}`);
  });

  test('descriptor calls preserve scalar-contract broadcasting and never', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('h', '(real) -> real');
    const fn = ce.box(['Function', ['h', 'x'], 'x']);
    ce.popScope();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    const result = deriveApplicationType(ce, 'Map', [
      describeOperand(fn),
      describeOperand(ce.box(['List', ['List', 1, 2], ['List', 3, 4]])),
    ]);
    expect(typeToString(result!)).toBe('list<vector<real^2>^2>');
    expect(
      deriveApplicationType(ce, 'Apply', [
        describeType(ce.type('(real) -> real').type),
        describeType('never'),
      ])
    ).toBe('never');
  });

  test('calls boxed before a definition resolve the later definition', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['g', 'x'], 'x']);
    ce.assign('g', ce.box(['Function', ['Tuple', 'u', 'u'], 'u']));
    ce.assign('f', literal);
    expect(ce.box(['f', 2]).type.toString()).toBe('tuple<integer, integer>');
    for (const fn of ['f', literal]) {
      const map = ce.box(['Map', fn, ['List', 1, 2]]);
      expect(map.type.toString()).toBe('list<tuple<integer, integer>^2>');
      expect(ce.box(['ListFrom', map]).evaluate().json).toEqual([
        'List',
        ['Tuple', 1, 1],
        ['Tuple', 2, 2],
      ]);
    }
  });

  test('a user Apply definition cannot type a lexical call', () => {
    const ce = new ComputeEngine();
    ce.declare('Apply', {
      signature: '(any*) -> string',
      evaluate: () => ce.string('user'),
    });
    const fn = ce.box([
      'Function',
      ['Map', ['Function', ['h', 'x'], 'x'], ['List', 1, 2]],
      ['Typed', 'h', '(real) -> real'],
    ]);
    expect(fn.op1.op1.type.toString()).toBe('vector<real^2>');
  });

  test('a captured operator retains its broadcast rule and type handler', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('h', {
      signature: '(real) -> real',
      broadcastable: true,
      type: () => ce.type('integer'),
      evaluate: ([x]) => x,
    });
    const fn = ce.box(['Function', ['h', 'x'], 'x']);
    ce.popScope();
    ce.declare('h', {
      signature: '(any) -> string',
      evaluate: () => ce.string('ambient'),
    });
    const result = deriveApplicationType(ce, 'Map', [
      describeOperand(fn),
      describeOperand(ce.box(['List', ['List', 1, 2], ['List', 3, 4]])),
    ]);
    expect(typeToString(result!)).toBe('list<vector<integer^2>^2>');
  });

  test('a captured Coalesce keeps fallback reachability', () => {
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('Coalesce');
    expect(def && 'operator' in def).toBe(true);
    if (!def || !('operator' in def)) return;
    const callee = retainOperatorCallee(
      describeType(def.operator.signature.type),
      ce,
      'Coalesce',
      def.operator
    );
    ce.declare('Coalesce', { signature: '(any*) -> string' });
    expect(
      deriveApplicationOf(
        { head: 'Coalesce', callee },
        [describeType('integer'), describeType('never')],
        { engine: ce, derive: (h, args) => deriveApplicationType(ce, h, args) }
      )
    ).toBe('integer');
  });

  test.each([false, true])(
    'a named closure retains interpreter/compiler parity (map: %s)',
    (mapped) => {
      const ce = new ComputeEngine();
      ce.pushScope();
      ce.declare('h', '(real) -> real');
      ce.assign('h', ce.box(['Function', 7, 'u']));
      const literal = ce.box([
        'Function',
        mapped
          ? ['Map', ['Function', ['h', 'u'], 'u'], ['List', 1, 2]]
          : ['h', 'x'],
        'x',
      ]);
      ce.popScope();
      ce.assign('h', ce.box(['Function', 9, 'u']));
      ce.assign('f', literal);
      const call = ce.box(['f', 1]);
      const result = compile(call);
      if (result.success) {
        const interpreted = mapped
          ? ce.box(['ListFrom', call]).evaluate().json
          : call.evaluate().json;
        expect(interpreted).toEqual(mapped ? ['List', 9, 9] : 7);
        expect(result.run!({})).toEqual(mapped ? [9, 9] : 7);
      } else expect(result.error).toMatch(/different binding/);
    }
  );

  test('a mixed scalar/list signature still maps a scalar tuple position', () => {
    const ce = new ComputeEngine();
    const result = deriveApplicationOf(
      {
        head: 'h',
        callee: describeType(ce.type('(real, list<real>) -> real').type),
      },
      [
        describeOperand(ce.box(['Tuple', 1, 2])),
        describeOperand(ce.box(['List', 3])),
      ],
      { engine: ce, derive: (h, args) => deriveApplicationType(ce, h, args) }
    );
    expect(typeToString(result!)).toBe('tuple<real, real>');
  });

  test.each([false, true])(
    'a closed captured definition has an accurate compiler diagnostic (bare: %s)',
    (bare) => {
      const ce = new ComputeEngine();
      ce.pushScope();
      ce.declare('h', '(real) -> real');
      ce.assign('h', ce.box(['Function', 7, 'u']));
      const map = ce.box([
        'Map',
        bare ? 'h' : ['Function', ['h', 'x'], 'x'],
        ['List', 1, 2],
      ]);
      ce.popScope();
      const result = compile(map);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/definition is not in scope/);
    }
  );

  test('unshadowed named calls still derive results from their own bodies', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Tuple', 'u', 'u'], 'u']));
    expect(ce.box(['h', 2]).type.toString()).toBe('tuple<integer, integer>');
  });
});
