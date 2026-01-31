/**
 * OEIS (Online Encyclopedia of Integer Sequences) Integration
 *
 * This module provides functions to look up sequences in the OEIS database
 * and import them for use in the compute engine.
 *
 * @see https://oeis.org
 */

import type { ComputeEngine, BoxedExpression } from './global-types';

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

/**
 * Parse OEIS JSON response into OEISSequenceInfo objects.
 */
function parseOEISResponse(data: any): OEISSequenceInfo[] {
  // OEIS returns either an array directly, or an object with 'results' key
  // depending on the query type
  let results: any[];

  if (Array.isArray(data)) {
    results = data;
  } else if (data && data.results && Array.isArray(data.results)) {
    results = data.results;
  } else {
    return [];
  }

  return results.map((result: any) => {
    // Parse the sequence terms from the 'data' field
    const terms = result.data
      ? result.data.split(',').map((s: string) => parseInt(s.trim(), 10))
      : [];

    // Get the first formula if available
    const formula = result.formula?.[0];

    return {
      id: result.number ? `A${String(result.number).padStart(6, '0')}` : '',
      name: result.name || '',
      terms,
      formula,
      comments: result.comment,
      url: result.number
        ? `${OEIS_BASE_URL}/A${String(result.number).padStart(6, '0')}`
        : '',
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
