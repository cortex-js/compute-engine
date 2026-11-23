// Optional combinatorics library: statistics over the engine's own lists. It is
// not part of the default library: a host calls `loadCombinatorics(ce)`
// (exported from the `@cortex-js/compute-engine/combinatorics` subpath).
//
// Elements are plain lists, as `Permutations(Range(1, n))` and
// `IntegerPartitions(n)` yield them. Each statistic declares its domain as a
// type over `list<integer>`; the loader declares the type names as aliases:
//
//  - `permutation`: `list<integer>`
//  - `integer_partition`: `list<integer>`
//
// An alias cannot say "a bijection of 1..n" or "non-increasing", so a handler
// checks the rest and a call outside the domain stays unevaluated. A value of
// group theory's `Permutation` is also accepted where that library is loaded
// first (the signature can only name a type that exists).
//
// Every statistic is defined by an Epsil function literal, precompiled to
// MathJSON (`compiled.ts`, by `generate.ts` from `sources/`) and run through
// `Apply`; the Epsil text is not part of the runtime. A statistic may also have
// a TypeScript kernel (`kernels.ts`); a test holds the two equal.

import type { IComputeEngine, OperatorDefinition } from '../global-types.js';
import type { Area, CombinatoricsArea, Domain } from './areas.js';
import { statisticHandler } from './definition.js';
import { COMPILED } from './compiled.js';
import { INTEGER_PARTITION, PERMUTATION } from './domains.js';
import { KERNELS } from './kernels.js';

export type { CombinatoricsArea } from './areas.js';

export interface CombinatoricsLoadOptions {
  /** The areas to load; all of them when omitted. */
  areas?: CombinatoricsArea[];
}

export interface CombinatoricsLoadReport {
  /** The areas loaded, in the order of the tables. */
  areas: CombinatoricsArea[];
  /** The heads declared for these areas. */
  heads: string[];
  /** The type names declared (aliases of `list<integer>`). */
  types: string[];
  /** Heads not declared, with the reason. */
  skipped: { head: string; reason: string }[];
}

const area = (name: CombinatoricsArea, domain: Domain): Area => ({
  name,
  domain,
  statistics: COMPILED[name].map(([head, findstat, literal]) => ({
    head,
    ...(findstat === null ? {} : { findstat }),
    literal,
    ...(KERNELS[head] === undefined ? {} : { fast: KERNELS[head] }),
  })),
});

/** The areas, in load order. Adding an area is adding an entry. */
export const COMBINATORICS_AREAS: readonly Area[] = [
  area('permutations', PERMUTATION),
  area('partitions', INTEGER_PARTITION),
];

type AreaState = {
  report: CombinatoricsLoadReport;
  definitions: readonly { name: string; value: unknown }[];
};

/** Per engine, per area. A `WeakMap` lets a discarded engine be collected. */
const loaded = new WeakMap<IComputeEngine, Map<CombinatoricsArea, AreaState>>();

const typeIsKnown = (ce: IComputeEngine, name: string): boolean => {
  try {
    ce.type(name);
    return true;
  } catch {
    return false;
  }
};

function loadArea(ce: IComputeEngine, area: Area): AreaState {
  const { domain } = area;
  const types: string[] = [];
  const skipped: CombinatoricsLoadReport['skipped'] = [];
  const definitions: Record<string, OperatorDefinition> = {};

  const accepted =
    domain.alsoReads !== undefined && typeIsKnown(ce, domain.alsoReads)
      ? `${domain.type} | ${domain.alsoReads}`
      : domain.type;

  for (const statistic of area.statistics) {
    if (ce.lookupDefinition(statistic.head)) {
      skipped.push({ head: statistic.head, reason: 'already-defined' });
      continue;
    }
    try {
      definitions[statistic.head] = {
        ...(statistic.findstat === undefined
          ? {}
          : { description: `FindStat ${statistic.findstat}` }),
        signature: `(${accepted}) -> integer`,
        pure: true,
        evaluate: statisticHandler(ce, domain, statistic),
      };
    } catch (error) {
      skipped.push({
        head: statistic.head,
        reason: `invalid-definition: ${(error as Error).message}`,
      });
    }
  }

  // The alias is declared once per engine; another library may have made it.
  if (!typeIsKnown(ce, domain.type)) {
    ce.declareType(domain.type, 'list<integer>', { alias: true, mint: false });
    types.push(domain.type);
  }

  const added: string[] = [];
  try {
    for (const [name, definition] of Object.entries(definitions)) {
      ce.declare(name, definition);
      added.push(name);
    }
  } catch (error) {
    // All or nothing within an area.
    ce.undeclare(added);
    throw error;
  }

  return {
    report: {
      areas: [area.name],
      heads: added,
      types,
      skipped,
    },
    definitions: added.map((name) => ({
      name,
      value: ce.lookupDefinition(name),
    })),
  };
}

/**
 * Register the optional combinatorics library. Synchronous and idempotent per
 * engine and area: loading an area again returns its first report and changes
 * nothing, unless its definitions were removed meanwhile, in which case it
 * loads again. A head the engine already defines is skipped and reported.
 *
 * Throws on an unknown area name.
 */
export function loadCombinatorics(
  ce: IComputeEngine,
  options: CombinatoricsLoadOptions = {}
): CombinatoricsLoadReport {
  const requested = options.areas ?? COMBINATORICS_AREAS.map((a) => a.name);
  for (const name of requested)
    if (!COMBINATORICS_AREAS.some((a) => a.name === name))
      throw new Error(`loadCombinatorics: unknown area "${name}"`);

  let states = loaded.get(ce);
  if (!states) loaded.set(ce, (states = new Map()));

  const report: CombinatoricsLoadReport = {
    areas: [],
    heads: [],
    types: [],
    skipped: [],
  };
  for (const area of COMBINATORICS_AREAS) {
    if (!requested.includes(area.name)) continue;
    let state = states.get(area.name);
    if (
      !state ||
      !state.definitions.every(
        ({ name, value }) => value === ce.lookupDefinition(name)
      )
    ) {
      state = loadArea(ce, area);
      states.set(area.name, state);
    }
    report.areas.push(area.name);
    report.heads.push(...state.report.heads);
    report.types.push(...state.report.types);
    report.skipped.push(...state.report.skipped);
  }
  return report;
}
