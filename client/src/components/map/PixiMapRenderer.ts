import {
  Application,
  Container,
  Filter,
  Graphics,
  RenderTexture,
  Sprite,
  Text,
  Texture,
  UniformGroup,
} from 'pixi.js';
import type { Biome, BiomeStroke, Label, Marker, Path, PathGeometryType, WorldPoint } from '../../../../shared/domain';
import { biomeTexture } from '../../lib/biomeTextures';
import { mapVisualTheme } from '../../lib/mapVisualTheme';
import { destroyParchmentTextures, parchmentTextures } from '../../lib/parchmentTextures';
import { chooseGridSpacing } from '../../lib/grid';
import { pathPolyline } from '../../lib/pathGeometry';
import { isVegvisirMarker, normaliseDirectionDegrees } from '../../lib/markerIcons';
import { loadMarkerTexture, markerTexture } from '../../lib/markerTextures';
import {
  dottedPathVisualStyle,
  pathColorForVisibleBiome,
  PATH_DARK_COLOR,
} from '../../lib/pathVisualStyle';
import { orderTerrainStrokes, resolveVisibleBiomeAtPointInOrder } from '../../lib/terrainVisibility';
import {
  markerCaptionFontSizeCss,
  markerCaptionOffsetCss,
  markerCaptionVisible,
  markerRootWorldScale,
  markerVisualDiameterCss,
} from '../../lib/markerGeometry';
import { labelVisualSize } from '../../lib/labelGeometry';
import {
  loadMarkerCaptionFont,
  MARKER_CAPTION_FONT_FALLBACK,
  MARKER_CAPTION_FONT_FAMILY,
} from '../../lib/markerCaptionFont';
import type { Camera } from '../../lib/camera';

const CLASSIFICATION_LAND_COLOR = 0xff0000;
const CLASSIFICATION_OCEAN_COLOR = 0x0000ff;
const PATH_SELECTION_COLOR = 0x918066;
const HANDLE_RADIUS_CSS = 6.5;
const MAX_DOTS_PER_PATH = 6_000;
// Set locally while diagnosing Pixi render-target output. This is deliberately
// not exposed as an application control and remains disabled in normal builds.
const SHOW_CLASSIFICATION_DEBUG = false;

export interface TerrainPreview {
  mode: 'paint' | 'erase';
  biome: Biome | null;
  brushWidth: number;
  points: readonly WorldPoint[];
}

export interface BrushCursor {
  visible: boolean;
  point: WorldPoint;
  brushWidth: number;
  color: number;
}

export interface PathPreview {
  geometryType: PathGeometryType;
  strokeWidth: number;
  points: readonly WorldPoint[];
}

export interface MarkerPlacementPreview {
  markerType: string;
  point: WorldPoint;
  directionDegrees: number | null;
}

/**
 * Renders terrain into a transparent, viewport-sized composite over parchment.
 * It never represents the world itself as a bitmap: source strokes remain world
 * geometry and are replayed in order whenever the camera or terrain changes.
 */
export class PixiMapRenderer {
  private application: Application | null = null;
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private windowResizeListener: (() => void) | null = null;
  private resolutionMediaQuery: MediaQueryList | null = null;
  private resolutionMediaQueryListener: (() => void) | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private viewportResolution = 0;
  private terrainRenderFrame: number | null = null;
  private stageRenderFrame: number | null = null;
  private hydrationRedraw: 'unrequested' | 'pending' | 'done' = 'unrequested';
  private terrainTexture: RenderTexture | null = null;
  private classificationTexture: RenderTexture | null = null;
  private readonly parchment = new Graphics();
  private readonly terrainSurface = new Sprite();
  private readonly coastlineSurface = new Sprite();
  private readonly classificationDebugBackdrop = new Graphics();
  private readonly classificationDebugSurface = new Sprite();
  private readonly terrainWorld = new Container();
  private readonly terrain = new Container();
  private readonly terrainStrokes = new Container();
  private readonly terrainPreview = new Container();
  private readonly classificationWorld = new Container();
  private readonly terrainClassification = new Container();
  private readonly gridWorld = new Container();
  private readonly grid = new Graphics();
  private readonly overlayWorld = new Container();
  private readonly markerIconWorld = new Container();
  private readonly parchmentSurfaceContainer = new Container();
  private parchmentSurfaceLayers: [Graphics, Graphics, Graphics] | null = null;
  private parchmentSurfaceTextures: [Texture, Texture, Texture] | null = null;
  private readonly origin = new Graphics();
  private readonly paths = new Container();
  private readonly pathShapes = new Container();
  private readonly pathEdit = new Container();
  private readonly pathPreview = new Container();
  private readonly pathSelection = new Container();
  private readonly pathGraphics = new Map<string, Graphics>();
  private readonly markerShapes = new Container();
  private readonly markerPlacement = new Container();
  private readonly markerEdit = new Container();
  private readonly markerSelection = new Container();
  private readonly markerNodes = new Map<string, Container>();
  private readonly markerVisualNodes = new Map<string, Container>();
  private readonly markerCaptionNodes = new Map<string, Container>();
  private readonly markerEditCaption = new Container();
  private readonly labels = new Container();
  private readonly textLabels = new Container();
  private readonly labelEdit = new Container();
  private readonly labelSelection = new Container();
  private readonly labelNodes = new Map<string, Container>();
  private readonly brushCursor = new Graphics();
  private readonly coastlineUniforms = new UniformGroup({
    uCoastlineThickness: { value: 1, type: 'f32' },
    uCoastlineFeatherScale: { value: 1, type: 'f32' },
    uCoastlineCoreColor: { value: [0.19, 0.177, 0.153, 0.78], type: 'vec4<f32>' },
  });
  private coastlineFilter: Filter | null = null;
  private camera: Camera | null = null;
  private strokes: readonly BiomeStroke[] = [];
  private pathObjects: readonly Path[] = [];
  private markerObjects: readonly Marker[] = [];
  private labelObjects: readonly Label[] = [];
  private preview: TerrainPreview | null = null;
  private activePathPreview: PathPreview | null = null;
  private selectedPathId: string | null = null;
  private pathEditPreview: Path | null = null;
  private pathOpacity = 1;
  private renderedPathZoom: number | null = null;
  private selectedMarkerId: string | null = null;
  private hoveredMarkerId: string | null = null;
  private markerEditPreview: Marker | null = null;
  private markerPlacementPreview: MarkerPlacementPreview | null = null;
  private markerPlacementNode: Container | null = null;
  private markerPlacementVisual: Container | null = null;
  private selectedLabelId: string | null = null;
  private labelEditPreview: Label | null = null;
  private cursor: BrushCursor | null = null;
  private gridVisible = false;
  private initialized = false;
  private destroyed = false;

