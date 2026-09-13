import {
  Application,
  Container,
  Filter,
  Graphics,
  RenderTexture,
  Sprite,
  TilingSprite,
  UniformGroup,
} from 'pixi.js';
import type { Biome, BiomeStroke, WorldPoint } from '../../../../shared/domain';
import { MapLayer } from '../../../../shared/domain';
import { biomeTexture } from '../../lib/biomeTextures';
import { chooseGridSpacing } from '../../lib/grid';
import { strokeBoundingBox } from '../../lib/strokeGeometry';
import type { Camera } from '../../lib/camera';

const PARCHMENT_COLOR = 0xe8e1d1;
const CLASSIFICATION_LAND_COLOR = 0xff0000;
const CLASSIFICATION_OCEAN_COLOR = 0x0000ff;
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

/**
 * Renders terrain into a transparent, viewport-sized composite over parchment.
 * It never represents the world itself as a bitmap: source strokes remain world
 * geometry and are replayed in order whenever the camera or terrain changes.
 */
export class PixiMapRenderer {
  private application: Application | null = null;
  private host: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private terrainRenderFrame: number | null = null;
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
  private readonly origin = new Graphics();
  private readonly paths = new Container();
  private readonly markers = new Container();
  private readonly labels = new Container();
  private readonly brushCursor = new Graphics();
  private readonly coastlineUniforms = new UniformGroup({
    uCoastlineThickness: { value: 1, type: 'f32' },
  });
  private coastlineFilter: Filter | null = null;
  private camera: Camera | null = null;
  private strokes: readonly BiomeStroke[] = [];
  private preview: TerrainPreview | null = null;
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
      background: PARCHMENT_COLOR,
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
    });
    this.initialized = true;

    if (this.destroyed) {
      this.destroyApplication();
      return;
    }

    application.canvas.classList.add('map-canvas');
    host.replaceChildren(application.canvas);

    const layerContainers: Readonly<Record<MapLayer, Container>> = {
      [MapLayer.Terrain]: this.terrain,
      [MapLayer.Paths]: this.paths,
      [MapLayer.Markers]: this.markers,
      [MapLayer.Labels]: this.labels,
    };
    this.terrain.addChild(this.terrainStrokes, this.terrainPreview);
    this.terrainWorld.addChild(layerContainers[MapLayer.Terrain]);
    this.classificationWorld.addChild(this.terrainClassification);
    this.gridWorld.addChild(this.grid);
    this.coastlineFilter = createCoastlineFilter(this.coastlineUniforms);
    this.coastlineSurface.filters = [this.coastlineFilter];
    this.overlayWorld.addChild(
      layerContainers[MapLayer.Paths],
      layerContainers[MapLayer.Markers],
      layerContainers[MapLayer.Labels],
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
    this.rebuildTerrain();
    this.rebuildPreview();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
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

    this.camera = camera;
    this.applyCameraTransform();
  }

  setTerrainStrokes(strokes: readonly BiomeStroke[]): void {
    this.strokes = strokes;
    if (this.initialized) {
      this.rebuildTerrain();
      this.scheduleTerrainRender();
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
    }
  }

  setBrushCursor(cursor: BrushCursor | null): void {
    this.cursor = cursor;
    if (this.initialized) {
      this.redrawBrushCursor();
    }
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
    this.gridWorld.visible = visible;
    if (this.initialized) {
      this.rebuildGrid();
    }
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.terrainRenderFrame !== null) {
      cancelAnimationFrame(this.terrainRenderFrame);
      this.terrainRenderFrame = null;
    }
    this.terrainTexture?.destroy(true);
    this.terrainTexture = null;
    this.classificationTexture?.destroy(true);
    this.classificationTexture = null;
    this.coastlineFilter?.destroy();
    this.coastlineFilter = null;

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
    this.application.renderer.resize(width, height);
    this.ensureRenderTextures(width, height);
    this.parchment.clear().rect(0, 0, width, height).fill({ color: PARCHMENT_COLOR });
    this.classificationDebugBackdrop.clear().rect(0, 0, width, height).fill({ color: 0x000000 });
    this.applyCameraTransform();
    this.renderTerrainNow();
  }

  private ensureRenderTextures(width: number, height: number): void {
    if (this.application === null) {
      return;
    }

    if (this.terrainTexture === null) {
      this.terrainTexture = RenderTexture.create({
        width,
        height,
        resolution: this.application.renderer.resolution,
        antialias: true,
      });
      this.terrainSurface.texture = this.terrainTexture;
    } else {
      this.terrainTexture.resize(width, height, this.application.renderer.resolution);
    }
    if (this.classificationTexture === null) {
      this.classificationTexture = RenderTexture.create({
        width,
        height,
        resolution: this.application.renderer.resolution,
        antialias: false,
        scaleMode: 'nearest',
      });
      this.coastlineSurface.texture = this.classificationTexture;
      this.classificationDebugSurface.texture = this.classificationTexture;
    } else {
      this.classificationTexture.resize(width, height, this.application.renderer.resolution);
    }
    this.terrainSurface.width = width;
    this.terrainSurface.height = height;
    this.coastlineSurface.width = width;
    this.coastlineSurface.height = height;
    this.classificationDebugSurface.width = width;
    this.classificationDebugSurface.height = height;
    // The filter samples physical classification texels. Express the desired
    // 1.9 CSS-pixel core in physical pixels without scaling the displayed sprite.
    this.coastlineUniforms.uniforms.uCoastlineThickness = this.application.renderer.resolution * 1.9;
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
    this.gridWorld.scale.set(zoom);
    this.gridWorld.position.set(positionX, positionY);
    this.rebuildGrid();
    this.redrawBrushCursor();
    this.scheduleTerrainRender();
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
    const lineWidth = 0.65 / zoom;
    const firstX = Math.ceil(minX / spacing) * spacing;
    const firstY = Math.ceil(minY / spacing) * spacing;

    for (let x = firstX; x <= maxX + spacing * 0.001; x += spacing) {
      drawGridLine(this.grid, x, minY, x, maxY, spacing, lineWidth, x === 0);
    }
    for (let y = firstY; y <= maxY + spacing * 0.001; y += spacing) {
      drawGridLine(this.grid, minX, y, maxX, y, spacing, lineWidth, y === 0);
    }
  }

  private addOriginIndicator(): void {
    this.origin
      .moveTo(-12, 0)
      .lineTo(12, 0)
      .moveTo(0, -12)
      .lineTo(0, 12)
      .stroke({ color: 0x69705d, alpha: 0.25, width: 1 })
      .circle(0, 0, 3)
      .fill({ color: 0x69705d, alpha: 0.32 });
  }
}

