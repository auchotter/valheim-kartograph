import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { forEachVisiblePathDot, visibleSegmentRange } from '../client/src/lib/pathViewport.ts';
import { MapLayer, type BiomeStroke, type Path } from '../shared/domain.ts';
import {
  distanceToPath,
  distanceToPolyline,
  distanceToSegment,
  hitTestPath,
  midpoint,
  quadraticBezierPoint,
  replacePathControlPoint,
} from '../client/src/lib/pathGeometry.ts';
import {
  dottedPathVisualStyle,
  pathColorForVisibleBiome,
  textColorForVisibleBiome,
  terrainContrastClassForBiome,
  MAP_TEXT_NORMAL_COLOR,
  PATH_DARK_COLOR,
  PATH_DOT_RADIUS_CSS,
  PATH_DOT_SPACING_CSS,
  PATH_LIGHT_COLOR,
} from '../client/src/lib/pathVisualStyle.ts';
import { resolveVisibleBiomeAtPoint } from '../client/src/lib/terrainVisibility.ts';
import { initialPointerGesture, shouldClearPanSelection } from '../client/src/lib/pointerGesture.ts';
import { markerTextureUrl } from '../client/src/lib/markerIcons.ts';

const viewport = { minX: -10, minY: -10, maxX: 10, maxY: 10 };
for (const zoom of [1, 8]) {
  for (const minX of [0, 8000]) {
    const spacing = PATH_DOT_SPACING_CSS / zoom;
    const bounds = { minX, maxX: minX + 100, minY: -10, maxY: 10 };
    const dots: number[] = [];
    forEachVisiblePathDot([[0, 0], [4003, 0], [10000, 0]], spacing, bounds, 6000, x => dots.push(x));
    assert.ok(dots.length > 0, `long path visible at ${minX}, zoom ${zoom}`);
    const expected = Array.from({ length: Math.floor(10000 / spacing) + 1 }, (_, i) => i * spacing)
      .filter(x => x >= bounds.minX && x <= bounds.maxX);
    assert.deepEqual(dots, expected, 'clipped segments retain the global phase without discontinuities');
  }
}
assert.equal(forEachVisiblePathDot([[0, 0], [10000, 0]], 1, undefined, 6000, () => {}), 6000);
assert.deepEqual(visibleSegmentRange([-100, 0], [100, 0], viewport), [0.45, 0.55]);
assert.deepEqual(visibleSegmentRange([100, 0], [-100, 0], viewport), [0.45, 0.55]);
assert.deepEqual(visibleSegmentRange([0, -100], [0, 100], viewport), [0.45, 0.55]);
assert.equal(visibleSegmentRange([-100, 11], [100, 11], viewport), null);
assert.deepEqual(visibleSegmentRange([0, 0], [0, 0], viewport), [0, 1]);
// Clipping preserves the same dot indices as a complete path replay, including
// paths crossing the viewport and a nonzero phase from preceding segments.
for (const zoom of [0.05, 0.3, 1, 4, 4.25, 8]) {
  const spacing = PATH_DOT_SPACING_CSS / zoom;
  const phase = 13.7;
  const range = visibleSegmentRange([-100, 0], [100, 0], viewport)!;
  const first = Math.ceil((phase + range[0] * 200) / spacing);
  const last = Math.floor((phase + range[1] * 200) / spacing);
  const clipped = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
  const full = Array.from({ length: Math.floor((phase + 200) / spacing) + 1 }, (_, i) => i)
    .filter((i) => i * spacing >= phase && i * spacing - phase >= 90 && i * spacing - phase <= 110);
  assert.deepEqual(clipped, full, `viewport culling retains dot phase at zoom ${zoom}`);
}
import { HUD_WIDE_MIN_PX, HUD_MEDIUM_MIN_PX, hudLayoutMode, partitionHudItems } from '../client/src/lib/hudLayout.ts';