  async initialize(host: HTMLElement): Promise<void> {
    this.host = host;
    const application = new Application();
    this.application = application;

    await application.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      background: mapVisualTheme().parchmentColor,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
      autoStart: false,
    });
    this.initialized = true;

    if (this.destroyed) {
      this.destroyApplication();
      return;
    }

    application.canvas.classList.add('map-canvas');
    host.replaceChildren(application.canvas);

    this.terrain.addChild(this.terrainStrokes, this.terrainPreview);
    this.paths.addChild(this.pathShapes, this.pathEdit, this.pathPreview, this.pathSelection);
    // Marker roots remain in the camera-transformed world layer. Their visual
    // children alone receive inverse zoom compensation. Icons are separated
    // from selection/caption ink so Immersive can print icons into the paper
    // while leaving interaction/text crisp above it.
    this.markerIconWorld.addChild(this.markerShapes, this.markerPlacement, this.markerEdit, this.markerEditCaption);
    this.parchmentSurfaceContainer.eventMode = 'none';
    this.parchmentSurfaceContainer.alpha = 1;
    this.parchmentSurfaceContainer.visible = true;
    this.parchmentSurfaceContainer.renderable = true;
    this.parchmentSurfaceContainer.addChild(...this.ensureParchmentSurfaceLayers());
    this.terrainWorld.addChild(this.terrain);
    this.classificationWorld.addChild(this.terrainClassification);
    this.gridWorld.addChild(this.grid);
    this.coastlineFilter = createCoastlineFilter(this.coastlineUniforms);
    this.coastlineSurface.filters = [this.coastlineFilter];
    this.overlayWorld.addChild(
      this.paths,
      this.markerIconWorld,
      this.markerSelection,
      this.labels,
      this.textLabels,
      this.labelEdit,
      this.labelSelection,
      this.origin,
      this.brushCursor,
    );
    application.stage.addChild(
      this.parchment,
      this.terrainSurface,
      this.coastlineSurface,
      ...(SHOW_CLASSIFICATION_DEBUG
        ? [this.classificationDebugBackdrop, this.classificationDebugSurface]
        : []),
      this.gridWorld,
      this.overlayWorld,
    );
    this.addOriginIndicator();
    this.configureAppearanceLayers();
    this.rebuildTerrain();
    this.rebuildPreview();
    this.rebuildPaths();
    this.rebuildMarkers();
    this.rebuildLabels();
    void loadMarkerCaptionFont().then((loaded) => {
      if (loaded && this.initialized && !this.destroyed) {
        // Text created before FontFace completion used fallback metrics. Rebuild
        // this retained presentation layer once so final caption bounds use
        // the bundled Norse face.
        this.rebuildMarkers();
        this.rebuildLabels();
        this.requestStageRender();
      }
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.windowResizeListener = () => this.resize();
    window.addEventListener('resize', this.windowResizeListener);
    this.watchDevicePixelRatio();
    this.resize();
    this.requestStageRender();
  }

  setCamera(camera: Camera): void {
    if (
      this.application === null ||
      !Number.isFinite(camera.cameraX) ||
      !Number.isFinite(camera.cameraY) ||
      !Number.isFinite(camera.zoom) ||
      camera.zoom <= 0
    ) {
      return;
    }

    const zoomChanged = this.camera?.zoom !== camera.zoom;
    this.camera = camera;
    this.applyCameraTransform();
    // Paths themselves follow the camera container. Rebuild only to preserve
    // dot and handle dimensions in screen pixels after a zoom change.
    if (zoomChanged) {
      this.rebuildPaths();
      this.updateMarkerVisualScales();
      this.rebuildMarkerSelection();
      this.updateLabelVisualScales();
      this.rebuildLabelSelection();
    }
    this.requestStageRender();
  }

  setTerrainStrokes(strokes: readonly BiomeStroke[]): void {
    this.strokes = strokes;
    if (this.initialized) {
      this.rebuildTerrain();
      // Path dot contrast is derived from the final semantic terrain result.
      // Rebuild only the retained Paths layer; terrain replay remains unchanged.
      this.rebuildPaths();
      this.scheduleTerrainRender();
      this.requestStageRender();
    }
  }

  /** Request one follow-up replay after the hydrated terrain's first pass. */
  requestInitialTerrainRedraw(): void {
    if (this.destroyed || this.hydrationRedraw !== 'unrequested') {
      return;
    }

    this.hydrationRedraw = 'pending';
    this.scheduleTerrainRender();
  }

  setTerrainPreview(preview: TerrainPreview | null): void {
    this.preview = preview;
    if (this.initialized) {
      this.rebuildPreview();
      this.scheduleTerrainRender();
      this.requestStageRender();
    }
  }

  setPaths(paths: readonly Path[]): void {
    this.pathObjects = paths;
    if (this.initialized) {
      this.rebuildPaths();
      this.requestStageRender();
    }
  }

  setPathsOpacity(opacity: number): void {
    this.pathOpacity = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    this.pathShapes.alpha = this.pathOpacity;
    this.pathEdit.alpha = this.pathOpacity;
    this.pathPreview.alpha = this.pathOpacity;
    this.textLabels.alpha = this.pathOpacity;
    this.labelEdit.alpha = this.pathOpacity;
    if (this.initialized) {
      this.rebuildPathSelection();
    }
    this.requestStageRender();
  }

  setSelectedPath(pathId: string | null): void {
    this.selectedPathId = pathId;
    if (this.initialized) {
      this.rebuildPathSelection();
    }
    this.requestStageRender();
  }

  setPathEditPreview(path: Path | null): void {
    this.pathEditPreview = path;
    if (this.initialized) {
      this.rebuildPathEditPreview();
      this.rebuildPathSelection();
    }
    this.requestStageRender();
  }

  setPathPreview(preview: PathPreview | null): void {
    this.activePathPreview = preview;
    if (this.initialized) {
      this.rebuildPathPreview();
    }
    this.requestStageRender();
  }

  setMarkers(markers: readonly Marker[]): void {
    this.markerObjects = markers;
    if (this.initialized) {
      this.rebuildMarkers();
    }
    this.requestStageRender();
  }

  setLabels(labels: readonly Label[]): void {
    this.labelObjects = labels;
    if (this.initialized) {
      this.rebuildLabels();
    }
    this.requestStageRender();
  }

  setSelectedLabel(labelId: string | null): void {
    this.selectedLabelId = labelId;
    if (this.initialized) {
      this.rebuildLabelSelection();
    }
    this.requestStageRender();
  }

  setLabelEditPreview(label: Label | null): void {
    this.labelEditPreview = label;
    if (this.initialized) {
      this.rebuildLabels();
    }
    this.requestStageRender();
  }

  setSelectedMarker(markerId: string | null): void {
    this.selectedMarkerId = markerId;
    if (this.initialized) {
      this.rebuildMarkers();
    }
    this.requestStageRender();
  }

  /** Hover is local presentation only; Vegvisir swaps to its directional art. */
  setHoveredMarker(markerId: string | null): void {
    if (markerId === this.hoveredMarkerId) {
      return;
    }
    this.hoveredMarkerId = markerId;
    if (this.initialized) {
      this.rebuildMarkers();
    }
    this.requestStageRender();
  }

  setMarkerEditPreview(marker: Marker | null): void {
    this.markerEditPreview = marker;
    if (this.initialized) {
      this.rebuildMarkerEditPreview();
      this.rebuildMarkerSelection();
    }
    this.requestStageRender();
  }

  /** Local cursor-follow placement affordance; it is never a map object. */
  setMarkerPlacementPreview(preview: MarkerPlacementPreview | null): void {
    const previous = this.markerPlacementPreview;
    const existingNode = this.markerPlacementNode;
    this.markerPlacementPreview = preview;
    if (this.initialized) {
      const canReposition =
        preview !== null &&
        previous !== null &&
        existingNode !== null &&
        preview.markerType === previous.markerType &&
        preview.directionDegrees === previous.directionDegrees;
      if (canReposition) {
        existingNode.position.set(preview.point[0], preview.point[1]);
      } else {
        this.rebuildMarkerPlacementPreview();
      }
    }
    this.requestStageRender();
  }

  setBrushCursor(cursor: BrushCursor | null): void {
    this.cursor = cursor;
    if (this.initialized) {
      this.redrawBrushCursor();
    }
    this.requestStageRender();
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.gridWorld.visible = visible;
    if (this.initialized) {
      this.rebuildGrid();
    }
    this.requestStageRender();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.windowResizeListener !== null) {
      window.removeEventListener('resize', this.windowResizeListener);
      this.windowResizeListener = null;
    }
    this.stopWatchingDevicePixelRatio();
    if (this.terrainRenderFrame !== null) {
      cancelAnimationFrame(this.terrainRenderFrame);
      this.terrainRenderFrame = null;
    }
    if (this.stageRenderFrame !== null) {
      cancelAnimationFrame(this.stageRenderFrame);
      this.stageRenderFrame = null;
    }
    this.terrainTexture?.destroy(true);
    this.terrainTexture = null;
    this.classificationTexture?.destroy(true);
    this.classificationTexture = null;
    this.coastlineFilter?.destroy();
    this.coastlineFilter = null;
    this.parchmentSurfaceContainer.removeChildren().forEach((layer) => layer.destroy());
    this.parchmentSurfaceLayers = null;
    this.parchmentSurfaceTextures = null;
    destroyParchmentTextures();

    if (this.initialized) {
      this.destroyApplication();
      this.host?.replaceChildren();
    }
    this.host = null;
  }

  private destroyApplication(): void {
    this.application?.destroy({ removeView: true }, { children: true });
    this.application = null;
  }

  private resize(): void {
    if (this.application === null || this.host === null) {
      return;
    }

    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const devicePixelRatio = window.devicePixelRatio;
    const resolution = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
    if (
      width === this.viewportWidth &&
      height === this.viewportHeight &&
      resolution === this.viewportResolution
    ) {
      return;
    }
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.viewportResolution = resolution;

    this.application.renderer.resize(width, height, resolution);
    this.ensureRenderTextures(width, height, resolution);
    this.redrawParchment(width, height);
    this.classificationDebugBackdrop.clear().rect(0, 0, width, height).fill({ color: 0x000000 });
    this.applyCameraTransform();
    this.requestStageRender();
  }

  private watchDevicePixelRatio(): void {
    this.stopWatchingDevicePixelRatio();
    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const resolution = Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;
    const mediaQuery = window.matchMedia(`(resolution: ${resolution}dppx)`);
    const listener = (): void => {
      if (this.destroyed) {
        return;
      }
      this.stopWatchingDevicePixelRatio();
      this.resize();
      this.watchDevicePixelRatio();
    };
    mediaQuery.addEventListener('change', listener);
    this.resolutionMediaQuery = mediaQuery;
    this.resolutionMediaQueryListener = listener;
  }

  private stopWatchingDevicePixelRatio(): void {
    if (this.resolutionMediaQuery !== null && this.resolutionMediaQueryListener !== null) {
      this.resolutionMediaQuery.removeEventListener('change', this.resolutionMediaQueryListener);
    }
    this.resolutionMediaQuery = null;
    this.resolutionMediaQueryListener = null;
  }

  private ensureRenderTextures(width: number, height: number, resolution: number): void {
    if (this.application === null) {
      return;
    }

    if (this.terrainTexture === null) {
      this.terrainTexture = RenderTexture.create({
        width,
        height,
        resolution,
        dynamic: true,
        antialias: true,
      });
      this.terrainSurface.texture = this.terrainTexture;
    } else {
      this.terrainTexture.resize(width, height, resolution);
    }
    if (this.classificationTexture === null) {
      this.classificationTexture = RenderTexture.create({
        width,
        height,
        resolution,
        dynamic: true,
        antialias: false,
        scaleMode: 'nearest',
      });
      this.coastlineSurface.texture = this.classificationTexture;
      this.classificationDebugSurface.texture = this.classificationTexture;
    } else {
      this.classificationTexture.resize(width, height, resolution);
    }
    // Dynamic render textures update the Sprite view bounds directly. Keep the
    // viewport wrappers at their canonical scale rather than compensating via
    // width/height setters (which would encode a texture-size scale).
    this.terrainSurface.scale.set(1);
    this.coastlineSurface.scale.set(1);
    this.classificationDebugSurface.scale.set(1);
    // The filter samples physical classification texels. Express the desired
    // screen-consistent core in physical pixels without scaling the sprite.
    this.coastlineUniforms.uniforms.uCoastlineThickness = resolution * 2.5;
  }

  private applyCameraTransform(): void {
    if (this.application === null || this.camera === null) {
      return;
    }

    const { cameraX, cameraY, zoom } = this.camera;
    const positionX = this.application.screen.width / 2 - cameraX * zoom;
    const positionY = this.application.screen.height / 2 - cameraY * zoom;
    this.terrainWorld.scale.set(zoom);
    this.terrainWorld.position.set(positionX, positionY);
    // Both viewport render textures must replay the same world -> screen
    // transform. The final sprites themselves deliberately remain at (0, 0).
    this.classificationWorld.scale.set(zoom);
    this.classificationWorld.position.set(positionX, positionY);
    this.overlayWorld.scale.set(zoom);
    this.overlayWorld.position.set(positionX, positionY);
    this.applyImmersiveLayerTransforms(positionX, positionY, zoom);
    this.gridWorld.scale.set(zoom);
    this.gridWorld.position.set(positionX, positionY);
    this.rebuildGrid();
    this.redrawBrushCursor();
    this.scheduleTerrainRender();
    this.requestStageRender();
  }

  private configureAppearanceLayers(): void {
    if (this.application === null) {
      return;
    }

    const stage = this.application.stage;
    const theme = mapVisualTheme();
    this.coastlineUniforms.uniforms.uCoastlineCoreColor = [...theme.coastlineCore];
    this.coastlineUniforms.uniforms.uCoastlineFeatherScale = 0.4;
    const parchmentSurfaceLayers = this.ensureParchmentSurfaceLayers();
    this.parchmentSurfaceContainer.alpha = 1;
    this.parchmentSurfaceContainer.visible = true;
    this.parchmentSurfaceContainer.renderable = true;
    for (const layer of parchmentSurfaceLayers) {
      if (layer.parent !== this.parchmentSurfaceContainer) {
        this.parchmentSurfaceContainer.addChild(layer);
      }
      layer.visible = true;
    }

    if (this.markerEditCaption.parent === this.markerIconWorld) {
      this.markerIconWorld.removeChild(this.markerEditCaption);
      this.overlayWorld.addChild(this.markerEditCaption);
    }

    if (this.markerIconWorld.parent !== stage) {
      this.overlayWorld.removeChild(this.markerIconWorld);
      const gridIndex = stage.getChildIndex(this.gridWorld);
      stage.addChildAt(this.markerIconWorld, gridIndex);
    }
    if (this.parchmentSurfaceContainer.parent !== stage) {
      const gridIndex = stage.getChildIndex(this.gridWorld);
      // marker icons are inserted immediately before the grid above; insert
      // paper between those icons and the grid so grid/paths/text stay clean.
      stage.addChildAt(this.parchmentSurfaceContainer, gridIndex);
    }
    this.applyImmersiveLayerTransforms(
      this.application.screen.width / 2 - (this.camera?.cameraX ?? 0) * (this.camera?.zoom ?? 1),
      this.application.screen.height / 2 - (this.camera?.cameraY ?? 0) * (this.camera?.zoom ?? 1),
      this.camera?.zoom ?? 1,
    );
  }

  private ensureParchmentSurfaceLayers(): [Graphics, Graphics, Graphics] {
    if (this.parchmentSurfaceLayers === null) {
      const textures = parchmentTextures();
      this.parchmentSurfaceTextures = [textures.broad, textures.grain, textures.flecks];
      this.parchmentSurfaceLayers = [
        this.createParchmentLayer(textures.broad),
        this.createParchmentLayer(textures.grain),
        this.createParchmentLayer(textures.flecks),
      ];
    }
    return this.parchmentSurfaceLayers;
  }

  private applyImmersiveLayerTransforms(positionX: number, positionY: number, zoom: number): void {
    if (this.application === null || this.parchmentSurfaceLayers === null) {
      return;
    }
    this.markerIconWorld.scale.set(zoom);
    this.markerIconWorld.position.set(positionX, positionY);
    this.parchmentSurfaceContainer.scale.set(zoom);
    this.parchmentSurfaceContainer.position.set(positionX, positionY);

    const worldWidth = this.application.screen.width / zoom;
    const worldHeight = this.application.screen.height / zoom;
    const margin = 4 / zoom;
    const cameraX = this.camera?.cameraX ?? 0;
    const cameraY = this.camera?.cameraY ?? 0;
    const minX = cameraX - worldWidth / 2 - margin;
    const minY = cameraY - worldHeight / 2 - margin;
    const surfaceWidth = worldWidth + margin * 2;
    const surfaceHeight = worldHeight + margin * 2;
    for (let index = 0; index < this.parchmentSurfaceLayers.length; index += 1) {
      const layer = this.parchmentSurfaceLayers[index];
      const texture = this.parchmentSurfaceTextures?.[index];
      if (texture === undefined) {
        continue;
      }
      layer.clear().rect(minX, minY, surfaceWidth, surfaceHeight).fill({
        texture,
        textureSpace: 'global',
      });
    }
  }

  private createParchmentLayer(texture: Texture): Graphics {
    const layer = new Graphics();
    layer.eventMode = 'none';
    layer.alpha = 1;
    layer.blendMode = 'normal';
    return layer;
  }

  private redrawParchment(width: number, height: number): void {
    const theme = mapVisualTheme();
    this.parchment.clear().rect(0, 0, width, height).fill({ color: theme.parchmentColor });
  }

  private rebuildTerrain(): void {
    destroyChildren(this.terrainStrokes);
    destroyChildren(this.terrainClassification);

    const ordered = [...this.strokes].sort(
      (left, right) => left.layer - right.layer || left.orderKey - right.orderKey,
    );
    for (const stroke of ordered) {
      this.terrainStrokes.addChild(createStrokeRenderable(stroke));
      this.terrainClassification.addChild(createClassificationRenderable(stroke));
    }
  }

  private rebuildPreview(): void {
    destroyChildren(this.terrainPreview);
    if (this.preview !== null && this.preview.points.length > 0) {
      this.terrainPreview.addChild(createStrokeRenderable(this.preview));
    }
  }

  /** Rebuilds direct Paths-layer display objects only; terrain is untouched. */
  private rebuildPaths(): void {
    destroyChildren(this.pathShapes);
    this.pathGraphics.clear();
    this.renderedPathZoom = this.camera?.zoom ?? 1;
    const ordered = [...this.pathObjects]
      .filter((path) => path.deletedAt === null)
      .sort((left, right) => left.layer - right.layer || left.orderKey - right.orderKey);

    for (const path of ordered) {
      const graphic = new Graphics();
      drawDottedPath(graphic, path, this.renderedPathZoom, this.strokes, undefined, 0.92, false);
      this.pathShapes.addChild(graphic);
      this.pathGraphics.set(path.id, graphic);
    }
    this.rebuildPathEditPreview();
    this.rebuildPathPreview();
    this.rebuildPathSelection();
  }

  private rebuildPathEditPreview(): void {
    destroyChildren(this.pathEdit);
    for (const graphic of this.pathGraphics.values()) {
      graphic.visible = true;
    }
    if (this.pathEditPreview === null) {
      return;
    }
    const original = this.pathGraphics.get(this.pathEditPreview.id);
    if (original !== undefined) {
      original.visible = false;
    }
    const graphic = new Graphics();
    drawDottedPath(graphic, this.pathEditPreview, this.camera?.zoom ?? 1, this.strokes, undefined, 0.92, false);
    this.pathEdit.addChild(graphic);
  }

  private rebuildPathPreview(): void {
    destroyChildren(this.pathPreview);
    if (this.activePathPreview === null) {
      return;
    }
    const graphic = new Graphics();
    drawDottedPath(graphic, this.activePathPreview, this.camera?.zoom ?? 1, this.strokes, undefined, 0.62, false);
    this.pathPreview.addChild(graphic);
  }

  private rebuildPathSelection(): void {
    destroyChildren(this.pathSelection);
    if (this.selectedPathId === null) {
      return;
    }
    const selected =
      this.pathEditPreview?.id === this.selectedPathId
        ? this.pathEditPreview
        : this.pathObjects.find((path) => path.id === this.selectedPathId && path.deletedAt === null);
    if (selected === undefined || selected === null) {
      return;
    }

    const zoom = this.camera?.zoom ?? 1;
    const highlight = new Graphics();
    drawDottedPath(highlight, selected, zoom, this.strokes, PATH_SELECTION_COLOR, 0.38, true);
    this.pathSelection.addChild(highlight);

    if (selected.geometryType === 'freehand') {
      return;
    }
    const handles = new Graphics();
    const radius = HANDLE_RADIUS_CSS / zoom;
    for (const point of selected.points) {
      handles
        .circle(point[0], point[1], radius)
        .fill({ color: 0xf2eee4, alpha: 0.96 })
        .stroke({ color: PATH_DARK_COLOR, alpha: 0.9, width: 1.35 / zoom });
    }
    this.pathSelection.addChild(handles);
  }

  /** Rebuilds only marker presentation; terrain and paths are unaffected. */
  private rebuildMarkers(): void {
    destroyChildren(this.markerShapes);
    destroyChildren(this.labels);
    destroyChildren(this.markerEditCaption);
    this.markerNodes.clear();
    this.markerVisualNodes.clear();
    this.markerCaptionNodes.clear();
    const ordered = [...this.markerObjects]
      .filter((marker) => marker.deletedAt === null)
      .sort((left, right) => left.layer - right.layer || left.orderKey - right.orderKey);
    for (const marker of ordered) {
      const renderable = this.createMarkerRenderable(marker, this.camera?.zoom ?? 1);
      this.markerShapes.addChild(renderable.root);
      if (renderable.caption !== null) {
        this.labels.addChild(renderable.caption);
        this.markerCaptionNodes.set(marker.id, renderable.caption);
      }
      this.markerNodes.set(marker.id, renderable.root);
      this.markerVisualNodes.set(marker.id, renderable.visual);
    }
    this.rebuildMarkerEditPreview();
    this.rebuildMarkerSelection();
  }

  private rebuildMarkerEditPreview(): void {
    destroyChildren(this.markerEdit);
    destroyChildren(this.markerEditCaption);
    const captionsVisible = markerCaptionVisible(this.camera?.zoom ?? 1);
    for (const node of this.markerNodes.values()) {
      node.visible = true;
    }
    for (const caption of this.markerCaptionNodes.values()) {
      caption.visible = captionsVisible;
    }
    if (this.markerEditPreview === null) {
      return;
    }
    const original = this.markerNodes.get(this.markerEditPreview.id);
    if (original !== undefined) {
      original.visible = false;
    }
    const originalCaption = this.markerCaptionNodes.get(this.markerEditPreview.id);
    if (originalCaption !== undefined) {
      originalCaption.visible = false;
    }
    const renderable = this.createMarkerRenderable(this.markerEditPreview, this.camera?.zoom ?? 1);
    this.markerEdit.addChild(renderable.root);
    if (renderable.caption !== null) {
      this.markerEditCaption.addChild(renderable.caption);
    }
  }

  private rebuildMarkerPlacementPreview(): void {
    destroyChildren(this.markerPlacement);
    this.markerPlacementNode = null;
    this.markerPlacementVisual = null;
    if (this.markerPlacementPreview === null) {
      return;
    }
    const preview = this.markerPlacementPreview;
    const renderable = this.createMarkerRenderable({
      markerType: preview.markerType,
      x: preview.point[0],
      y: preview.point[1],
      name: null,
      sizeScale: 1,
      directionDegrees: preview.directionDegrees,
    }, this.camera?.zoom ?? 1);
    renderable.root.alpha = 0.68;
    this.markerPlacement.addChild(renderable.root);
    this.markerPlacementNode = renderable.root;
    this.markerPlacementVisual = renderable.visual;
  }

  private createMarkerRenderable(marker: MarkerVisual, zoom: number): MarkerRenderable {
    const root = new Container();
    root.position.set(marker.x, marker.y);
    const visual = new Container();
    const directionalVariant = isVegvisirMarker(marker.markerType) &&
      ('id' in marker && (marker.id === this.selectedMarkerId || marker.id === this.hoveredMarkerId));
    const icon = new Sprite(markerTexture(marker.markerType, directionalVariant));
    icon.anchor.set(0.5);
    if (isVegvisirMarker(marker.markerType)) {
      icon.rotation = (normaliseDirectionDegrees(marker.directionDegrees ?? 0) * Math.PI) / 180;
    }
    // Texture loading remains lazy and cached. Until it resolves the icon is
    // transparent; the existing retained stage is repainted once on arrival.
    void loadMarkerTexture(marker.markerType, directionalVariant)
      .then((texture) => {
        if (icon.destroyed) {
          return;
        }
        icon.texture = texture;
        // PNGs have different native dimensions. Reapply the complete
        // current camera-scale transform instead of retaining an asset-native scale
        // inside the camera-scaled marker hierarchy.
        applyMarkerVisualTransform(visual, this.camera?.zoom ?? zoom);
        this.requestStageRender();
      })
      // A bad or unavailable asset must leave a transparent marker placeholder,
      // never reject into React/Pixi's initial retained render.
      .catch(() => undefined);
    visual.addChild(icon);
    applyMarkerVisualTransform(visual, zoom);
    root.addChild(visual);
    return { root, visual, caption: createMarkerCaptionRenderable(marker, zoom) };
  }

  private rebuildMarkerSelection(): void {
    destroyChildren(this.markerSelection);
    if (this.selectedMarkerId === null) {
      return;
    }
    const selected =
      this.markerEditPreview?.id === this.selectedMarkerId
        ? this.markerEditPreview
        : this.markerObjects.find((marker) => marker.id === this.selectedMarkerId && marker.deletedAt === null);
    if (selected === undefined || selected === null) {
      return;
    }
    const zoom = this.camera?.zoom ?? 1;
    const root = new Container();
    root.position.set(selected.x, selected.y);
    const visual = new Container();
    visual.scale.set(markerRootWorldScale(zoom));
    visual
      .addChild(new Graphics()
        .circle(0, 0, markerVisualDiameterCss(zoom) * 0.68 + 4)
        .stroke({ color: 0x81745f, alpha: 0.72, width: 1.2 }));
    root.addChild(visual);
    this.markerSelection.addChild(root);
  }

  /** Labels are independent Labels-layer objects; marker captions stay separate. */
  private rebuildLabels(): void {
    destroyChildren(this.textLabels);
    destroyChildren(this.labelEdit);
    this.labelNodes.clear();
    const ordered = [...this.labelObjects]
      .filter((label) => label.deletedAt === null)
      .sort((left, right) => left.layer - right.layer || left.orderKey - right.orderKey);
    for (const label of ordered) {
      if (label.id === this.labelEditPreview?.id) {
        continue;
      }
      const root = createLabelRenderable(label, this.camera?.zoom ?? 1);
      this.textLabels.addChild(root);
      this.labelNodes.set(label.id, root);
    }
    if (this.labelEditPreview !== null) {
      this.labelEdit.addChild(createLabelRenderable(this.labelEditPreview, this.camera?.zoom ?? 1));
    }
    this.rebuildLabelSelection();
  }

  private rebuildLabelSelection(): void {
    destroyChildren(this.labelSelection);
    const draftSelected = this.selectedLabelId === null && this.labelEditPreview?.id === 'text-draft';
    if (this.selectedLabelId === null && !draftSelected) {
      return;
    }
    const selected =
      this.labelEditPreview !== null && (this.labelEditPreview.id === this.selectedLabelId || draftSelected)
        ? this.labelEditPreview
        : this.labelObjects.find((label) => label.id === this.selectedLabelId && label.deletedAt === null);
    if (selected === undefined || selected === null) {
      return;
    }
    const zoom = this.camera?.zoom ?? 1;
    const root = new Container();
    root.position.set(selected.x, selected.y);
    const visual = new Container();
    visual.scale.set(markerRootWorldScale(zoom));
    visual.rotation = (selected.rotationDegrees * Math.PI) / 180;
    const { width, height } = labelVisualSize(selected);
    visual.addChild(
      new Graphics()
        .rect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8)
        .stroke({ color: 0x81745f, alpha: 0.72, width: 1.2 }),
    );
    root.addChild(visual);
    this.labelSelection.addChild(root);
  }

  private updateMarkerVisualScales(): void {
    const zoom = this.camera?.zoom ?? 1;
    for (const marker of this.markerObjects) {
      const visual = this.markerVisualNodes.get(marker.id);
      if (visual !== undefined) {
        applyMarkerVisualTransform(visual, zoom);
      }
      const caption = this.markerCaptionNodes.get(marker.id);
      if (caption !== undefined) {
        applyMarkerCaptionTransform(caption, marker, zoom);
      }
    }
    const editRoot = this.markerEdit.children[0];
    const editVisual = editRoot?.children[0];
    if (editVisual instanceof Container && this.markerEditPreview !== null) {
      applyMarkerVisualTransform(editVisual, zoom);
    }
    const editCaption = this.markerEditCaption.children[0];
    if (editCaption instanceof Container && this.markerEditPreview !== null) {
      applyMarkerCaptionTransform(editCaption, this.markerEditPreview, zoom);
    }
    if (this.markerPlacementVisual !== null) {
      applyMarkerVisualTransform(this.markerPlacementVisual, zoom);
    }
  }

  private updateLabelVisualScales(): void {
    const zoom = this.camera?.zoom ?? 1;
    for (const node of this.labelNodes.values()) {
      node.scale.set(markerRootWorldScale(zoom));
    }
    const edit = this.labelEdit.children[0];
    if (edit instanceof Container) {
      edit.scale.set(markerRootWorldScale(zoom));
    }
  }

  private redrawBrushCursor(): void {
    this.brushCursor.clear();
    if (this.cursor === null || !this.cursor.visible) {
      this.brushCursor.visible = false;
      return;
    }

    this.brushCursor.visible = true;
    const zoom = this.camera?.zoom ?? 1;
    this.brushCursor
      .circle(this.cursor.point[0], this.cursor.point[1], this.cursor.brushWidth / 2)
      .stroke({
        color: this.cursor.color,
        alpha: 0.72,
        width: Math.max(0.75 / zoom, 0.2),
    });
  }

  /** Coalesces visible-stage presentation without keeping a permanent RAF loop. */
  private requestStageRender(): void {
    if (this.application === null || this.destroyed || this.stageRenderFrame !== null) {
      return;
    }

    this.stageRenderFrame = requestAnimationFrame(() => {
      this.stageRenderFrame = null;
      if (this.application !== null && !this.destroyed) {
        this.application.render();
      }
    });
  }

  private scheduleTerrainRender(): void {
    if (
      this.application === null ||
      this.terrainTexture === null ||
      this.terrainRenderFrame !== null
    ) {
      return;
    }

    this.terrainRenderFrame = requestAnimationFrame(() => {
      this.terrainRenderFrame = null;
      this.renderTerrainNow();
      if (this.hydrationRedraw === 'pending') {
        // Requesting alongside setTerrainStrokes would coalesce with its first
        // replay. Follow it once through the same path as a later pan/zoom.
        this.hydrationRedraw = 'done';
        this.scheduleTerrainRender();
      }
    });
  }

  private renderTerrainNow(): void {
    if (
      this.application === null ||
      this.terrainTexture === null ||
      this.classificationTexture === null ||
      this.destroyed
    ) {
      return;
    }

    this.application.renderer.render({
      container: this.terrainWorld,
      target: this.terrainTexture,
      clear: true,
      clearColor: [0, 0, 0, 0],
    });
    this.application.renderer.render({
      container: this.classificationWorld,
      target: this.classificationTexture,
      clear: true,
      clearColor: [0, 0, 0, 0],
    });
    this.requestStageRender();
  }

  private rebuildGrid(): void {
    this.grid.clear();
    if (!this.gridVisible || this.application === null || this.camera === null) {
      return;
    }

    const { cameraX, cameraY, zoom } = this.camera;
    const { width, height } = this.application.screen;
    const minX = cameraX - width / (2 * zoom);
    const maxX = cameraX + width / (2 * zoom);
    const minY = cameraY - height / (2 * zoom);
    const maxY = cameraY + height / (2 * zoom);
    const spacing = chooseGridSpacing(zoom);
    // Keep the stroke in screen-pixel units while the grid geometry remains
    // world-space. Major and origin lines retain a modest visual hierarchy.
    const lineWidth = 0.85 / zoom;
    const firstX = Math.ceil(minX / spacing) * spacing;
    const firstY = Math.ceil(minY / spacing) * spacing;
    const gridTheme = mapVisualTheme().grid;

    for (let x = firstX; x <= maxX + spacing * 0.001; x += spacing) {
      drawGridLine(this.grid, x, minY, x, maxY, spacing, lineWidth, x === 0, gridTheme);
    }
    for (let y = firstY; y <= maxY + spacing * 0.001; y += spacing) {
      drawGridLine(this.grid, minX, y, maxX, y, spacing, lineWidth, y === 0, gridTheme);
    }
  }

  private addOriginIndicator(): void {
    const color = mapVisualTheme().grid.originIndicatorColor;
    this.origin
      .clear()
      .moveTo(-12, 0)
      .lineTo(12, 0)
      .moveTo(0, -12)
      .lineTo(0, 12)
      .stroke({ color, alpha: 0.25, width: 1 })
      .circle(0, 0, 3)
      .fill({ color, alpha: 0.32 });
  }
}