type TerrainStroke = Pick<TerrainPreview, 'mode' | 'biome' | 'brushWidth' | 'points'>;

function createStrokeRenderable(stroke: TerrainStroke): Container | Graphics {
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

  const bounds = strokeBoundingBox(stroke.points, stroke.brushWidth);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const container = new Container();
  const pattern = new TilingSprite({
    texture: biomeTexture(biome),
    width,
    height,
    // Local coordinate + tile position equals world coordinate, so all strokes
    // sample one shared, immutable biome pattern instead of restarting per path.
    tilePosition: { x: bounds.minX, y: bounds.minY },
  });
  pattern.position.set(bounds.minX, bounds.minY);
  const mask = new Graphics();
  drawStrokeShape(mask, stroke.points, stroke.brushWidth, 0xffffff);
  pattern.mask = mask;
  container.addChild(pattern, mask);
  return container;
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
): void {
  const coordinate = fromX === toX ? fromX : fromY;
  const gridIndex = Math.round(coordinate / spacing);
  const isMajor = gridIndex !== 0 && gridIndex % 5 === 0;
  graphic
    .moveTo(fromX, fromY)
    .lineTo(toX, toY)
    .stroke({
      color: isOrigin ? 0x667060 : 0x788070,
      alpha: isOrigin ? 0.24 : isMajor ? 0.17 : 0.11,
      width: isOrigin ? width * 1.25 : width,
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
          bool nearShadow = oceanInCardinalDirections(vTextureCoord, sampleOffset * 1.35);
          bool middleShadow = oceanInCardinalDirections(vTextureCoord, sampleOffset * 2.1);
          bool farShadow = oceanInCardinalDirections(vTextureCoord, sampleOffset * 3.0);

          if (core) {
            // #3E3A32 at 78% opacity, stored as premultiplied RGBA.
            finalColor = vec4(0.19, 0.177, 0.153, 0.78);
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
