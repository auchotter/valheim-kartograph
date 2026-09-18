import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Container, Graphics } from 'pixi.js';
import { MapLayer, type Marker } from '../shared/domain.ts';
import {
  MARKER_BASE_SIZE_CSS,
  MARKER_ICONS,
  MARKER_ICON_VIEWBOX,
  isVegvisirMarker,
  markerIconDefinition,
  markerTextureUrl,
  normaliseDirectionDegrees,
  normaliseMarkerCaption,
} from '../client/src/lib/markerIcons.ts';
import {
  hitTestMarker,
  MARKER_CAPTION_BASE_FONT_SIZE_CSS,
  markerCaptionFontSizeCss,
  markerCaptionOffsetCss,
  markerCaptionRenderedFontSizeCss,
  markerCaptionScale,
  markerCaptionVisible,
  markerHitRadiusWorld,
  markerIconLocalScale,
  markerRenderedScreenSizeCss,
  markerRootWorldScale,
  markerVisualDiameterCss,
  markerVisualScale,
} from '../client/src/lib/markerGeometry.ts';
import { clearMarkerInteraction, markerSelectionAfterClick, toggleArmedMarkerType } from '../client/src/lib/markerPlacement.ts';

const TEST_WORLD_POINT = [1000, 500] as const;
const TEST_VIEWPORT_CENTER = [500, 400] as const;
const markerDirectory = new URL('../client/public/markers/', import.meta.url);
const suppliedPngs = readdirSync(markerDirectory)
  .filter((name) => name.endsWith('.png'))
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const expectedCatalogue: readonly [string, string][] = [
  ['home', '1-Home.png'], ['chest', '2-Chest.png'], ['campfire', '3-Campfire.png'], ['mining', '4-Mining.png'],
  ['trade', '5-Trader.png'], ['signpost', '6-Signpost.png'], ['ship', '7-Ship.png'], ['portal', '8-Portal.png'],
  ['cave-1', '9-Cave.png'], ['cave-2', '10-Cave.png'], ['fortress', '11-Fortress.png'], ['tower', '12-Tower.png'],
  ['crypt', '13-Crypt.png'], ['castle', '14-Castle.png'], ['potion', '14b-Potion.png'], ['egg', '15-Egg.png'],
  ['farm', '16-Farm.png'], ['berry', '17-Berry.png'], ['tree-1', '18-Tree.png'], ['tree-2', '19-Tree.png'],
  ['boar', '20-Boar.png'], ['chicken', '21-Chicken.png'], ['wolf', '22-Wolf.png'],
  ['sap', '26-Sap.png'], ['tar', '27-Tar.png'],
  ['vegvisir', '28-Vergvisir-1.png'], ['death', '29-Death.png'], ['boss-1', '30-Boss.png'], ['boss-2', '31-Boss.png'],
  ['helmet', '32-Helmet.png'], ['spawn', '33-Spawn.png'], ['target', '34-Target.png'], ['pin', '35-Pin.png'],
  ['positive', '36-Positive.png'], ['negative', '37-Negative.png'],
];