type TerrainStroke = Pick<TerrainPreview, 'mode' | 'biome' | 'brushWidth' | 'points'>;
type DottedPath = Pick<Path, 'geometryType' | 'points'> | PathPreview;

type MarkerVisual = Pick<Marker, 'markerType' | 'x' | 'y' | 'name' | 'sizeScale' | 'directionDegrees'>;

interface MarkerRenderable {
  root: Container;
  visual: Container;
  caption: Container | null;
}

function createLabelRenderable(label: Label, zoom: number): Container {
  const root = new Container();
  root.position.set(label.x, label.y);
  root.scale.set(markerRootWorldScale(zoom));
  root.rotation = (label.rotationDegrees * Math.PI) / 180;
  const text = new Text({
    text: label.text,
    style: {
      fill: 0x3f3a33,
      fontFamily: `${MARKER_CAPTION_FONT_FAMILY}, ${MARKER_CAPTION_FONT_FALLBACK}`,
      fontSize: label.fontSize,
      fontWeight: 'normal',
      padding: 2,
      trim: false,
      wordWrap: false,
    },
  });
  text.anchor.set(0.5);
  root.addChild(text);
  return root;
}

function createMarkerCaptionRenderable(marker: MarkerVisual, zoom: number): Container | null {
  if (marker.name === null || marker.name.length === 0) {
    return null;
  }
  const root = new Container();
  root.position.set(marker.x, marker.y);
  const caption = new Text({
    text: marker.name,
    style: {
      fill: 0x3f3a33,
      fontFamily: `${MARKER_CAPTION_FONT_FAMILY}, ${MARKER_CAPTION_FONT_FALLBACK}`,
      fontSize: markerCaptionFontSizeCss(zoom),
      fontWeight: 'normal',
      // Captions are always one natural-width line. Padding protects Norse
      // glyph overhangs without introducing a fixed texture/crop width.
      padding: 2,
      trim: false,
      wordWrap: false,
    },
  });
  caption.anchor.set(0.5, 0);
  root.addChild(caption);
  applyMarkerCaptionTransform(root, marker, zoom);
  return root;
}

