export const PATH_OPACITY_STEPS = [1, 0.5, 0] as const;
export type PathOpacity = (typeof PATH_OPACITY_STEPS)[number];

export function nextPathOpacity(opacity: PathOpacity): PathOpacity {
  const index = PATH_OPACITY_STEPS.indexOf(opacity);
  return PATH_OPACITY_STEPS[(index + 1) % PATH_OPACITY_STEPS.length];
}

export function pathOpacityLabel(opacity: PathOpacity): string {
  return `Paths ${Math.round(opacity * 100)}%`;
}
