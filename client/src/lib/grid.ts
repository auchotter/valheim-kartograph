/**
 * Returns a 1/2/5 × 10^n world interval whose screen-space distance is close
 * to 90 CSS pixels. This keeps the optional navigation grid readable without
 * coupling it to screen coordinates.
 */
export function chooseGridSpacing(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new RangeError('Grid spacing requires a finite, positive zoom.');
  }

  const targetPixels = 90;
  const targetWorldSpacing = targetPixels / zoom;
  const exponent = Math.floor(Math.log10(targetWorldSpacing));
  let bestSpacing = 1;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let power = exponent - 2; power <= exponent + 2; power += 1) {
    const magnitude = 10 ** power;
    for (const multiplier of [1, 2, 5]) {
      const candidate = multiplier * magnitude;
      const screenSpacing = candidate * zoom;
      if (screenSpacing < 60 || screenSpacing > 120) {
        continue;
      }
      const difference = Math.abs(screenSpacing - targetPixels);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestSpacing = candidate;
      }
    }
  }

  return bestDifference === Number.POSITIVE_INFINITY ? targetWorldSpacing : bestSpacing;
}
