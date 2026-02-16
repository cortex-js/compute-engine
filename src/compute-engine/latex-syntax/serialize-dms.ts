/**
 * DMS (Degrees-Minutes-Seconds) serialization utilities.
 */

export interface DMSComponents {
  deg: number;
  min: number;
  sec: number;
}

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
    return (normalized < 0 ? normalized + 360 : normalized) || 0; // Avoid -0
  }

  if (mode === '-180...180') {
    // Normalize to [-180, 180]
    let normalized = degrees % 360;
    if (normalized > 180) normalized -= 360;
    if (normalized < -180) normalized += 360;
    return normalized || 0; // Avoid -0
  }

  return degrees;
}

/**
 * Convert decimal degrees to DMS components.
 * Handles negative angles correctly (all components get the sign).
 */
export function degreesToDMS(totalDegrees: number): DMSComponents {
  const sign = totalDegrees < 0 ? -1 : 1;
  const absDegrees = Math.abs(totalDegrees);

  const deg = Math.floor(absDegrees);
  const minDecimal = (absDegrees - deg) * 60;
  const min = Math.floor(minDecimal);
  const secDecimal = (minDecimal - min) * 60;

  // Round seconds to 3 decimal places to avoid floating point noise
  let sec = Math.round(secDecimal * 1000) / 1000;

  // Handle carry: if seconds round to 60, carry to minutes
  let finalMin = min;
  let finalDeg = deg;

  if (sec >= 60) {
    sec = 0;
    finalMin++;
  }

  // Handle carry: if minutes round to 60, carry to degrees
  if (finalMin >= 60) {
    finalMin = 0;
    finalDeg++;
  }

  return {
    deg: sign * finalDeg || 0, // Avoid -0
    min: sign * finalMin || 0, // Avoid -0
    sec: sec === 0 ? 0 : sign * sec,
  };
}

/**
 * Format a decimal degree value as a DMS LaTeX string.
 * Used by both Degrees and Quantity serializers.
 */
export function formatDMS(degrees: number): string {
  const { deg, min, sec } = degreesToDMS(degrees);

  let result = `${deg}°`;

  if (Math.abs(sec) > 0.001) {
    const secStr = sec % 1 === 0 ? sec.toString() : sec.toFixed(2);
    result += `${Math.abs(min)}'${Math.abs(Number(secStr))}"`;
  } else if (Math.abs(min) > 0) {
    result += `${Math.abs(min)}'`;
  } else {
    result += `0'0"`;
  }

  return result;
}
