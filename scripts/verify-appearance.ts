import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_MAP_APPEARANCE,
  MAP_APPEARANCE_STORAGE_KEY,
  parseMapAppearance,
  readMapAppearanceFromStorage,
  writeMapAppearanceToStorage,
} from '../client/src/lib/mapAppearance.ts';
import { BIOME_STYLES } from '../client/src/lib/biomeStyles.ts';
import { MAP_VISUAL_THEMES } from '../client/src/lib/mapVisualTheme.ts';

assert.equal(parseMapAppearance(null), DEFAULT_MAP_APPEARANCE);
assert.equal(parseMapAppearance('{bad-json'), 'modern');
assert.equal(parseMapAppearance(JSON.stringify({ version: 2, mode: 'immersive' })), 'modern');
assert.equal(parseMapAppearance(JSON.stringify({ version: 1, mode: 'unknown' })), 'modern');
assert.equal(parseMapAppearance(JSON.stringify({ version: 1, mode: 'modern' })), 'modern');
assert.equal(parseMapAppearance(JSON.stringify({ version: 1, mode: 'immersive' })), 'immersive');

const storage = new Map<string, string>();
const adapter = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
};
writeMapAppearanceToStorage(adapter, 'immersive');
assert.deepEqual(JSON.parse(storage.get(MAP_APPEARANCE_STORAGE_KEY) ?? '{}'), { version: 1, mode: 'immersive' });
assert.equal(readMapAppearanceFromStorage(adapter), 'immersive');
assert.equal(readMapAppearanceFromStorage({ getItem: () => { throw new Error('unavailable'); }, setItem: adapter.setItem }), 'modern');
assert.doesNotThrow(() => writeMapAppearanceToStorage({ getItem: () => null, setItem: () => { throw new Error('unavailable'); } }, 'modern'));
assert.equal(MAP_VISUAL_THEMES.modern.parchmentColor, 0xe8e1d1);
assert.deepEqual(MAP_VISUAL_THEMES.modern.coastlineCore, [0.19, 0.177, 0.153, 0.78]);
assert.equal(BIOME_STYLES.meadows.baseHex, '#91A96B');
assert.equal(BIOME_STYLES.ocean.markHex, '#6F929E');

const workspaceSource = readFileSync(new URL('../client/src/components/MapWorkspace.tsx', import.meta.url), 'utf8');
const selectorSource = readFileSync(new URL('../client/src/components/AppearanceSelector.tsx', import.meta.url), 'utf8');
const appearanceSource = readFileSync(new URL('../client/src/lib/mapAppearance.ts', import.meta.url), 'utf8');
const rendererSource = readFileSync(new URL('../client/src/components/map/PixiMapRenderer.ts', import.meta.url), 'utf8');
const canvasSource = readFileSync(new URL('../client/src/components/map/MapCanvas.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
const biomeSource = readFileSync(new URL('../client/src/lib/biomeTextures.ts', import.meta.url), 'utf8');
const parchmentSource = readFileSync(new URL('../client/src/lib/parchmentTextures.ts', import.meta.url), 'utf8');

assert.match(selectorSource, /Modern/);
assert.match(selectorSource, /Immersive \(Beta\)/);
assert.match(selectorSource, /aria-label="Map appearance"/);
assert.match(appearanceSource, /window\.localStorage/);
assert.doesNotMatch(appearanceSource, /sessionStorage/);
assert.match(workspaceSource, /data-ui-mode=\{appearance\}/);
assert.match(workspaceSource, /<AppearanceSelector/);
assert.match(canvasSource, /initialize\(host, appearanceRef\.current\)/);
assert.match(canvasSource, /setAppearance\(appearance\)/);
assert.match(rendererSource, /setBiomeTextureAppearance\(appearance\)/);
assert.match(rendererSource, /destroyChildren\(this\.terrainStrokes\)/);
assert.match(rendererSource, /redrawParchment/);
assert.match(rendererSource, /private readonly parchmentSurfaceContainer = new Container\(\)/);
assert.match(rendererSource, /ensureParchmentSurfaceLayers/);
assert.match(rendererSource, /this\.parchmentSurfaceContainer\.alpha = 1/);
assert.match(rendererSource, /this\.parchmentSurfaceContainer\.visible = true/);
assert.match(rendererSource, /this\.parchmentSurfaceContainer\.renderable = true/);
assert.match(rendererSource, /this\.parchmentSurfaceContainer\.addChild\(\.\.\.this\.ensureParchmentSurfaceLayers\(\)\)/);
assert.match(rendererSource, /stage\.addChildAt\(this\.parchmentSurfaceContainer, gridIndex\)/);
assert.match(rendererSource, /textureSpace: 'global'/);
assert.doesNotMatch(rendererSource, /MeshGeometry|Shader|TilingSprite|parchmentSurface\.tilePosition|createParchmentTexture/);
assert.match(parchmentSource, /export const PARCHMENT_TEXTURE_LAYERS/);
assert.match(parchmentSource, /logicalPeriod: 3072/);
assert.match(parchmentSource, /logicalPeriod: 1103/);
assert.match(parchmentSource, /logicalPeriod: 677/);
assert.match(parchmentSource, /seed: 17_381/);
assert.match(parchmentSource, /seed: 52_917/);
assert.match(parchmentSource, /seed: 83_741/);
assert.match(parchmentSource, /Texture\.from/);
assert.match(parchmentSource, /addressMode: 'repeat'/);
assert.match(parchmentSource, /drawWrapped/);
assert.match(parchmentSource, /createImageData/);
assert.match(parchmentSource, /putImageData/);
assert.match(parchmentSource, /valueNoise/);
assert.doesNotMatch(parchmentSource, /createRadialGradient|\.ellipse\(|drawBlob/);
assert.match(parchmentSource, /const alpha = 0\.024 \+ strength \* 0\.04/);
assert.match(parchmentSource, /for \(let index = 0; index < 6000; index \+= 1\)/);
assert.match(parchmentSource, /const width = random\(\) < 0\.86 \? 1 : random\(\) < 0\.97 \? 2 : 3/);
assert.match(parchmentSource, /const length = 2 \+ random\(\) \* 4/);
assert.match(parchmentSource, /cachedTextures/);
assert.match(parchmentSource, /destroyParchmentTextures/);
assert.doesNotMatch(parchmentSource, /Shader|Mesh|TilingSprite|RenderTexture|Math\.random/);
assert.match(rendererSource, /margin = 4 \/ zoom/);
assert.match(rendererSource, /this\.requestStageRender\(\)/);
assert.match(biomeSource, /activeTextureAppearance/);
assert.match(biomeSource, /texture\.destroy\(true\)/);
assert.match(stylesSource, /\.map-workspace\[data-ui-mode='immersive'\]/);
assert.match(stylesSource, /data-ui-mode='immersive'\][\s\S]*\.utility-control[\s\S]*font-family: ValheimNorse/);

console.log('Appearance persistence and theme wiring verification passed');