/** Assigns the retained marker visual's screen-space camera transform. */
function applyMarkerVisualTransform(visual: Container, zoom: number): void {
  visual.scale.set(markerRootWorldScale(zoom));
  const icon = visual.children[0];
  if (icon instanceof Sprite) {
    scaleMarkerSpriteToZoomScale(icon, zoom);
  }
}

/** Fits a PNG's longest native edge into the current local zoom-scaled extent. */
function scaleMarkerSpriteToZoomScale(icon: Sprite, zoom: number): void {
  const longestNativeEdge = Math.max(icon.texture.orig.width, icon.texture.orig.height, 1);
  icon.scale.set(markerVisualDiameterCss(zoom) / longestNativeEdge);
}

function applyMarkerCaptionTransform(
  root: Container,
  marker: Pick<Marker, 'x' | 'y'>,
  zoom: number,
): void {
  root.position.set(marker.x, marker.y);
  root.scale.set(markerRootWorldScale(zoom));
  const caption = root.children[0];
  if (caption instanceof Text) {
    root.visible = markerCaptionVisible(zoom);
    caption.style.fontSize = markerCaptionFontSizeCss(zoom);
    caption.position.set(0, markerCaptionOffsetCss(zoom));
  }
}

/**
 * One Graphics object per path keeps the draw tree compact. Dot coordinates
 * are calculated in world units from a CSS-pixel target, so the camera can pan
 * by transforming the Paths container without regenerating a path.
 */
