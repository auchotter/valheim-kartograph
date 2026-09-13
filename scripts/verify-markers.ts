import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Container, Graphics } from 'pixi.js';
import { MapLayer, type Marker } from '../shared/domain.ts';
import {
  MARKER_BASE_SIZE_CSS,
  MARKER_ICONS,
  MARKER_ICON_VIEWBOX,
  markerSizeAfterStep,
  markerSvgMarkup,
  normaliseDirectionDegrees,
  normaliseMarkerCaption,
  vegvisirArrowVector,
} from '../client/src/lib/markerIcons.ts';
import {
  hitTestMarker,
  markerCaptionOffsetCss,
  markerCaptionRenderedFontSizeCss,
  effectiveMarkerSizeScale,
  effectiveMarkerVisualDiameterCss,
  markerHitRadiusWorld,
  markerIconLocalScale,
  markerRenderedScreenSizeCss,
  markerRootWorldScale,
  markerVisualDiameterCss,
} from '../client/src/lib/markerGeometry.ts';
import {
  clearMarkerInteraction,
  markerSelectionAfterClick,
  toggleArmedMarkerType,
} from '../client/src/lib/markerPlacement.ts';

const TEST_WORLD_POINT = [1000, 500] as const;
const TEST_VIEWPORT_CENTER = [500, 400] as const;