function path(overrides: Partial<Path>): Path {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    mapId: '22222222-2222-4222-8222-222222222222',
    objectType: 'path',
    layer: MapLayer.Paths,
    orderKey: 1,
    objectVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    minX: 0,
    minY: 0,
    maxX: 100,
    maxY: 100,
    pathType: 'path',
    geometryType: 'straight',
    strokeWidth: 10,
    points: [
      [0, 0],
      [100, 0],
    ],
    ...overrides,
  };
}

assert.equal(distanceToSegment([50, 10], [0, 0], [100, 0]), 10);
assert.equal(distanceToSegment([-10, 0], [0, 0], [100, 0]), 10);
assert.equal(distanceToPolyline([45, 5], [[0, 0], [50, 0], [50, 50]]), 5);

assert.deepEqual(quadraticBezierPoint([0, 0], [50, 100], [100, 0], 0), [0, 0]);
assert.deepEqual(quadraticBezierPoint([0, 0], [50, 100], [100, 0], 1), [100, 0]);
assert.deepEqual(quadraticBezierPoint([0, 0], [50, 100], [100, 0], 0.5), [50, 50]);
assert.deepEqual(midpoint([0, 0], [100, 20]), [50, 10]);

const curve = path({
  id: '33333333-3333-4333-8333-333333333333',
  geometryType: 'curve',
  points: [
    [0, 0],
    [50, 100],
    [100, 0],
  ],
});
assert.ok(distanceToPath([50, 50], curve) < 0.001, 'quadratic curve approximation should hit its midpoint');
assert.ok(distanceToPath([50, 75], curve) > 20, 'curve hit testing should reject points away from the curve');

const later = path({
  id: '44444444-4444-4444-8444-444444444444',
  orderKey: 2,
  points: [
    [0, 0],
    [100, 0],
  ],
});
assert.equal(hitTestPath([path({ orderKey: 1 }), later], [50, 4], 8)?.id, later.id);
assert.equal(hitTestPath([later], [50, 12], 8), null);

const changed = replacePathControlPoint(curve, 1, [60, 120]);
assert.deepEqual(changed.points, [
  [0, 0],
  [60, 120],
  [100, 0],
]);
assert.deepEqual(replacePathControlPoint(path({ geometryType: 'freehand' }), 0, [10, 10]), path({ geometryType: 'freehand' }));

// A 12 CSS-pixel tolerance transforms to world space with inverse zoom.
assert.equal(12 / 2, 6);
assert.equal(12 / 0.5, 24);

for (const zoom of [0.1, 0.5, 1, 4, 8]) {
  const style = dottedPathVisualStyle(zoom);
  assertClose(style.radiusWorld * zoom, PATH_DOT_RADIUS_CSS);
  assertClose(style.spacingWorld * zoom, PATH_DOT_SPACING_CSS);
}

assert.equal(pathColorForVisibleBiome(null), PATH_DARK_COLOR);
assert.equal(pathColorForVisibleBiome('mountains'), PATH_DARK_COLOR);
assert.equal(pathColorForVisibleBiome('ocean'), PATH_DARK_COLOR);
assert.equal(pathColorForVisibleBiome('deep_north'), PATH_DARK_COLOR, 'Deep North shares Mountain path contrast');
for (const biome of ['meadows', 'black_forest', 'swamp', 'plains', 'mistlands', 'ashlands', 'lava'] as const) {
  assert.equal(pathColorForVisibleBiome(biome), PATH_LIGHT_COLOR);
}