function drawDottedPath(
  graphic: Graphics,
  path: DottedPath,
  zoom: number,
  terrainStrokes: readonly BiomeStroke[],
  overrideColor: number | undefined,
  alpha: number,
  highlighted: boolean,
): void {
  const points = pathPolyline(path);
  if (points.length === 0 || !Number.isFinite(zoom) || zoom <= 0) {
    return;
  }

  const { radiusWorld, spacingWorld } = dottedPathVisualStyle(zoom, highlighted);
  const orderedTerrainStrokes = overrideColor === undefined ? orderTerrainStrokes(terrainStrokes) : [];
  let nextDotAt = 0;
  let distanceBeforeSegment = 0;
  let dots = 0;

  const drawDot = (x: number, y: number) => {
    if (dots >= MAX_DOTS_PER_PATH) {
      return;
    }
    const color = overrideColor ?? pathColorForVisibleBiome(resolveVisibleBiomeAtPointInOrder(orderedTerrainStrokes, [x, y]));
    graphic.circle(x, y, radiusWorld).fill({ color, alpha });
    dots += 1;
  };

  if (points.length === 1) {
    drawDot(points[0][0], points[0][1]);
    return;
  }

  for (let index = 1; index < points.length && dots < MAX_DOTS_PER_PATH; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const deltaX = end[0] - start[0];
    const deltaY = end[1] - start[1];
    const segmentLength = Math.hypot(deltaX, deltaY);
    if (segmentLength === 0) {
      continue;
    }
    const segmentEnd = distanceBeforeSegment + segmentLength;
    while (nextDotAt <= segmentEnd && dots < MAX_DOTS_PER_PATH) {
      const along = Math.max(0, nextDotAt - distanceBeforeSegment) / segmentLength;
      drawDot(start[0] + deltaX * along, start[1] + deltaY * along);
      nextDotAt += spacingWorld;
    }
    distanceBeforeSegment = segmentEnd;
  }

  // Very short paths still need a visible endpoint rather than one isolated dot.
  if (dots === 1) {
    const end = points.at(-1)!;
    drawDot(end[0], end[1]);
  }
}

