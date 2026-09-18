/**
 * Returns a 1/2/2.5/5 × 10^n world interval whose screen-space distance is
 * close to 90 CSS pixels. The 2.5 step closes the otherwise empty gap between
 * the 2 and 5 intervals, so the grid never falls back to a zoom-dependent
 * world interval while crossing an LOD boundary.
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
  let nearestSpacing = bestSpacing;
  let nearestDifference = Number.POSITIVE_INFINITY;

  for (let power = exponent - 2; power <= exponent + 2; power += 1) {
    const magnitude = 10 ** power;
    for (const multiplier of [1, 2, 2.5, 5]) {
      const candidate = multiplier * magnitude;
      const screenSpacing = candidate * zoom;
      const difference = Math.abs(screenSpacing - targetPixels);
      if (difference < nearestDifference) {
        nearestDifference = difference;
        nearestSpacing = candidate;
      }
      if (screenSpacing < 60 || screenSpacing > 120) {
        continue;
      }
      if (difference < bestDifference) {
        bestDifference = difference;
        bestSpacing = candidate;
      }
    }
  }

  // The expanded interval family covers the supported zoom range. If a
  // transient value ever falls outside the readable band, keep the spacing
  // discrete rather than deriving a new world interval from the zoom.
  return bestDifference === Number.POSITIVE_INFINITY ? nearestSpacing : bestSpacing;
}
