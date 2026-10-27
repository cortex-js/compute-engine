import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { ComputeEngine } from '../../src/compute-engine';
import {
  installGroupTheory,
  isPermutationError,
} from '../../src/compute-engine/library/group-theory';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { ERROR_EXPLANATIONS } from '../../src/epsil/error-explanations';
import type { MathJsonExpression as MJ } from '../../src/math-json/types';

const group: MJ = [
  'PermutationGroup',
  ['List', ['Permutation', ['List', 2, 1]]],
  ['PermutationAction', 3],
];
const options = (key: string, value: MJ): MJ => [
  'Dictionary',
  ['Tuple', { str: key }, value],
];
function engine(maxChainWork = 50_000_000) {
  const ce = new ComputeEngine();
  installGroupTheory(ce, { maxChainWork });
  return ce;
}

describe('permutation API contracts', () => {
  test('defaults and named options work without changing mathematical values', () => {
    const ce = engine();
    const result = executeEpsil(
      ce,
      'let G=PermutationGroup([Permutation([2,1])],PermutationAction(3))\n(PermutationGroupOrder(G),PermutationGroupOrder(G, options: {maxWork -> 10000}))'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value.json).toEqual(['Tuple', 2, 2]);
    expect(ce.box(group).json).toEqual(engine(10000).box(group).json);
  });
  test('call options cannot raise the receiver ceiling, even after a successful cached query', () => {
    const ce = engine(10000);
    expect(ce.box(['PermutationGroupOrder', group]).evaluate().json).toBe(2);
    for (const [settings, code] of [
      [options('maxWork', 10001), 'permutation-option-exceeds-limit'],
      [options('maxWork', 0), 'permutation-chain-work-limit'],
      [options('maxWrok', 100), 'unknown-permutation-option'],
    ] as [MJ, string][]) {
      const result = ce
        .box(['PermutationGroupOrder', group, settings])
        .evaluate();
      expect(result.operator).toBe('Error');
      expect(JSON.stringify(result.json)).toContain(code);
      expect(ERROR_EXPLANATIONS[code]).toBeTruthy();
    }
    expect(ce.box(['PermutationGroupOrder', group]).evaluate().json).toBe(2);
    expect(ce.box(['PermutationGroupOrder', group, 10000]).isValid).toBe(false);
  });
  test('options can remain symbolic until assigned', () => {
    const ce = engine();
    ce.declare('settings', 'dictionary<integer>');
    const query = ce.box(['PermutationGroupOrder', group, 'settings']);
    expect(query.evaluate().operator).toBe('PermutationGroupOrder');
    ce.assign('settings', options('maxWork', 10000));
    expect(query.evaluate().json).toBe(2);
  });
  test('all capability signatures are registered and expose no any result', () => {
    const ce = engine();
    const ledger = JSON.parse(
      readFileSync(
        join(__dirname, '../../docs/group-theory/CAPABILITIES.json'),
        'utf8'
      )
    ) as { operations: { name: string; signature: string }[] };
    expect(ledger.operations.length).toBe(26);
    for (const item of ledger.operations) {
      const signature = ce.lookupDefinition(item.name)!.operator!.signature;
      expect(signature.toString()).not.toMatch(/\bany\b/);
      expect(signature.toString()).toBe(ce.type(item.signature).toString());
    }
    for (const name of [
      'GroupMatrix',
      'MatrixGroup',
      'GroupPcSequence',
      'GroupQuotient',
    ])
      expect(ce.lookupDefinition(name)).toBeUndefined();
  });
  test('kernel input/limit errors survive a separate JavaScript realm', () => {
    const error: unknown = runInNewContext(
      'Object.assign(new Error("duplicate-permutation-image"), {name:"PermutationInputError",code:"duplicate-permutation-image"})'
    );
    expect(error instanceof Error).toBe(false);
    expect(isPermutationError(error)).toBe(true);
    expect(ERROR_EXPLANATIONS['duplicate-permutation-image']).toContain(
      'exactly once'
    );
    expect(isPermutationError(new Error('cancel'))).toBe(false);
    expect(
      isPermutationError({
        name: 'PermutationChainInvariantError',
        code: 'broken',
      })
    ).toBe(false);
    expect(isPermutationError({ name: 'PermutationInputError', code: 7 })).toBe(
      false
    );
  });
});