function createStrokeRenderable(stroke: TerrainStroke): Graphics {
  if (stroke.mode === 'erase') {
    const eraser = new Graphics();
    drawStrokeShape(eraser, stroke.points, stroke.brushWidth, 0xffffff);
    eraser.blendMode = 'erase';
    return eraser;
  }

  const biome = stroke.biome;
  if (biome === null) {
    throw new Error('Paint strokes require a biome.');
  }

  // Draw the procedural texture directly into the terrain render target. Using
  // a textured Graphics stroke avoids Pixi's Graphics mask pipeline, which
  // otherwise allocates stroke-bounds-sized intermediate render textures.
  // The stroke points remain absolute world coordinates and textureSpace:
  // 'global' keeps the cached biome pattern anchored to those coordinates.
  const graphic = new Graphics();
  const texture = biomeTexture(biome);
  if (stroke.points.length === 1) {
    graphic
      .circle(stroke.points[0][0], stroke.points[0][1], stroke.brushWidth / 2)
      .fill({ texture, textureSpace: 'global' });
    return graphic;
  }

  graphic.moveTo(stroke.points[0][0], stroke.points[0][1]);
  for (let index = 1; index < stroke.points.length; index += 1) {
    graphic.lineTo(stroke.points[index][0], stroke.points[index][1]);
  }
  graphic.stroke({
    texture,
    textureSpace: 'global',
    width: stroke.brushWidth,
    cap: 'round',
    join: 'round',
  });
  return graphic;
}

