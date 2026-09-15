import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, biomeStyle } from '../client/src/lib/biomeStyles.ts';
import {
  IMMERSIVE_BIOME_PATTERN_SOURCE_RESOLUTION,
} from '../client/src/lib/biomeTextures.ts';

const rendererSource = readFileSync(
  new URL('../client/src/components/map/PixiMapRenderer.ts', import.meta.url),
  'utf8',
);
const biomeTextureSource = readFileSync(
  new URL('../client/src/lib/biomeTextures.ts', import.meta.url),
  'utf8',
);
const biomeStylesSource = readFileSync(
  new URL('../client/src/lib/biomeStyles.ts', import.meta.url),
  'utf8',
);
const parchmentSurfaceSource = readFileSync(
  new URL('../client/src/lib/parchmentTextures.ts', import.meta.url),
  'utf8',
);

// Terrain paint must use direct textured Graphics geometry. A mask on a
// stroke-sized TilingSprite routes through Pixi's AlphaMaskPipe and can cause
// very large pooled intermediate RenderTextures at high zoom.
// The Immersive parchment is a small set of world-space textured Graphics,
// not terrain stroke geometry and not a mask.
assert.doesNotMatch(rendererSource, /TilingSprite/);
assert.match(rendererSource, /private readonly parchmentSurfaceContainer = new Container\(\)/);
assert.match(rendererSource, /ensureParchmentSurfaceLayers/);
assert.doesNotMatch(rendererSource, /parchmentSurface\.tilePosition|parchmentSurface\.setSize|MeshGeometry|Shader/);
assert.doesNotMatch(rendererSource, /\.mask\s*=/);
assert.doesNotMatch(rendererSource, /AlphaMaskPipe/);
assert.doesNotMatch(rendererSource, /strokeBoundingBox\(/);
assert.match(rendererSource, /textureSpace:\s*'global'/);
assert.doesNotMatch(rendererSource, /uCoastlineQuantization|uCoastlinePhase|updateCoastlineQuantization|projectedX \* resolution|projectedY \* resolution/);
assert.match(rendererSource, /texture\(uTexture, vTextureCoord\)/);
assert.match(rendererSource, /graphic\.stroke\(\{[\s\S]*texture,/);
assert.match(rendererSource, /blendMode\s*=\s*'erase'/);

// Source patterns retain their original 192-world-unit tile and one
// fixed source shared by all strokes and zoom levels.
assert.equal(IMMERSIVE_BIOME_PATTERN_SOURCE_RESOLUTION, 0.375);
for (const biome of BIOMES) {
  assert.equal(biomeStyle(biome).tileSize, 192);
  assert.equal(biomeStyle(biome).tileSize * IMMERSIVE_BIOME_PATTERN_SOURCE_RESOLUTION, 72);
}
assert.deepEqual(
  {
    baseHex: biomeStyle('mountains').baseHex,
    markHex: biomeStyle('mountains').markHex,
    snowHex: biomeStyle('mountains').snowHex,
  },
  { baseHex: '#D2C9B5', markHex: '#938D80', snowHex: '#E9E3D3' },
);
assert.deepEqual(
  {
    baseHex: biomeStyle('deep_north').baseHex,
    markHex: biomeStyle('deep_north').markHex,
    snowHex: biomeStyle('deep_north').snowHex,
  },
  { baseHex: '#E5E0D5', markHex: '#AAA69C', snowHex: '#FAF9F5' },
);
assert.notEqual(biomeStyle('deep_north').baseHex, biomeStyle('ocean').baseHex);
assert.match(biomeTextureSource, /const textureCache = new Map<Biome, Texture>\(\)/);
assert.match(biomeTextureSource, /IMMERSIVE_BIOME_PATTERN_SOURCE_RESOLUTION = 0\.375/);
assert.match(biomeTextureSource, /canvas\.width = style\.tileSize \* sourceResolution/);
assert.match(biomeTextureSource, /canvas\.height = style\.tileSize \* sourceResolution/);
assert.match(biomeTextureSource, /context\.scale\(sourceResolution, sourceResolution\)/);
assert.match(biomeTextureSource, /resolution: sourceResolution/);
assert.match(biomeTextureSource, /const scaleMode = 'nearest' as const/);
assert.match(biomeTextureSource, /drawImmersiveBaseVariation/);
assert.match(biomeTextureSource, /for \(let index = 0; index < 3200; index \+= 1\)/);
assert.match(biomeTextureSource, /scaleMode/);
assert.match(biomeTextureSource, /const width = random\(\) < 0\.68 \? 3 : random\(\) < 0\.93 \? 4 : 5/);
assert.match(biomeTextureSource, /const height = random\(\) < 0\.2 \? 2 : random\(\) < 0\.92 \? 3 : 4/);
assert.doesNotMatch(biomeTextureSource, /window\.devicePixelRatio|requestAnimationFrame/);
assert.match(biomeStylesSource, /export const BIOME_STYLES/);

// Immersive paper uses three deterministic, cached source textures applied to
// world-space Graphics. It is not baked into each biome/stroke.
assert.match(parchmentSurfaceSource, /export const PARCHMENT_TEXTURE_LAYERS/);
assert.match(parchmentSurfaceSource, /logicalPeriod: 3072/);
assert.match(parchmentSurfaceSource, /logicalPeriod: 1103/);
assert.match(parchmentSurfaceSource, /logicalPeriod: 677/);
assert.match(parchmentSurfaceSource, /physicalSize: 768/);
assert.match(parchmentSurfaceSource, /physicalSize: 896/);
assert.match(parchmentSurfaceSource, /physicalSize: 640/);
assert.match(parchmentSurfaceSource, /seededRandom/);
assert.match(parchmentSurfaceSource, /drawWrapped/);
assert.match(parchmentSurfaceSource, /createImageData/);
assert.match(parchmentSurfaceSource, /putImageData/);
assert.match(parchmentSurfaceSource, /valueNoise/);
assert.doesNotMatch(parchmentSurfaceSource, /createRadialGradient|\.ellipse\(|drawBlob/);
assert.match(parchmentSurfaceSource, /const alpha = 0\.024 \+ strength \* 0\.04/);
assert.match(parchmentSurfaceSource, /for \(let index = 0; index < 6000; index \+= 1\)/);
assert.match(parchmentSurfaceSource, /const width = random\(\) < 0\.86 \? 1 : random\(\) < 0\.97 \? 2 : 3/);
assert.match(parchmentSurfaceSource, /const length = 2 \+ random\(\) \* 4/);
assert.match(parchmentSurfaceSource, /Texture\.from/);
assert.match(parchmentSurfaceSource, /addressMode: 'repeat'/);
assert.doesNotMatch(parchmentSurfaceSource, /Shader|Mesh|TilingSprite|RenderTexture|Filter|Math\.random/);
assert.match(rendererSource, /textureSpace: 'global'/);
assert.match(rendererSource, /private createParchmentLayer/);
assert.match(rendererSource, /destroyParchmentTextures/);
assert.match(rendererSource, /parchmentSurfaceContainer\.eventMode = 'none'/);
assert.match(rendererSource, /markerIconWorld/);
assert.match(rendererSource, /configureAppearanceLayers/);
assert.match(rendererSource, /markerEditCaption/);
const terrainRenderSource = rendererSource.slice(rendererSource.indexOf('private renderTerrainNow'));
assert.doesNotMatch(terrainRenderSource, /createParchmentTexture/);

// Classification remains a direct Graphics replay and therefore follows the
// same stroke geometry without introducing a second masked paint path.
const classificationStart = rendererSource.indexOf('function createClassificationRenderable');
assert.notEqual(classificationStart, -1);
const classificationSource = rendererSource.slice(classificationStart);
assert.match(classificationSource, /function drawStrokeShape/);
assert.doesNotMatch(classificationSource, /TilingSprite|\.mask\s*=/);

console.log('Terrain memory architecture verification passed (direct textured Graphics; no stroke masks).');