assert.equal(suppliedPngs.length, 39, 'the supplied marker directory must retain every PNG');
assert.equal(MARKER_ICONS.length, 35, 'Lox, Askvin, and Moose are legacy-only; Vergvisir-2 is helper artwork');
assert.deepEqual(MARKER_ICONS.map(({ type, asset }) => [type, asset]), expectedCatalogue);
assert.equal(new Set(MARKER_ICONS.map(({ type }) => type)).size, 35);
assert.equal(MARKER_ICONS.some(({ type }) => ['lox', 'askvin', 'moose'].includes(type)), false);
assert.ok(suppliedPngs.includes('28-Vergvisir-1.png'));
assert.ok(suppliedPngs.includes('28-Vergvisir-2.png'));
assert.equal(MARKER_ICONS.some(({ asset }) => asset === '28-Vergvisir-2.png'), false);
assert.equal(MARKER_ICONS.some(({ type }) => type === 'vegvisir-2'), false);
for (const icon of MARKER_ICONS) {
  assert.equal(existsSync(new URL(icon.asset, markerDirectory)), true, `${icon.asset} must exist`);
  assert.equal(markerTextureUrl(icon.type), `/markers/${icon.asset}`);
}
assert.equal(markerTextureUrl('vegvisir'), '/markers/28-Vergvisir-1.png');
assert.equal(markerTextureUrl('vegvisir', true), '/markers/28-Vergvisir-2.png');
assert.equal(isVegvisirMarker('vegvisir'), true);
assert.equal(isVegvisirMarker('home'), false);
assert.equal(markerIconDefinition('death_skull').type, 'death', 'legacy saved type compatibility remains local');
assert.equal(markerIconDefinition('lox').asset, '23-Lox.png');
assert.equal(markerIconDefinition('askvin').asset, '24-Askvin.png');
assert.equal(markerIconDefinition('moose').asset, '25-Moose.png');
assert.equal(markerTextureUrl('lox'), '/markers/23-Lox.png');
assert.equal(markerTextureUrl('askvin'), '/markers/24-Askvin.png');
assert.equal(markerTextureUrl('moose'), '/markers/25-Moose.png');
assert.equal(markerIconDefinition('unknown-legacy-marker').type, 'pin', 'unknown legacy markers have a safe visible fallback');

assert.equal(markerVisualDiameterCss(0.1), MARKER_BASE_SIZE_CSS);
const zoomScaleCases: readonly [number, number][] = [
  [0.01, 0.85], [0.049, 0.85], [0.05, 0.85], [0.06, 0.88], [0.07, 0.91], [0.08, 0.94], [0.09, 0.97],
  [0.1, 1], [0.2, 1.25], [0.3, 1.5], [0.4, 1.75], [0.5, 2],
  [0.6, 2.2], [0.75, 2.5], [0.9, 2.8], [1, 3], [2, 3], [8, 3],
];
for (const [zoom, expectedScale] of zoomScaleCases) {
  const expectedSize = MARKER_BASE_SIZE_CSS * expectedScale;
  assertClose(markerVisualScale(zoom), expectedScale);
  assertClose(markerVisualDiameterCss(zoom), expectedSize);
  assertClose(markerIconLocalScale(zoom), expectedSize / MARKER_ICON_VIEWBOX);
  assert.ok(markerCaptionOffsetCss(zoom) > expectedSize / 2);
  assertClose(markerRenderedScreenSizeCss(zoom), expectedSize);
  assertClose(markerRootWorldScale(zoom) * zoom, 1);
  assertClose(markerCaptionScale(zoom), expectedScale);
  assert.equal(markerCaptionVisible(zoom), zoom >= 0.2);
  assertClose(markerCaptionFontSizeCss(zoom), MARKER_CAPTION_BASE_FONT_SIZE_CSS * expectedScale);
  assertClose(
    markerCaptionRenderedFontSizeCss(markerCaptionFontSizeCss(zoom), zoom),
    MARKER_CAPTION_BASE_FONT_SIZE_CSS * expectedScale,
  );
  assertClose(markerHitRadiusWorld(zoom) * zoom, expectedSize / 2 + 9);
  const probe = actualPixiHierarchyProbe(zoom);
  assertClose(probe.width, expectedSize);
  assertClose(probe.centerX, TEST_VIEWPORT_CENTER[0] + TEST_WORLD_POINT[0] * zoom);
  assertClose(probe.centerY, TEST_VIEWPORT_CENTER[1] + TEST_WORLD_POINT[1] * zoom);
}

