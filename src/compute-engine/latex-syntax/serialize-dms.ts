/**
 * DMS (Degrees-Minutes-Seconds) serialization utilities.
 */

/**
 * Normalize an angle in degrees to a specific range.
 */
export function normalizeAngle(
  degrees: number,
  mode: 'none' | '0...360' | '-180...180'
): number {
  if (mode === 'none') return degrees;

  if (mode === '0...360') {
    // Normalize to [0, 360)
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  if (mode === '-180...180') {
    // Normalize to [-180, 180]
    let normalized = degrees % 360;
    if (normalized > 180) normalized -= 360;
    if (normalized < -180) normalized += 360;
    return normalized;
  }

  return degrees;
}