// Shared semantic contrast keeps Path classification and map text decisions
// grounded in the same resolved terrain vocabulary.
assert.equal(terrainContrastClassForBiome('mountains'), terrainContrastClassForBiome('deep_north'));
assert.equal(textColorForVisibleBiome('black_forest'), PATH_LIGHT_COLOR, 'Black Forest text uses the approved light contrast shade');
assert.equal(textColorForVisibleBiome('ashlands'), 0x322e29, 'Ashlands text is the normal text colour scaled by 0.8 per RGB channel');
assert.equal(textColorForVisibleBiome('mistlands'), 0x322e29, 'Mistlands shares Ashlands\' 20% darkened map text colour');
assert.equal(textColorForVisibleBiome('mistlands'), textColorForVisibleBiome('ashlands'));
assert.equal(textColorForVisibleBiome('meadows'), MAP_TEXT_NORMAL_COLOR);
assert.equal(textColorForVisibleBiome('mountains'), MAP_TEXT_NORMAL_COLOR);
assert.equal(textColorForVisibleBiome(null), MAP_TEXT_NORMAL_COLOR);

assert.equal(typeof readFileSync(new URL('../client/src/lib/pathVisibility.ts', import.meta.url), 'utf8'), 'string');

const utilities = ['reset-view', 'zoom-to-one', 'undo', 'redo', 'grid', 'opacity', 'protect', 'coordinate'].map((id) => ({ id }));
const tools = ['pan', 'biome_brush', 'eraser', 'path', 'marker', 'text', 'select'].map((id) => ({ id }));
// Exercise shrinking, threshold boundaries and widening; stateful controls
// must retain the same objects/handlers in both partitions.
for (const width of [2048, 1600, 1440, 1439, 1200, 900, 800, 799, 700, 320, 700, 900, 1600, 2048]) {
  const mode = hudLayoutMode(width >= HUD_WIDE_MIN_PX, width >= HUD_MEDIUM_MIN_PX);
  for (const [group, items] of [['utility', utilities], ['tools', tools]] as const) {
    const { visible, overflow } = partitionHudItems(items, mode, group);
    assert.equal(visible.length + overflow.length, items.length);
    assert.equal(new Set([...visible, ...overflow]).size, items.length);
    for (const item of items) {
      assert.equal(Number(visible.includes(item)) + Number(overflow.includes(item)), 1);
    }
    if (mode === 'wide' || (mode === 'medium' && group === 'tools')) {
      assert.deepEqual(overflow, []);
      assert.deepEqual(visible, items, 'all controls restore in original order');
    }
    if (mode === 'medium' && group === 'utility') {
      assert.deepEqual(overflow.map((item) => item.id), ['coordinate']);
    }
  }
}
assert.equal(hudLayoutMode(false, false), 'narrow');
assert.equal(hudLayoutMode(false, true), 'medium');
assert.equal(hudLayoutMode(true, true), 'wide');
const statefulControl = { id: 'opacity', action: () => undefined };
for (const mode of ['wide', 'narrow', 'medium'] as const) {
  const partition = partitionHudItems([statefulControl], mode, 'utility');
  [...partition.visible, ...partition.overflow][0].action();
}
assert.equal(typeof statefulControl.action, 'function', 'responsive movement retains the existing opacity handler');

