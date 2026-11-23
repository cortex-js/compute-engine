/** One statistic of an area table. */
export interface Source {
  readonly head: string;
  /**
   * The FindStat statistic with the same value on every element tried. A row
   * without one is held to its examples only.
   */
  readonly findstat?: string;
  /** One line: what the statistic counts. */
  readonly summary: string;
  /** The meaning: an Epsil function literal over one list. */
  readonly epsil: string;
}