/**
 * Replays the same accepted chronological stroke order into a transient semantic
 * colour buffer: unknown is transparent, land is opaque red, and Ocean is
 * opaque blue. It is never saved and does not derive any meaning from palette
 * colours or biome textures.
 */
function createClassificationRenderable(stroke: TerrainStroke): Graphics {
  const graphic = new Graphics();
  if (stroke.mode === 'erase') {
    drawStrokeShape(graphic, stroke.points, stroke.brushWidth, 0xffffff);
    graphic.blendMode = 'erase';
    return graphic;
  }

  drawStrokeShape(
    graphic,
    stroke.points,
    stroke.brushWidth,
    stroke.biome === 'ocean' ? CLASSIFICATION_OCEAN_COLOR : CLASSIFICATION_LAND_COLOR,
  );
  return graphic;
}

function drawStrokeShape(
  graphic: Graphics,
  points: readonly WorldPoint[],
  brushWidth: number,
  color: number,
): void {
  if (points.length === 1) {
    graphic.circle(points[0][0], points[0][1], brushWidth / 2).fill({ color, alpha: 1 });
    return;
  }

  graphic.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index += 1) {
    graphic.lineTo(points[index][0], points[index][1]);
  }
  graphic.stroke({ color, alpha: 1, width: brushWidth, cap: 'round', join: 'round' });
  graphic.circle(points[0][0], points[0][1], brushWidth / 2).fill({ color, alpha: 1 });
  const last = points.at(-1)!;
  graphic.circle(last[0], last[1], brushWidth / 2).fill({ color, alpha: 1 });
}