const terrainHistory: BiomeStroke[] = [
  stroke({ orderKey: 1, mode: 'paint', biome: 'meadows' }),
  stroke({ orderKey: 2, mode: 'paint', biome: 'swamp' }),
  stroke({ orderKey: 3, mode: 'erase', biome: null }),
  stroke({ orderKey: 4, mode: 'paint', biome: 'ashlands', points: [[0, 0]] }),
];
assert.equal(resolveVisibleBiomeAtPoint(terrainHistory, [75, 0]), null, 'erase should expose parchment');
assert.equal(resolveVisibleBiomeAtPoint(terrainHistory, [0, 0]), 'ashlands', 'later paint should win after erase');
assert.equal(resolveVisibleBiomeAtPoint(terrainHistory, [1000, 1000]), null, 'unpainted terrain is parchment');
const textContrastTerrain: BiomeStroke[] = [
  stroke({ orderKey: 1, mode: 'paint', biome: 'meadows', points: [[0, 0]] }),
  stroke({ orderKey: 2, mode: 'paint', biome: 'black_forest', points: [[0, 0]] }),
  stroke({ orderKey: 3, mode: 'erase', biome: null, points: [[0, 0]] }),
  stroke({ orderKey: 4, mode: 'paint', biome: 'ashlands', points: [[0, 0]] }),
];
assert.equal(
  textColorForVisibleBiome(resolveVisibleBiomeAtPoint(textContrastTerrain, [0, 0])),
  0x322e29,
  'text contrast follows the final chronological terrain result',
);
assert.equal(
  textColorForVisibleBiome(resolveVisibleBiomeAtPoint(textContrastTerrain.slice(0, 3), [0, 0])),
  MAP_TEXT_NORMAL_COLOR,
  'erasing a contrast biome restores the normal text colour',
);
const markerTerrainTransition: BiomeStroke[] = [
  stroke({ orderKey: 1, mode: 'paint', biome: 'meadows', points: [[0, 0]] }),
];
assert.equal(
  markerTextureUrl('trade', false, resolveVisibleBiomeAtPoint(markerTerrainTransition, [0, 0])),
  '/markers/5-Trader.png',
  'a stationary Marker starts with the base artwork on Meadows',
);
markerTerrainTransition.push(stroke({ orderKey: 2, mode: 'paint', biome: 'ashlands', points: [[0, 0]] }));
assert.equal(
  markerTextureUrl('trade', false, resolveVisibleBiomeAtPoint(markerTerrainTransition, [0, 0])),
  '/markers/5-Trader-Ashlands.png',
  'a terrain repaint changes the same Marker\'s render-only artwork',
);
markerTerrainTransition.push(stroke({ orderKey: 3, mode: 'erase', biome: null, points: [[0, 0]] }));
assert.equal(
  markerTextureUrl('trade', false, resolveVisibleBiomeAtPoint(markerTerrainTransition, [0, 0])),
  '/markers/5-Trader.png',
  'an erase restores the canonical artwork at the unchanged Marker coordinate',
);

for (const tool of ['biome_brush', 'eraser', 'path', 'marker', 'select'] as const) {
  assert.equal(
    initialPointerGesture({ button: 0, spaceHeld: true, tool, markerPlacementArmed: true, pathCreationArmed: true }),
    'pan',
    `Space must pan before ${tool}`,
  );
  assert.equal(
    initialPointerGesture({ button: 1, spaceHeld: false, tool, markerPlacementArmed: true, pathCreationArmed: true }),
    'pan',
    `middle mouse must pan before ${tool}`,
  );
}
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'pan', markerPlacementArmed: false, pathCreationArmed: false }), 'pan');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'pan', markerPlacementArmed: false, pathCreationArmed: false, panObjectInteraction: true }), 'select');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: true, tool: 'pan', markerPlacementArmed: false, pathCreationArmed: false, panObjectInteraction: true }), 'pan');
assert.equal(shouldClearPanSelection({ tool: 'pan', protectEnabled: false, button: 0, spaceHeld: false, objectHit: false }), true);
assert.equal(shouldClearPanSelection({ tool: 'pan', protectEnabled: false, button: 0, spaceHeld: false, objectHit: true }), false);
assert.equal(shouldClearPanSelection({ tool: 'pan', protectEnabled: true, button: 0, spaceHeld: false, objectHit: false }), false);
assert.equal(shouldClearPanSelection({ tool: 'pan', protectEnabled: false, button: 0, spaceHeld: true, objectHit: false }), false);
assert.equal(shouldClearPanSelection({ tool: 'pan', protectEnabled: false, button: 1, spaceHeld: false, objectHit: false }), true);
assert.equal(shouldClearPanSelection({ tool: 'pan', protectEnabled: false, button: 1, spaceHeld: false, objectHit: true }), false);
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'biome_brush', markerPlacementArmed: false, pathCreationArmed: false }), 'biome-draw');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'eraser', markerPlacementArmed: false, pathCreationArmed: false }), 'erase');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'path', markerPlacementArmed: false, pathCreationArmed: true }), 'path-draw');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'path', markerPlacementArmed: false, pathCreationArmed: false }), 'select');
assert.equal(initialPointerGesture({ button: 0, spaceHeld: false, tool: 'marker', markerPlacementArmed: true, pathCreationArmed: false }), 'marker-place');

