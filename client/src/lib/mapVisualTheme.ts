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

const IMMERSIVE_MAP_VISUAL_THEME: MapVisualTheme = {
  parchmentColor: 0xd8bf87,
  coastlineCore: [0.251, 0.173, 0.129, 0.84],
  grid: {
    normalColor: 0x806341,
    majorColor: 0x69492f,
    originColor: 0x8e4632,
    normalAlpha: 0.18,
    majorAlpha: 0.28,
    originAlpha: 0.38,
    originIndicatorColor: 0x8e4632,
  },
};

export function mapVisualTheme(): MapVisualTheme {
  return IMMERSIVE_MAP_VISUAL_THEME;
}