// Legacy persisted values are intentionally ignored by automatic icon sizing
// and hit testing: the zoom-only helper accepts no marker size field.
const legacySmall = marker({ id: '33333333-3333-4333-8333-333333333333', sizeScale: 0.5 });
const legacyLarge = marker({ id: '44444444-4444-4444-8444-444444444444', sizeScale: 3 });
const continuousRadius = markerHitRadiusWorld(0.75);
assert.equal(hitTestMarker([legacySmall], [continuousRadius - 1, 0], 0.75)?.id, legacySmall.id);
assert.equal(hitTestMarker([legacyLarge], [continuousRadius - 1, 0], 0.75)?.id, legacyLarge.id);

const first = marker({ id: '11111111-1111-4111-8111-111111111111', orderKey: 1 });
const later = marker({ id: '22222222-2222-4222-8222-222222222222', orderKey: 2 });
assert.equal(hitTestMarker([first, later], [0, 0], 1)?.id, later.id);
assert.equal(hitTestMarker([first], [markerHitRadiusWorld(2) + 1, 0], 2), null);

assert.equal(normaliseDirectionDegrees(0), 0, '0° is north/up');
assert.equal(normaliseDirectionDegrees(90), 90, 'positive rotation is clockwise in Pixi screen coordinates');
assert.equal(normaliseDirectionDegrees(360), 0);
assert.equal(normaliseDirectionDegrees(-90), 270);
assert.equal(normaliseMarkerCaption('  Home  '), 'Home');
assert.equal(normaliseMarkerCaption('   '), null);

assert.equal(toggleArmedMarkerType(null, 'home'), 'home');
assert.equal(toggleArmedMarkerType('home', 'home'), null);
assert.equal(toggleArmedMarkerType('home', 'ship'), 'ship');
assert.equal(markerSelectionAfterClick(null, 'marker-a'), 'marker-a');
assert.equal(markerSelectionAfterClick('marker-a', 'marker-a'), null);
assert.deepEqual(clearMarkerInteraction(), { armedMarkerType: null, selectedMarkerId: null });

const canvasSource = source('../client/src/components/map/MapCanvas.tsx');
const workspaceSource = source('../client/src/components/MapWorkspace.tsx');
const rendererSource = source('../client/src/components/map/PixiMapRenderer.ts');
const geometrySource = source('../client/src/lib/markerGeometry.ts');
const toolbarSource = source('../client/src/components/MapToolbar.tsx');
const gallerySource = source('../client/src/components/MarkerGallery.tsx');
const inspectorSource = source('../client/src/components/MarkerCaptionField.tsx');
const fontSource = source('../client/src/lib/markerCaptionFont.ts');
const stylesSource = source('../client/src/styles.css');

