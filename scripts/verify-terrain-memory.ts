import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, biomeStyle } from '../client/src/lib/biomeStyles.ts';
import { BIOME_PATTERN_SOURCE_RESOLUTION } from '../client/src/lib/biomeTextures.ts';

const rendererSource = readFileSync(
  new URL('../client/src/components/map/PixiMapRenderer.ts', import.meta.url),
  'utf8',
);
const biomeTextureSource = readFileSync(
  new URL('../client/src/lib/biomeTextures.ts', import.meta.url),
  'utf8',
);

// Terrain paint must use direct textured Graphics geometry. A mask on a
// stroke-sized TilingSprite routes through Pixi's AlphaMaskPipe and can cause
// very large pooled intermediate RenderTextures at high zoom.
assert.doesNotMatch(rendererSource, /TilingSprite/);
assert.doesNotMatch(rendererSource, /\.mask\s*=/);
assert.doesNotMatch(rendererSource, /AlphaMaskPipe/);
assert.doesNotMatch(rendererSource, /strokeBoundingBox\(/);
assert.match(rendererSource, /textureSpace:\s*'global'/);
assert.match(rendererSource, /graphic\.stroke\(\{[\s\S]*texture,/);
assert.match(rendererSource, /blendMode\s*=\s*'erase'/);

// Source patterns retain their original 192-world-unit tile while using one
// fixed 8× backing canvas. It is a biome cache, never a stroke/zoom cache.
assert.equal(BIOME_PATTERN_SOURCE_RESOLUTION, 8);
for (const biome of BIOMES) {
  assert.equal(biomeStyle(biome).tileSize, 192);
  assert.equal(biomeStyle(biome).tileSize * BIOME_PATTERN_SOURCE_RESOLUTION, 1536);
}
assert.match(biomeTextureSource, /const textureCache = new Map<Biome, Texture>\(\)/);
assert.match(biomeTextureSource, /canvas\.width = style\.tileSize \* BIOME_PATTERN_SOURCE_RESOLUTION/);
assert.match(biomeTextureSource, /canvas\.height = style\.tileSize \* BIOME_PATTERN_SOURCE_RESOLUTION/);
assert.match(biomeTextureSource, /context\.scale\(BIOME_PATTERN_SOURCE_RESOLUTION, BIOME_PATTERN_SOURCE_RESOLUTION\)/);
assert.match(biomeTextureSource, /resolution:\s*BIOME_PATTERN_SOURCE_RESOLUTION/);
assert.doesNotMatch(biomeTextureSource, /window\.devicePixelRatio|requestAnimationFrame/);

// Classification remains a direct Graphics replay and therefore follows the
// same stroke geometry without introducing a second masked paint path.
const classificationStart = rendererSource.indexOf('function createClassificationRenderable');
assert.notEqual(classificationStart, -1);
const classificationSource = rendererSource.slice(classificationStart);
assert.match(classificationSource, /function drawStrokeShape/);
assert.doesNotMatch(classificationSource, /TilingSprite|\.mask\s*=/);

console.log('Terrain memory architecture verification passed (direct textured Graphics; no stroke masks).');
