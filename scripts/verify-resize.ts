import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RenderTexture, Sprite } from 'pixi.js';
import { worldToScreen } from '../client/src/lib/camera.ts';

const rendererSource = readFileSync(
  new URL('../client/src/components/map/PixiMapRenderer.ts', import.meta.url),
  'utf8',
);

// The viewport textures must participate in Pixi's supported dynamic-texture
// update path so sprites invalidate their cached bounds after resize.
assert.match(rendererSource, /dynamic:\s*true/);
assert.match(rendererSource, /renderer\.resize\(width, height, resolution\)/);
assert.match(rendererSource, /window\.addEventListener\('resize'/);
assert.match(rendererSource, /window\.matchMedia/);
assert.doesNotMatch(rendererSource, /terrainSurface\.width\s*=/);
assert.doesNotMatch(rendererSource, /coastlineSurface\.width\s*=/);

// Resize must use the existing coalesced replay rather than rendering once
// synchronously and once again from applyCameraTransform().
const resizeStart = rendererSource.indexOf('private resize(): void');
const ensureStart = rendererSource.indexOf('private ensureRenderTextures', resizeStart);
assert.notEqual(resizeStart, -1);
assert.notEqual(ensureStart, -1);
assert.doesNotMatch(rendererSource.slice(resizeStart, ensureStart), /this\.renderTerrainNow\(\)/);

const viewports = [
  [600, 1000],
  [1600, 900],
  [900, 900],
  [1800, 700],
] as const;

for (const resolution of [1, 2]) {
  const terrainTexture = RenderTexture.create({
    width: viewports[0][0],
    height: viewports[0][1],
    resolution,
    dynamic: true,
  });
  const coastlineTexture = RenderTexture.create({
    width: viewports[0][0],
    height: viewports[0][1],
    resolution,
    dynamic: true,
  });
  const terrainSurface = new Sprite(terrainTexture);
  const coastlineSurface = new Sprite(coastlineTexture);

  for (const [width, height] of viewports) {
    terrainTexture.resize(width, height, resolution);
    coastlineTexture.resize(width, height, resolution);
    for (const [texture, surface] of [
      [terrainTexture, terrainSurface],
      [coastlineTexture, coastlineSurface],
    ] as const) {
      assert.equal(texture.width, width);
      assert.equal(texture.height, height);
      assert.equal(texture.source.pixelWidth, Math.round(width * resolution));
      assert.equal(texture.source.pixelHeight, Math.round(height * resolution));
      assert.equal(surface.scale.x, 1);
      assert.equal(surface.scale.y, 1);
      assert.equal(surface.getLocalBounds().width, width);
      assert.equal(surface.getLocalBounds().height, height);
      assert.equal(surface.getBounds().width, width);
      assert.equal(surface.getBounds().height, height);
    }
  }

  terrainSurface.destroy();
  coastlineSurface.destroy();
  terrainTexture.destroy(true);
  coastlineTexture.destroy(true);
}

const camera = { cameraX: 1234, cameraY: -567, zoom: 2 };
for (const [width, height] of viewports) {
  const centre = worldToScreen([camera.cameraX, camera.cameraY], camera, { width, height });
  assert.equal(centre.x, width / 2);
  assert.equal(centre.y, height / 2);
}

console.log('Resize texture bounds, DPR sizing, camera-centre, and replay-lifecycle verification passed');
