/**
 * OEIS (Online Encyclopedia of Integer Sequences) Integration
 *
 * This module provides functions to look up sequences in the OEIS database
 * and import them for use in the compute engine.
 *
 * @see https://oeis.org
 */

import type {
  IComputeEngine as ComputeEngine,
  BoxedExpression,
} from './global-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Result from an OEIS lookup operation.
 */
export interface OEISSequenceInfo {
  /** OEIS sequence ID (e.g., 'A000045') */
  id: string;

  /** Sequence name/description */
  name: string;

  /** First several terms of the sequence */
  terms: number[];

  /** Formula or recurrence (if available) */
  formula?: string;

  /** Comments about the sequence */
  comments?: string[];

  /** URL to the OEIS page */
  url: string;
}

/**
 * Options for OEIS operations.
 */
export interface OEISOptions {
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;

  /** Maximum number of results to return for lookups (default: 5) */
  maxResults?: number;
}

// ============================================================================
// OEIS API Functions
// ============================================================================

const OEIS_BASE_URL = 'https://oeis.org';
const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RESULTS = 5;

type OEISApiResult = {
  number?: unknown;
  name?: unknown;
  data?: unknown;
  formula?: unknown;
  comment?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return null;
}

function parseSequenceNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
}

function parseTerms(value: unknown): number[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function parseFormula(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const first = value.find((v) => typeof v === 'string');
  return typeof first === 'string' ? first : undefined;
}

function parseComments(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return undefined;
  const comments = value.filter((item): item is string => typeof item === 'string');
  return comments.length > 0 ? comments : undefined;
}

function parseResults(data: unknown): OEISApiResult[] {
  if (Array.isArray(data)) return data;

  const payload = asRecord(data);
  if (!payload) return [];

  const results = payload.results;
  if (!Array.isArray(results)) return [];

  return results;
}

/**
 * Parse OEIS JSON response into OEISSequenceInfo objects.
 */
function parseOEISResponse(data: unknown): OEISSequenceInfo[] {
  const results = parseResults(data);

  return results.map((result) => {
    const sequenceNumber = parseSequenceNumber(result.number);
    const id =
      sequenceNumber !== undefined
        ? `A${String(sequenceNumber).padStart(6, '0')}`
        : '';

    return {
      id,
      name: typeof result.name === 'string' ? result.name : '',
      terms: parseTerms(result.data),
      formula: parseFormula(result.formula),
      comments: parseComments(result.comment),
      url: id ? `${OEIS_BASE_URL}/${id}` : '',
    };
  });
}

/**
 * Look up sequences in OEIS by their terms.
 *
 * @param terms - Array of sequence terms to search for
 * @param options - Optional configuration
 * @returns Promise resolving to array of matching sequences
 *
 * @example
 * ```typescript
 * const results = await lookupOEISByTerms([0, 1, 1, 2, 3, 5, 8, 13]);
 * // → [{ id: 'A000045', name: 'Fibonacci numbers', ... }]
 * ```
 */
export async function lookupOEISByTerms(
  terms: number[],
  options: OEISOptions = {}
): Promise<OEISSequenceInfo[]> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  // Build the query URL
  const query = terms.join(',');
  const url = `${OEIS_BASE_URL}/search?fmt=json&q=${encodeURIComponent(query)}&start=0&count=${maxResults}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OEIS request failed: ${response.status}`);
    }

    const data = await response.json();
    const results = parseOEISResponse(data);
    // Limit results client-side since OEIS may not strictly respect count param
    return results.slice(0, maxResults);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OEIS request timed out');
    }
    throw error;
  }
}

/**
 * Look up a sequence in OEIS by its ID.
 *
 * @param id - OEIS sequence ID (e.g., 'A000045' or '45')
 * @param options - Optional configuration
 * @returns Promise resolving to sequence info, or undefined if not found
 *
 * @example
 * ```typescript
 * const fib = await lookupOEISById('A000045');
 * // → { id: 'A000045', name: 'Fibonacci numbers', terms: [0, 1, 1, 2, ...], ... }
 * ```
 */
export async function lookupOEISById(
  id: string,
  options: OEISOptions = {}
): Promise<OEISSequenceInfo | undefined> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  // Normalize the ID
  const normalizedId = id.toUpperCase().startsWith('A')
    ? id.toUpperCase()
    : `A${id.padStart(6, '0')}`;

  const url = `${OEIS_BASE_URL}/search?fmt=json&q=id:${normalizedId}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OEIS request failed: ${response.status}`);
    }

    const data = await response.json();
    const results = parseOEISResponse(data);
    return results[0];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OEIS request timed out');
    }
    throw error;
  }
}

// ============================================================================
// ComputeEngine Integration
// ============================================================================

/**
 * Look up a sequence in OEIS by its terms.
 *
 * @param ce - ComputeEngine instance
 * @param terms - Array of sequence terms (numbers or BoxedExpressions)
 * @param options - Optional configuration
 * @returns Promise resolving to array of matching sequences
 */
export async function lookupSequence(
  ce: ComputeEngine,
  terms: (number | BoxedExpression)[],
  options: OEISOptions = {}
): Promise<OEISSequenceInfo[]> {
  // Convert BoxedExpressions to numbers and validate all are integers
  const numericTerms = terms.map((t) => {
    if (typeof t === 'number') {
      if (!Number.isInteger(t)) {
        throw new Error('OEIS lookup requires integer terms');
      }
      return t;
    }
    const n = t.re;
    if (!Number.isInteger(n)) {
      throw new Error('OEIS lookup requires integer terms');
    }
    return n;
  });

  return lookupOEISByTerms(numericTerms, options);
}

/**
 * Check if a defined sequence matches an OEIS sequence.
 *
 * @param ce - ComputeEngine instance
 * @param name - Name of the defined sequence
 * @param count - Number of terms to check (default: 10)
 * @param options - Optional configuration
 * @returns Promise with match results
 */
export async function checkSequence(
  ce: ComputeEngine,
  name: string,
  count: number = 10,
  options: OEISOptions = {}
): Promise<{
  matches: OEISSequenceInfo[];
  terms: number[];
}> {
  // Generate terms using the existing getSequenceTerms function
  const termExprs = ce.getSequenceTerms(name, 0, count - 1);
  if (!termExprs) {
    throw new Error(`'${name}' is not a defined sequence`);
  }

  const terms = termExprs.map((t) => t.re);

  // Look up in OEIS
  const matches = await lookupOEISByTerms(terms, options);

  return { matches, terms };
}