const rendererSource = readFileSync(
  new URL('../client/src/components/map/PixiMapRenderer.ts', import.meta.url),
  'utf8',
);
const workspaceSource = readFileSync(new URL('../client/src/components/MapWorkspace.tsx', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('../client/src/state/useMapSession.ts', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../client/src/styles.css', import.meta.url), 'utf8');
const dottedPathStart = rendererSource.indexOf('function drawDottedPath');
const strokeStart = rendererSource.indexOf('function createStrokeRenderable', dottedPathStart);
assert.notEqual(dottedPathStart, -1);
assert.notEqual(strokeStart, -1);
const dottedPathSource = rendererSource.slice(dottedPathStart, strokeStart);
assert.match(dottedPathSource, /resolveVisibleBiomeAtPointInOrder/);
assert.match(dottedPathSource, /pathColorForVisibleBiome/);
assert.match(dottedPathSource, /radiusWorld/);
assert.doesNotMatch(dottedPathSource, /HALO|halo|outline|Filter|RenderTexture/);
assert.doesNotMatch(dottedPathSource, /Filter|RenderTexture/);
assert.match(rendererSource, /textColorAtPoint/);
assert.match(rendererSource, /rebuildMarkers\(\);\s*\n\s*this\.rebuildLabels\(\);/);
assert.match(rendererSource, /setPathsOpacity/);
assert.match(rendererSource, /graphic\.alpha = id === this\.selectedPathId \? 1 : this\.pathOpacity/);
assert.match(rendererSource, /pathSelection/);
assert.match(canvasSourceForGestures(), /protectEnabledRef/);
assert.match(canvasSourceForGestures(), /panObjectHit/);
assert.match(canvasSourceForGestures(), /panObjectInteraction: panObjectHit/);
assert.match(canvasSourceForGestures(), /shouldClearPanSelection/);
assert.match(canvasSourceForGestures(), /selectMarker\(null\);[\s\S]*selectPath\(null\)/);
assert.match(canvasSourceForGestures(), /activePointerGestureRef/);
assert.match(canvasSourceForGestures(), /cancelActivePointerGesture/);
assert.match(canvasSourceForGestures(), /onToolChange\('pan'\)/);
assert.match(canvasSourceForGestures(), /pathCreationArmedRef/);
const pointerSource = canvasSourceForGestures();
assert.match(pointerSource, /const wasSelected = selectedPathIdRef\.current === hit\.id/);
assert.match(pointerSource, /const transferFromAnotherObject = hasSelectedObject && !wasSelected/);
assert.match(pointerSource, /if \(\(wasSelected \|\| transferFromAnotherObject\) && hit\.objectVersion > 0 && !pendingPathIdsRef\.current\.has\(hit\.id\)\)/);
assert.match(pointerSource, /pointIndex: null,[\s\S]*originalPoints: hit\.points, startWorldPoint: worldPoint/);
assert.match(pointerSource, /pathEdit\.pointIndex === null[\s\S]*pathEdit\.originalPoints\.map[\s\S]*point\[0\] \+ worldPoint\[0\] - pathEdit\.startWorldPoint\[0\][\s\S]*point\[1\] \+ worldPoint\[1\] - pathEdit\.startWorldPoint\[1\]/);
assert.ok(pointerSource.indexOf('hitSelectedControlPoint(currentSelected, worldPoint)') < pointerSource.indexOf('const hitMarker ='));
assert.match(pointerSource, /hitTestPath\(\[currentSelected\], worldPoint,[\s\S]*\?\? hitTestPath\(visibleOrSelected/);
assert.match(pointerSource, /if \(path\.geometryType === 'freehand'\) \{\s*return null;/);
assert.match(rendererSource, /selected\.geometryType === 'freehand'\s*\? selected\.points\.filter\(\(_, index\) => index === 0 \|\| index === selected\.points\.length - 1\)/);
assert.match(canvasSourceForGestures(), /drawing\.geometryType === 'freehand'/);
assert.match(canvasSourceForGestures(), /selectPath\(id\)/);
assert.match(canvasSourceForGestures(), /pathCreationArmedRef\.current = false/);
assert.match(canvasSourceForGestures(), /if \(currentTool === 'path'\)/);
assert.match(canvasSourceForGestures(), /selectPath\(null\);[\s\S]*onToolChange\('pan'\)/);
const pointerRoutingSource = pointerSource.slice(pointerSource.indexOf('const handlePointerDown'));
assert.ok(pointerRoutingSource.indexOf("if (initialGesture === 'path-draw')") < pointerRoutingSource.indexOf('const hitMarker ='), 'armed Path creation must precede Marker hit routing');
assert.ok(pointerRoutingSource.indexOf("if (initialGesture === 'path-draw')") < pointerRoutingSource.indexOf('const hitLabel ='), 'armed Path creation must precede Label hit routing');
assert.ok(pointerRoutingSource.indexOf("if (initialGesture === 'path-draw')") < pointerRoutingSource.indexOf('const hit = (currentSelected'), 'armed Path creation must precede Path hit routing');
assert.ok(pointerRoutingSource.indexOf("if (currentTool === 'text' && textCreationActiveRef.current") < pointerRoutingSource.indexOf('const hitMarker ='), 'active Text creation must precede Marker hit routing');
assert.match(sessionSource, /const removePath = useCallback\(async \(pathId: Id\): Promise<boolean>/);
assert.match(sessionSource, /const removeLabel = useCallback\(async \(labelId: Id\): Promise<boolean>/);
assert.match(workspaceSource, /const deletePath = useCallback\(async[\s\S]*await mapSession\.removePath\(pathId\)[\s\S]*if \(!deleted\) return false;[\s\S]*finishDeletedObjectInteraction\(\)/);
assert.match(workspaceSource, /const deleteLabel = useCallback\(async[\s\S]*await mapSession\.removeLabel\(labelId\)[\s\S]*if \(!deleted\) return false;[\s\S]*finishDeletedObjectInteraction\(\)/);
const deleteKeySource = pointerSource.slice(pointerSource.indexOf("event.key === 'Delete'"), pointerSource.indexOf('const onKeyUp'));
assert.doesNotMatch(deleteKeySource, /onPathSelectionChange\(null\);\s*void onPathDelete/, 'keyboard path deletion must wait for success finalization');
assert.doesNotMatch(deleteKeySource, /onLabelSelectionChange\(null\);\s*void onLabelDelete/, 'keyboard text deletion must wait for success finalization');
assert.match(deleteKeySource, /void onPathDelete\(path\.id\)/);
assert.match(deleteKeySource, /void onLabelDelete\(label\.id\)/);
assert.match(workspaceSource, /className="map-top-hud"/);
assert.match(workspaceSource, /className="map-top-hud__utility map-top-hud__utility--opacity"/);
assert.match(workspaceSource, /className="map-top-hud__tools"/);
assert.doesNotMatch(workspaceSource, /map-top-hud__right|north-indicator|AppearanceSelector/);
assert.match(workspaceSource, /<ResponsiveOverflowBar ariaLabel="Map viewport controls"/);
assert.match(workspaceSource, /<MapToolbar/);
assert.match(stylesSource, /\.map-top-hud\s*\{/);
assert.match(stylesSource, /\.map-top-hud\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?column-gap:\s*20px/);
assert.match(stylesSource, /\.map-top-hud__tools\s*\{[\s\S]*?width:\s*max-content[\s\S]*?margin-left:\s*auto[\s\S]*?justify-content:\s*flex-end/);
assert.doesNotMatch(stylesSource, /data-layout-mode='wide'\] \.map-top-hud__tools/);
assert.doesNotMatch(stylesSource, /\.map-top-hud:not\(\[data-layout-mode='wide'\]\)/);
assert.match(stylesSource, /\.map-controls\s*\{[\s\S]*?width:\s*max-content/);
assert.match(stylesSource, /\.map-menu\s*\{[\s\S]*?position:\s*relative/);
assert.match(stylesSource, /\.map-menu__panel\s*\{[\s\S]*?right:\s*auto[\s\S]*?left:\s*0/);
assert.doesNotMatch(workspaceSource, /Map:\s*\{mapSession\.currentMap/);
assert.doesNotMatch(workspaceSource, /map-indicator/);
const mapMenuSource = readFileSync(new URL('../client/src/components/MapMenu.tsx', import.meta.url), 'utf8');
assert.match(mapMenuSource, /currentMapName/);
assert.match(mapMenuSource, /title="Open the map library and manage maps"/);
assert.match(mapMenuSource, /aria-label="Open the map library and manage maps"/);
assert.match(mapMenuSource, /map-menu__toggle-label/);
assert.doesNotMatch(mapMenuSource, /☰/);
assert.match(workspaceSource, /id: 'opacity'/);
assert.match(workspaceSource, /aria-label="Opacity"/);
assert.match(workspaceSource, /<OpacityPopup/);
assert.doesNotMatch(workspaceSource, /Adjust path visibility|nextPathOpacity|pathOpacityLabel/);
assert.match(workspaceSource, /title="Prevent markers and paths from being selected while using Pan"/);
assert.match(workspaceSource, /title="Go to Valheim coordinates\. In-game, enable the console, press F5, type `pos`, and use the displayed X and Z coordinates"/);
assert.match(stylesSource, /\.responsive-overflow__dropdown\s*\{/);
assert.doesNotMatch(stylesSource, /grid-template-areas:[\s\S]*'utility'[\s\S]*'tools'/);
assert.doesNotMatch(stylesSource, /\.map-controls\s*\{[^}]*overflow-x:\s*auto/);
assert.doesNotMatch(stylesSource, /\.map-toolbar__tools\s*\{[^}]*overflow-x:\s*auto/);
const overflowSource = readFileSync(new URL('../client/src/components/ResponsiveOverflowBar.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(overflowSource, /ResizeObserver|getBoundingClientRect|measureRef|itemWidths|partitionResponsiveOverflow/);
assert.doesNotMatch(stylesSource, /responsive-overflow__measure|responsive-overflow--measuring/);
assert.match(overflowSource, /partitionHudItems/);
assert.match(overflowSource, /aria-label="More controls"/);
assert.match(overflowSource, /closeOnOutsidePointer/);
assert.match(overflowSource, /closeOnEscape/);

console.log('Path geometry and hit-testing verification passed');

function stroke(overrides: Partial<BiomeStroke>): BiomeStroke {
  const base = {
    id: crypto.randomUUID(),
    mapId: 'terrain-map',
    objectType: 'biome_stroke' as const,
    layer: MapLayer.Terrain,
    orderKey: 1,
    objectVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    minX: -100,
    minY: -100,
    maxX: 100,
    maxY: 100,
    mode: 'paint' as const,
    biome: 'meadows' as const,
    brushWidth: 100,
    points: [[-50, 0], [50, 0]],
  };
  return { ...base, ...overrides } as BiomeStroke;
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

function canvasSourceForGestures(): string {
  return readFileSync(new URL('../client/src/components/map/MapCanvas.tsx', import.meta.url), 'utf8');
}