const expectedMarkerTypes = [
  'death_skull', 'boss', 'trader', 'pet', 'home', 'campfire', 'circle', 'red_cross', 'green_tick', 'tent',
  'castle', 'dragon_egg', 'chest', 'portal', 'cave', 'village', 'berry', 'tree', 'mining', 'crypt', 'structure',
  'farming_garden', 'tar_pool', 'tower', 'fortress', 'ship', 'spawn', 'maypole', 'sap', 'signpost', 'vegvisir',
];
assert.equal(MARKER_ICONS.length, 31);
assert.deepEqual(MARKER_ICONS.map((icon) => icon.type), expectedMarkerTypes);
assert.equal(new Set(MARKER_ICONS.map((icon) => icon.type)).size, 31);
for (const icon of MARKER_ICONS) {
  const vector = markerSvgMarkup(icon.type);
  assert.match(vector, /viewBox="0 0 64 64"/);
  if (icon.type !== 'red_cross' && icon.type !== 'green_tick') {
    assert.doesNotMatch(vector, /#9A3F3C|#48744E/);
  }
}

assert.equal(markerVisualDiameterCss(1), MARKER_BASE_SIZE_CSS);
assert.equal(markerSizeAfterStep(1, 1), 1.25);
assert.equal(markerSizeAfterStep(0.5, -1), 0.5);
assert.equal(markerSizeAfterStep(3, 1), 3);

for (const sizeScale of [0.5, 1, 1.5, 2, 3]) {
  const storedSize = MARKER_BASE_SIZE_CSS * sizeScale;
  assert.equal(markerVisualDiameterCss(sizeScale), storedSize);
  for (const zoom of [0.1, 0.25, 0.5, 1, 2, 4, 8]) {
    const expectedScale = sizeScale < 1 ? sizeScale : 1 + (sizeScale - 1) * Math.min(1, zoom / 0.5);
    const expectedSize = MARKER_BASE_SIZE_CSS * expectedScale;
    assertClose(effectiveMarkerSizeScale(sizeScale, zoom), expectedScale);
    assertClose(effectiveMarkerVisualDiameterCss(sizeScale, zoom), expectedSize);
    assertClose(markerIconLocalScale(sizeScale, zoom), expectedSize / MARKER_ICON_VIEWBOX);
    assert.ok(markerCaptionOffsetCss(sizeScale, zoom) > expectedSize / 2);
    assertClose(markerRenderedScreenSizeCss(sizeScale, zoom), expectedSize);
    assertClose(markerRootWorldScale(zoom) * zoom, 1);
    assertClose(markerCaptionRenderedFontSizeCss(12, zoom), 12);
    assertClose(markerHitRadiusWorld(marker({ sizeScale }), zoom) * zoom, expectedSize / 2 + 9);
    const probe = actualPixiHierarchyProbe(sizeScale, zoom);
    assertClose(probe.width, expectedSize);
    assertClose(probe.centerX, TEST_VIEWPORT_CENTER[0] + TEST_WORLD_POINT[0] * zoom);
    assertClose(probe.centerY, TEST_VIEWPORT_CENTER[1] + TEST_WORLD_POINT[1] * zoom);
  }
}

const first = marker({ id: '11111111-1111-4111-8111-111111111111', orderKey: 1 });
const later = marker({ id: '22222222-2222-4222-8222-222222222222', orderKey: 2 });
assert.equal(hitTestMarker([first, later], [0, 0], 1)?.id, later.id);
assert.equal(hitTestMarker([first], [markerHitRadiusWorld(first, 2) + 1, 0], 2), null);

assert.equal(normaliseDirectionDegrees(0), 0);
assert.equal(normaliseDirectionDegrees(360), 0);
assert.equal(normaliseDirectionDegrees(-90), 270);
assertVector(vegvisirArrowVector(0, 10), [0, -10]);
assertVector(vegvisirArrowVector(90, 10), [10, 0]);
assertVector(vegvisirArrowVector(180, 10), [0, 10]);
assertVector(vegvisirArrowVector(270, 10), [-10, 0]);

assert.equal(normaliseMarkerCaption('  Home  '), 'Home');
assert.equal(normaliseMarkerCaption('   '), null);

// Placement is a local single-shot state machine, separate from persisted markers.
assert.equal(toggleArmedMarkerType(null, 'home'), 'home');
assert.equal(toggleArmedMarkerType('home', 'home'), null);
assert.equal(toggleArmedMarkerType('home', 'ship'), 'ship');
assert.equal(toggleArmedMarkerType('ship', 'home'), 'home');
assert.equal(markerSelectionAfterClick(null, 'marker-a'), 'marker-a');
assert.equal(markerSelectionAfterClick('marker-a', 'marker-a'), null);
assert.equal(markerSelectionAfterClick('marker-a', 'marker-b'), 'marker-b');
assert.deepEqual(clearMarkerInteraction(), {
  armedMarkerType: null,
  selectedMarkerId: null,
});

const canvasSource = readFileSync(
  new URL('../client/src/components/map/MapCanvas.tsx', import.meta.url),
  'utf8',
);
assert.match(canvasSource, /interface MarkerPlacementState/);
assert.match(canvasSource, /setMarkerPlacementPreview/);
assert.match(canvasSource, /markerPlacementStateRef\.current = null/);
assert.match(canvasSource, /selectMarker\(hitMarker\.id\)/);
assert.match(canvasSource, /onToolChange\('pan'\)/);
assert.match(canvasSource, /spaceHeldRef/);
assert.match(canvasSource, /activePointerGestureRef/);
assert.match(canvasSource, /selectMarker\(id\)/);
assert.match(canvasSource, /clearMarkerPlacement\(\);[\s\S]*selectMarker\(id\)/);
assert.match(canvasSource, /postPlacementMarkerSelectRef/);
assert.match(canvasSource, /toolRef\.current = 'select'/);
assert.match(canvasSource, /postPlacementSelect/);
assert.match(canvasSource, /postPlacementSelect[\s\S]*toolRef\.current = 'pan'/);
assert.match(canvasSource, /postPlacementMarkerSelectRef\.current = true;[\s\S]*toolRef\.current = 'select';[\s\S]*onToolChange\('select'\)/);
assert.match(canvasSource, /postPlacementMarkerSelectRef\.current = false;[\s\S]*toolRef\.current = 'pan';[\s\S]*onToolChange\('pan'\)/);
assert.match(canvasSource, /if \(markerType === null\) \{[\s\S]*selectMarker\(null\);[\s\S]*onToolChange\('pan'\)/);

const workspaceSource = readFileSync(
  new URL('../client/src/components/MapWorkspace.tsx', import.meta.url),
  'utf8',
);
assert.match(workspaceSource, /clearMarkerInteraction/);
assert.match(workspaceSource, /setArmedMarkerType\(null\)/);

const redCross = markerSvgMarkup('red_cross');
assert.match(redCross, /M17 17 47 47M47 17 17 47/);
assert.match(redCross, /#9A3F3C/);
assert.match(markerSvgMarkup('home'), /M15 30h34/);
assert.match(markerSvgMarkup('vegvisir', 90), /M42\.00 32\.00/);

for (const zoom of [0.1, 0.25, 0.5, 1]) {
  const measured = [1, 2, 3].map((sizeScale) => actualPixiHierarchyProbe(sizeScale, zoom).width.toFixed(2));
  const position = actualPixiHierarchyProbe(1, zoom);
  console.log(`Pixi marker bounds at zoom ${zoom}: ${measured.join(' / ')} CSS px (size 1 / 2 / 3); centre ${position.centerX.toFixed(2)},${position.centerY.toFixed(2)}`);
}
for (const zoom of [0.1, 1, 8]) {
  const position = actualPixiHierarchyProbe(1, zoom);
  console.log(`Pixi marker centre at zoom ${zoom}: ${position.centerX.toFixed(2)},${position.centerY.toFixed(2)}`);
}
console.log('Marker catalogue, geometry, and direction verification passed');

function marker(overrides: Partial<Marker>): Marker {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    mapId: '99999999-9999-4999-8999-999999999999',
    objectType: 'marker',
    layer: MapLayer.Markers,
    orderKey: 0,
    objectVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    minX: 0,
    minY: 0,
    maxX: 0,
    maxY: 0,
    markerType: 'home',
    x: 0,
    y: 0,
    name: null,
    note: null,
    sizeScale: 1,
    directionDegrees: null,
    ...overrides,
  };
}

function assertVector(actual: readonly [number, number], expected: readonly [number, number]): void {
  assert.ok(Math.abs(actual[0] - expected[0]) < 1e-9);
  assert.ok(Math.abs(actual[1] - expected[1]) < 1e-9);
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

/** Exercises the same stage -> camera-world layer -> markerRoot -> markerVisual -> icon chain used by PixiMapRenderer. */
function actualPixiHierarchyProbe(sizeScale: number, zoom: number): { width: number; centerX: number; centerY: number } {
  const stage = new Container();
  stage.position.set(TEST_VIEWPORT_CENTER[0], TEST_VIEWPORT_CENTER[1]);
  stage.scale.set(zoom);
  const markerRoot = new Container();
  markerRoot.position.set(TEST_WORLD_POINT[0], TEST_WORLD_POINT[1]);
  const markerVisual = new Container();
  markerVisual.scale.set(markerRootWorldScale(zoom));
  const icon = new Graphics()
    .rect(-MARKER_ICON_VIEWBOX / 2, -MARKER_ICON_VIEWBOX / 2, MARKER_ICON_VIEWBOX, MARKER_ICON_VIEWBOX)
    .fill({ color: 0 });
  icon.scale.set(markerIconLocalScale(sizeScale, zoom));
  markerVisual.addChild(icon);
  markerRoot.addChild(markerVisual);
  stage.addChild(markerRoot);
  const bounds = markerRoot.getBounds();
  return {
    width: bounds.width,
    centerX: (bounds.minX + bounds.maxX) / 2,
    centerY: (bounds.minY + bounds.maxY) / 2,
  };
}
