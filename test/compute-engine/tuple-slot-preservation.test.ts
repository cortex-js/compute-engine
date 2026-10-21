import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseType } from '../../src/common/type/parse';
import { reduceType } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';
import { collectionElementType } from '../../src/common/type/utils';
import { isSubtype, provablyDisjoint } from '../../src/common/type/subtype';
import { expectTypeBetween } from '../utils';

describe('data tuples preserve positions', () => {
  test.each(['box', 'function', 'tuple', 'parse'] as const)(
    '%s keeps a written Nothing coordinate',
    (route) => {
      const ce = new ComputeEngine();
      const value =
        route === 'box'
          ? ce.box(['Tuple', 1, 'Nothing', 3])
          : route === 'function'
            ? ce.function('Tuple', [ce.One, ce.Nothing, ce.number(3)])
            : route === 'tuple'
              ? ce.tuple(1, ce.Nothing, 3)
              : ce.parse('(1, \\mathrm{Nothing}, 3)');
      expect(value.evaluate().json).toEqual(['Tuple', 1, 'Nothing', 3]);
      expect(value.count).toBe(3);
      expect(value.at(2)?.symbol).toBe('Nothing');
      expectTypeBetween(value, { atMost: 'tuple<integer, nothing, integer>' });
    }
  );

  test('Nothing does not weaken fixed-arity tuple disjointness', () => {
    expect(
      provablyDisjoint(
        parseType('tuple<nothing, integer>'),
        parseType('tuple<integer>')
      )
    ).toBe(true);
    expect(
      provablyDisjoint(parseType('tuple<nothing>'), parseType('tuple<integer>'))
    ).toBe(true);
  });

  test('Epsil tuple coordinates keep Nothing', () => {
    const result = executeEpsil(new ComputeEngine(), '(1, Nothing, 3)');
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual(['Tuple', 1, 'Nothing', 3]);
  });

  test.each(['Single', 'Pair', 'Triple'])(
    '%s keeps markers and checks their actual arity',
    (head) => {
      const ce = new ComputeEngine();
      const args =
        head === 'Single'
          ? ['Nothing']
          : head === 'Pair'
            ? ['Nothing', 8]
            : ['Nothing', 8, 'Missing'];
      const value = ce.box([head, ...args]);
      expect(value.evaluate().json).toEqual(['Tuple', ...args]);
      expect(value.count).toBe(args.length);
      expect(ce.box([head, ...args, 9]).isValid).toBe(false);
    }
  );

  test('an explicit Sequence still splices and can contribute zero coordinates', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Tuple', ['Sequence'], 8]).json).toEqual(['Tuple', 8]);
    expect(ce.box(['Tuple', 1, ['Sequence', 2, 3], 'Nothing']).json).toEqual([
      'Tuple',
      1,
      2,
      3,
      'Nothing',
    ]);
  });

  test('a delimiter splices an explicit empty Sequence before canonicalization', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Delimiter', ['Sequence', ['Sequence'], 8], "'(,)'"]).json
    ).toEqual(['Tuple', 8]);
  });

  test.each(['single', 'multi'] as const)(
    'Map bypasses a computed tuple omission on %s-source indexed and iterator reads',
    (mode) => {
      for (const route of ['at', 'each']) {
        const ce = new ComputeEngine();
        ce.declare('c', 'boolean');
        let calls = 0;
        ce.declare('Seen', {
          signature:
            mode === 'single' ? '(any) -> integer' : '(any, any) -> integer',
          pure: false,
          evaluate: () => {
            calls++;
            return ce.number(99);
          },
        });
        const source = ce.box(['Tuple', ['If', 'c', 'Nothing', 1], 2]);
        const map = ce.function(
          'Map',
          mode === 'single'
            ? [ce.symbol('Seen'), source]
            : [ce.symbol('Seen'), source, ce.tuple(4, 5)]
        );
        ce.assign('c', ce.True);
        expect(map.count).toBe(2);
        expect(calls).toBe(0);
        if (route === 'at') {
          expect(map.at(2)?.re).toBe(99);
          expect(calls).toBe(1);
          expect(map.at(1)?.symbol).toBe('Nothing');
        } else
          expect([...map.each()].map((x) => x.json)).toEqual(['Nothing', 99]);
        expect(calls).toBe(1);
      }
    }
  );

  test('count and index do not evaluate unrelated computed coordinates', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Omit', {
      signature: '() -> nothing',
      pure: false,
      evaluate: () => {
        calls++;
        return ce.Nothing;
      },
    });
    const tuple = ce.box(['Tuple', ['Omit'], 8]);
    expect(tuple.count).toBe(2);
    expect(tuple.at(2)?.re).toBe(8);
    expect(calls).toBe(0);
    expect(tuple.evaluate().json).toEqual(['Tuple', 'Nothing', 8]);
    expect(calls).toBe(1);
  });

  test('a conditional coordinate has fixed position and an omission-aware type', async () => {
    const ce = new ComputeEngine();
    ce.declare('condition', 'boolean');
    const tuple = ce.box(['Tuple', ['If', 'condition', 'Nothing', 2], 8]);
    expectTypeBetween(tuple, {
      atMost: 'tuple<integer | nothing, integer>',
      above: 'tuple<integer, integer>',
    });
    ce.assign('condition', ce.True);
    expect(tuple.evaluate().json).toEqual(['Tuple', 'Nothing', 8]);
    expect((await tuple.evaluateAsync()).json).toEqual(['Tuple', 'Nothing', 8]);
    expect(tuple.N().json).toEqual(['Tuple', 'Nothing', 8]);
  });

  test('a named omission-producing call retains its possible Nothing coordinate', () => {
    const ce = new ComputeEngine();
    ce.assign('choose', ce.box(['Function', ['If', 'x', 'Nothing', 2], 'x']));
    ce.declare('condition', 'boolean');
    const tuple = ce.box(['Tuple', ['choose', 'condition'], 8]);
    expectTypeBetween(tuple, {
      atMost: 'tuple<integer | nothing, integer>',
      above: 'tuple<integer, integer>',
    });
  });

  test('a tuple of missing coordinates is present data', () => {
    const ce = new ComputeEngine();
    const tuple = ce.box(['Tuple', 'Missing', 'Undefined']);
    expect(tuple.evaluate().json).toEqual(['Tuple', 'Missing', 'Undefined']);
    expect(tuple.count).toBe(2);
    expect(isSubtype('missing', tuple.type.type)).toBe(false);
    expect(tuple.isSame(ce.Missing)).toBe(false);
  });

  test('nested markers preserve both tuple levels', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Tuple', ['Tuple', 'Nothing', 8], 'Nothing']).evaluate().json
    ).toEqual(['Tuple', ['Tuple', 'Nothing', 8], 'Nothing']);
  });

  test('tuple type reduction preserves Nothing slots, while never still empties a tuple', () => {
    expect(typeToString(reduceType(parseType('tuple<nothing, integer>')))).toBe(
      'tuple<nothing, integer>'
    );
    expect(typeToString(reduceType(parseType('tuple<nothing, nothing>')))).toBe(
      'tuple<nothing, nothing>'
    );
    expect(reduceType(parseType('tuple<never, integer>'))).toBe('never');
    const element = collectionElementType(
      parseType('tuple<integer, nothing>')
    )!;
    expect(isSubtype('nothing', element)).toBe(true);
  });

  test('Map bypasses omitted tuple cells and Filter drops them', () => {
    const ce = new ComputeEngine();
    const mapped = ce.box([
      'Map',
      ['Function', ['Multiply', 'x', 2], ['Typed', 'x', "'integer'"]],
      ['Tuple', 1, 'Nothing', 3],
    ]);
    expect(mapped.isValid).toBe(true);
    expect([...mapped.each()].map((x) => x.symbol ?? x.re)).toEqual([
      2,
      'Nothing',
      6,
    ]);
    expectTypeBetween(mapped, {
      atMost: 'list<integer | nothing>',
      above: 'list<integer>',
    });
    const filtered = ce.box([
      'Filter',
      ['Tuple', 1, 'Nothing', 3],
      ['Function', 'True', 'x'],
    ]);
    expect([...filtered.each()].map((x) => x.re)).toEqual([1, 3]);
  });

  test('List and the current TupleFrom conversion still omit Nothing', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['List', 1, 'Nothing', 3]).json).toEqual(['List', 1, 3]);
    const source = ce.box([
      'Map',
      ['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'x'],
      ['List', 1, 2, 3],
    ]);
    expect(ce.function('TupleFrom', [source]).evaluate().json).toEqual([
      'Tuple',
      1,
      3,
    ]);
  });

  test('Zip preserves omitted and all-missing rows across access and materialization', () => {
    const ce = new ComputeEngine();
    const omitted = ce.box([
      'Map',
      ['Function', ['If', ['Equal', 'x', 2], 'Nothing', 'x'], 'x'],
      ['List', 1, 2, 3],
    ]);
    const zipped = ce.function('Zip', [omitted, ce.box(['List', 10, 20, 30])]);
    expect(zipped.at(2)?.json).toEqual(['Tuple', 'Nothing', 20]);
    expect([...zipped.each()].map((x) => x.json)).toEqual([
      ['Tuple', 1, 10],
      ['Tuple', 'Nothing', 20],
      ['Tuple', 3, 30],
    ]);
    expect(ce.function('ListFrom', [zipped]).evaluate().json).toEqual([
      'List',
      ['Tuple', 1, 10],
      ['Tuple', 'Nothing', 20],
      ['Tuple', 3, 30],
    ]);
    const absent = ce.box(['Zip', ['List', 'Missing'], ['List', 'Missing']]);
    expect(absent.at(1)?.json).toEqual(['Tuple', 'Missing', 'Missing']);
    expect(ce.function('ListFrom', [absent]).evaluate().json).toEqual([
      'List',
      ['Tuple', 'Missing', 'Missing'],
    ]);
  });

  test('compiled JavaScript retains an all-missing tuple and Zip row', () => {
    const ce = new ComputeEngine();
    expect(compile(ce.box(['Tuple', 'Missing', 'Missing'])).run!({})).toEqual([
      undefined,
      undefined,
    ]);
    const result = compile(
      ce.box(['Zip', ['List', 'Missing'], ['List', 'Missing']])
    );
    expect(result.success).toBe(true);
    expect(result.run!({})).toEqual([[undefined, undefined]]);
  });

  test.each(['javascript', 'python', 'glsl', 'wgsl'] as const)(
    '%s refuses Nothing coordinates until representable',
    (to) => {
      const ce = new ComputeEngine();
      expect(compile(ce.box(['Tuple', 'Nothing', 8]), { to }).success).toBe(
        false
      );
    }
  );

  test.each(['javascript', 'python', 'glsl', 'wgsl'] as const)(
    '%s refuses a conditional omission even when its branch join absorbs Nothing',
    (to) => {
      const ce = new ComputeEngine();
      ce.declare('c', 'boolean');
      const tuple = ce.box(['Tuple', ['If', 'c', 'Nothing', 2], 8]);
      const result = compile(tuple, { to });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Nothing/);
    }
  );

  test('compiled Zip refuses a source admitting Nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<integer | nothing>');
    const result = compile(ce.box(['Zip', 'xs', ['List', 7, 8]]));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Nothing/);
  });
});