assert.match(canvasSource, /setMarkerPlacementPreview/);
assert.match(canvasSource, /setHoveredMarker/);
assert.match(canvasSource, /postPlacementMarkerSelectRef/);
assert.match(canvasSource, /toolRef\.current = 'select'/);
assert.match(workspaceSource, /<MarkerGallery/);
assert.match(workspaceSource, /toolsHudRef/);
assert.match(workspaceSource, /anchorRef={toolsHudRef}/);
assert.match(workspaceSource, /markerGalleryOpen/);
assert.match(workspaceSource, /markerOpacity/);
assert.match(workspaceSource, /<OpacityPopup/);
assert.match(workspaceSource, /previewVegvisirDirection/);
assert.match(workspaceSource, /commitVegvisirDirection/);
assert.doesNotMatch(workspaceSource, /MarkerPalette/);
assert.match(gallerySource, /MARKER_ICONS\.map/);
assert.match(gallerySource, /role="dialog"/);
assert.match(gallerySource, /anchorRef/);
assert.match(gallerySource, /anchor.getBoundingClientRect()/);
assert.match(gallerySource, /anchorRect.bottom \+ GALLERY_OFFSET/);
assert.match(gallerySource, /anchorRect.right/);
assert.match(gallerySource, /aria-label=\{icon\.label\}/);
assert.match(gallerySource, /document\.addEventListener\('pointerdown'.*true\)/);
assert.doesNotMatch(gallerySource, /category|Categories/i);
assert.match(rendererSource, /markerTexture\(/);
assert.match(rendererSource, /setHoveredMarker/);
assert.match(rendererSource, /directionalVariant/);
assert.match(rendererSource, /icon\.anchor\.set\(0\.5\)/);
assert.match(rendererSource, /icon\.rotation/);
assert.match(rendererSource, /normaliseDirectionDegrees/);
assert.match(rendererSource, /this\.updateMarkerVisualScales\(\);/);
assert.match(rendererSource, /scaleMarkerSpriteToZoomScale/);
assert.match(rendererSource, /markerVisualDiameterCss\(zoom\) \/ longestNativeEdge/);
assert.doesNotMatch(rendererSource, /markerIconLocalScale/);
assert.doesNotMatch(rendererSource, /drawMarkerIcon/);
const markerScaleUpdateSource = rendererSource.slice(
  rendererSource.indexOf('private updateMarkerVisualScales'),
  rendererSource.indexOf('private redrawBrushCursor'),
);
assert.match(markerScaleUpdateSource, /markerPlacementVisual/);
assert.doesNotMatch(markerScaleUpdateSource, /rebuildMarkerPlacementPreview/);
assert.doesNotMatch(inspectorSource, /markerSizeAfterStep|Decrease marker size|Increase marker size|marker-inspector__row/);
const wheelHandlerSource = canvasSource.slice(canvasSource.indexOf('const handleWheel'), canvasSource.indexOf('return ('));
assert.doesNotMatch(wheelHandlerSource, /onMarker|saveMarker|updateMarker|removeMarker/);
assert.match(toolbarSource, /VegvisirDirectionControl/);
assert.match(toolbarSource, /aria-label="Vegvisir direction"/);
assert.match(toolbarSource, /min="0"/);
assert.match(toolbarSource, /max="359"/);
assert.match(toolbarSource, /selectedVegvisir/);
assert.match(toolbarSource, /tool-context-panel__delete/);
assert.match(toolbarSource, /MarkerCaptionField/);
assert.match(toolbarSource, /selectedMarker !== null/);
assert.doesNotMatch(workspaceSource, /MarkerInspector|appearance !==/);
assert.match(inspectorSource, /export function MarkerCaptionField/);
assert.match(stylesSource, /\.marker-gallery__grid::-webkit-scrollbar/);
assert.match(stylesSource, /\.map-workspace\[data-ui-mode='immersive'\] \.marker-gallery__item \{[\s\S]*padding: calc\(var\(--immersive-px\) \* 3\.5\)/);
assert.match(stylesSource, /image-rendering: pixelated/);
assert.match(stylesSource, /\.marker-gallery__item\[aria-current='true'\]/);
assert.match(rendererSource, /MARKER_CAPTION_FONT_FAMILY/);
assert.match(rendererSource, /markerCaptionFontSizeCss\(zoom\)/);
assert.match(rendererSource, /markerCaptionVisible\(zoom\)/);
assert.match(rendererSource, /setMarkerOpacity\(opacity: number\)/);
assert.match(rendererSource, /caption\.alpha = id === this\.selectedMarkerId \? 1 : this\.markerOpacity/);
const markerPointerSource = readFileSync(new URL('../client/src/components/map/MapCanvas.tsx', import.meta.url), 'utf8');
assert.match(markerPointerSource, /if \(hitMarker\.objectVersion > 0 && !pendingMarkerIdsRef\.current\.has\(hitMarker\.id\)\) \{\s*markerDragStateRef\.current =/);
assert.doesNotMatch(markerPointerSource, /wasSelected.*hitMarker/);
assert.ok(markerPointerSource.indexOf('const hitMarker =') < markerPointerSource.indexOf('void onSelectedObjectMapClickAway()'));
assert.match(markerPointerSource, /if \(!selectedLabelHit && \(hasSelectedObject \|\| currentTool === 'marker'/);
assert.match(markerPointerSource, /grabOffset: \[worldPoint\[0\] - hitMarker\.x, worldPoint\[1\] - hitMarker\.y\]/);
assert.match(markerPointerSource, /if \(!dragging\.dragStarted \|\| !dragging\.moved\)/);
assert.doesNotMatch(rendererSource.slice(rendererSource.indexOf('setPathsOpacity(opacity: number): void'), rendererSource.indexOf('setMarkerOpacity(opacity: number): void')), /textLabels/);
assert.doesNotMatch(rendererSource, /markerCaptionFontSizeCss\(marker\.sizeScale/);
assert.match(geometrySource, /export function markerCaptionScale\(zoom: number\): number \{[\s\S]*return markerVisualScale\(zoom\)/);
assert.match(geometrySource, /return MARKER_CAPTION_BASE_FONT_SIZE_CSS \* markerCaptionScale\(zoom\)/);
assert.doesNotMatch(geometrySource, /MARKER_CAPTION_SCALE_FACTOR|MARKER_CAPTION_MIN_SCALE|MARKER_CAPTION_MAX_SCALE|clampMarkerSizeScale/);
for (const [zoom, visible] of [[0.05, false], [0.1, false], [0.15, false], [0.199, false], [0.2, true], [0.25, true], [0.5, true], [1, true]] as const) {
  assert.equal(markerCaptionVisible(zoom), visible, `caption visibility at ${zoom}`);
}
assert.match(rendererSource, /wordWrap: false/);
assert.match(rendererSource, /trim: false/);
assert.match(fontSource, /document\.fonts\s*\.load/);
assert.match(stylesSource, /font-family: ValheimNorse/);
assert.match(stylesSource, /NorseBold\.otf/);
assert.match(inspectorSource, /marker-caption-field__input/);
assert.match(inspectorSource, /captionCommitInFlightRef/);
assert.match(inspectorSource, /event\.key === 'Enter'/);
assert.match(inspectorSource, /event\.key === 'Escape'/);

console.log('PNG marker catalogue, geometry, gallery, and Vegvisir contract verification passed');

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function marker(overrides: Partial<Marker>): Marker {
  return {
    id: '00000000-0000-4000-8000-000000000000', mapId: '99999999-9999-4999-8999-999999999999',
    objectType: 'marker', layer: MapLayer.Markers, orderKey: 0, objectVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', deletedAt: null,
    minX: 0, minY: 0, maxX: 0, maxY: 0, markerType: 'home', x: 0, y: 0,
    name: null, note: null, sizeScale: 1, directionDegrees: null, ...overrides,
  };
}

function assertClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to equal ${expected}`);
}

function actualPixiHierarchyProbe(zoom: number): { width: number; centerX: number; centerY: number } {
  const stage = new Container();
  stage.position.set(TEST_VIEWPORT_CENTER[0], TEST_VIEWPORT_CENTER[1]);
  stage.scale.set(zoom);
  const markerRoot = new Container();
  markerRoot.position.set(TEST_WORLD_POINT[0], TEST_WORLD_POINT[1]);
  const markerVisual = new Container();
  markerVisual.scale.set(markerRootWorldScale(zoom));
  const icon = new Graphics().rect(-32, -32, MARKER_ICON_VIEWBOX, MARKER_ICON_VIEWBOX).fill({ color: 0 });
  icon.scale.set(markerIconLocalScale(zoom));
  markerVisual.addChild(icon);
  markerRoot.addChild(markerVisual);
  stage.addChild(markerRoot);
  const bounds = markerRoot.getBounds();
  return { width: bounds.width, centerX: (bounds.minX + bounds.maxX) / 2, centerY: (bounds.minY + bounds.maxY) / 2 };
}
