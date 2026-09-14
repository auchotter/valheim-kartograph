import type { MapAppearance } from './mapAppearance';

export interface MapVisualTheme {
  parchmentColor: number;
  coastlineCore: readonly [number, number, number, number];
  grid: {
    normalColor: number;
    majorColor: number;
    originColor: number;
    normalAlpha: number;
    majorAlpha: number;
    originAlpha: number;
    originIndicatorColor: number;
  };
}

export const MAP_VISUAL_THEMES: Readonly<Record<MapAppearance, MapVisualTheme>> = {
  modern: {
    parchmentColor: 0xe8e1d1,
    coastlineCore: [0.19, 0.177, 0.153, 0.78],
    grid: {
      normalColor: 0x788070,
      majorColor: 0x788070,
      originColor: 0x667060,
      normalAlpha: 0.16,
      majorAlpha: 0.24,
      originAlpha: 0.32,
      originIndicatorColor: 0x69705d,
    },
  },
  immersive: {
    parchmentColor: 0xd8bf87,
    coastlineCore: [0.294, 0.208, 0.153, 0.78],
    grid: {
      normalColor: 0x806341,
      majorColor: 0x69492f,
      originColor: 0x8e4632,
      normalAlpha: 0.18,
      majorAlpha: 0.28,
      originAlpha: 0.38,
      originIndicatorColor: 0x8e4632,
    },
  },
};

export function mapVisualTheme(appearance: MapAppearance): MapVisualTheme {
  return MAP_VISUAL_THEMES[appearance];
}
