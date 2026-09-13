import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rendererSource = readFileSync(
  new URL('../client/src/components/map/PixiMapRenderer.ts', import.meta.url),
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

// Classification remains a direct Graphics replay and therefore follows the
// same stroke geometry without introducing a second masked paint path.
const classificationStart = rendererSource.indexOf('function createClassificationRenderable');
assert.notEqual(classificationStart, -1);
const classificationSource = rendererSource.slice(classificationStart);
assert.match(classificationSource, /function drawStrokeShape/);
assert.doesNotMatch(classificationSource, /TilingSprite|\.mask\s*=/);

console.log('Terrain memory architecture verification passed (direct textured Graphics; no stroke masks).');