function destroyChildren(container: Container): void {
  for (const child of container.removeChildren()) {
    child.destroy({ children: true });
  }
}

function drawGridLine(
  graphic: Graphics,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  spacing: number,
  width: number,
  isOrigin: boolean,
  theme: ReturnType<typeof mapVisualTheme>['grid'],
): void {
  const coordinate = fromX === toX ? fromX : fromY;
  const gridIndex = Math.round(coordinate / spacing);
  const isMajor = gridIndex !== 0 && gridIndex % 5 === 0;
  graphic
    .moveTo(fromX, fromY)
    .lineTo(toX, toY)
    .stroke({
      color: isOrigin ? theme.originColor : isMajor ? theme.majorColor : theme.normalColor,
      alpha: isOrigin ? theme.originAlpha : isMajor ? theme.majorAlpha : theme.normalAlpha,
      width: isOrigin ? width * 1.75 : isMajor ? width * 1.25 : width,
    });
}

function createCoastlineFilter(coastlineUniforms: UniformGroup): Filter {
  return Filter.from({
    gl: {
      vertex: `
        in vec2 aPosition;
        out vec2 vTextureCoord;
        uniform vec4 uInputSize;
        uniform vec4 uOutputFrame;
        uniform vec4 uOutputTexture;
        void main(void) {
          vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
          position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
          position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
          gl_Position = vec4(position, 0.0, 1.0);
          vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
        }
      `,
      fragment: `
        in vec2 vTextureCoord;
        out vec4 finalColor;
        uniform sampler2D uTexture;
        uniform vec4 uInputPixel;
        uniform float uCoastlineThickness;
        uniform float uCoastlineFeatherScale;
        uniform vec4 uCoastlineCoreColor;

        bool isLand(vec4 colour) {
          return colour.a > 0.4 && colour.r > colour.b;
        }

        bool isOcean(vec4 colour) {
          return colour.a > 0.4 && colour.b > colour.r;
        }

        bool oceanInCardinalDirections(vec2 coordinate, vec2 offset) {
          return
            isOcean(texture(uTexture, coordinate + vec2(offset.x, 0.0))) ||
            isOcean(texture(uTexture, coordinate - vec2(offset.x, 0.0))) ||
            isOcean(texture(uTexture, coordinate + vec2(0.0, offset.y))) ||
            isOcean(texture(uTexture, coordinate - vec2(0.0, offset.y)));
        }

        bool oceanInEightDirections(vec2 coordinate, vec2 offset) {
          return oceanInCardinalDirections(coordinate, offset) ||
            isOcean(texture(uTexture, coordinate + offset)) ||
            isOcean(texture(uTexture, coordinate - offset)) ||
            isOcean(texture(uTexture, coordinate + vec2(offset.x, -offset.y))) ||
            isOcean(texture(uTexture, coordinate + vec2(-offset.x, offset.y)));
        }

        void main(void) {
          vec4 centre = texture(uTexture, vTextureCoord);
          if (!isLand(centre)) {
            finalColor = vec4(0.0);
            return;
          }

          // uInputPixel.zw is the inverse physical input size. Unlike
          // uInputSize.zw, it remains a one-texel offset with autoDensity / DPR.
          vec2 sampleOffset = uInputPixel.zw * uCoastlineThickness;
          bool core = oceanInEightDirections(vTextureCoord, sampleOffset);
          // Three inexpensive four-direction bands fade the land-only shadow
          // from the core to roughly 5.7 CSS pixels into the land interior.
          bool nearShadow = oceanInCardinalDirections(vTextureCoord, sampleOffset * 1.35 * uCoastlineFeatherScale);
          bool middleShadow = oceanInCardinalDirections(vTextureCoord, sampleOffset * 2.1 * uCoastlineFeatherScale);
          bool farShadow = oceanInCardinalDirections(vTextureCoord, sampleOffset * 3.0 * uCoastlineFeatherScale);

          if (core) {
            finalColor = uCoastlineCoreColor;
          } else if (nearShadow) {
            finalColor = vec4(0.028, 0.026, 0.023, 0.14);
          } else if (middleShadow) {
            finalColor = vec4(0.015, 0.014, 0.012, 0.08);
          } else if (farShadow) {
            finalColor = vec4(0.006, 0.006, 0.005, 0.03);
          } else {
            finalColor = vec4(0.0);
          }
        }

      `,
      name: 'valheim-map-coastline',
    },
    padding: 0,
    resources: { coastlineUniforms },
  });
}
