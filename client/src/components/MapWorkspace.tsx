import { useCallback, useEffect, useRef, useState } from 'react';
import { type Biome, type Label, type Marker, type Path, type PathGeometryType, type WorldPoint } from '../../../shared/domain';
import { MapMenu } from './MapMenu';
import { MarkerGallery } from './MarkerGallery';
import { MapToolbar } from './MapToolbar';
import { MapCanvas, type MapCanvasHandle } from './map/MapCanvas';
import { useMapSession } from '../state/useMapSession';
import type { MapTool } from '../state/mapTool';
import { mapToValheimCoordinates } from '../lib/valheimCoordinates';
import { CoordinateNavigator } from './CoordinateNavigator';
import { ResponsiveOverflowBar, type ResponsiveOverflowItem } from './ResponsiveOverflowBar';
import { OpacityPopup } from './OpacityPopup';
import { useHudLayout } from '../state/useHudLayout';
import { clearMarkerInteraction } from '../lib/markerPlacement';
import type { PathOpacity } from '../lib/pathVisibility';
import { readMapUiPreferences, writeMapUiPreferences, type DebugCoordinateMode } from '../lib/mapUiPreferences';
import compassRoseUrl from '../assets/ui/compass-rose.png';
import { isVegvisirMarker, normaliseDirectionDegrees, normaliseMarkerCaption } from '../lib/markerIcons';
import { markerWithDirection } from '../lib/markerGeometry';
import { createOptimisticLabel, DEFAULT_LABEL_FONT_SIZE, normaliseLabelRotation, normaliseLabelText } from '../lib/labelObject';

const DEFAULT_BIOME: Biome = 'meadows';
const DEFAULT_BRUSH_WIDTH = 120;
type DebugInfoView = 'readout' | 'settings' | 'bug-report';
const APP_VERSION = 'v1.0';
const BUG_REPORT_MAILTO = `mailto:valheim-map@adg.one?subject=${encodeURIComponent('Valheim Map - Bug report')}`;

export function MapWorkspace() {
  const layoutMode = useHudLayout();
  const canvasRef = useRef<MapCanvasHandle>(null);
  const mapSession = useMapSession();
  const [cursorWorld, setCursorWorld] = useState<WorldPoint | null>(null);
  const toolsHudRef = useRef<HTMLDivElement>(null);
  const opacityButtonRef = useRef<HTMLButtonElement>(null);
  const [tool, setTool] = useState<MapTool>('pan');
  const [biome, setBiome] = useState<Biome>(DEFAULT_BIOME);
  const [brushWidth, setBrushWidth] = useState(DEFAULT_BRUSH_WIDTH);
  const [initialUiPreferences] = useState(() => readMapUiPreferences());
  const [gridVisible, setGridVisible] = useState(initialUiPreferences.gridEnabled);
  const [pathOpacity, setPathOpacity] = useState<PathOpacity>(initialUiPreferences.pathOpacity);
  const [markerOpacity, setMarkerOpacity] = useState(initialUiPreferences.markerOpacity);
  const [textOpacity, setTextOpacity] = useState(initialUiPreferences.textOpacity);
  const [protectEnabled, setProtectEnabled] = useState(initialUiPreferences.protectEnabled);
  const [pathGeometryType, setPathGeometryType] = useState<PathGeometryType>('freehand');
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [armedMarkerType, setArmedMarkerType] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
  const [markerPreview, setMarkerPreview] = useState<Marker | null>(null);
  const [labelPreview, setLabelPreview] = useState<Label | null>(null);
  const [markerCaptionDrafts, setMarkerCaptionDrafts] = useState<Record<string, string>>({});
  const [markerCaptionAutoFocusId, setMarkerCaptionAutoFocusId] = useState<string | null>(null);
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});
  const [textCreationDraft, setTextCreationDraft] = useState('');
  const [textCreationPosition, setTextCreationPosition] = useState<WorldPoint | null>(null);
  const [textCreationSize, setTextCreationSize] = useState(DEFAULT_LABEL_FONT_SIZE);
  const [markerGalleryOpen, setMarkerGalleryOpen] = useState(false);
  const [coordinateNavigatorOpen, setCoordinateNavigatorOpen] = useState(false);
  const [opacityPopupOpen, setOpacityPopupOpen] = useState(false);
  const [coordinateNavigatorAnchor, setCoordinateNavigatorAnchor] = useState<DOMRectReadOnly | null>(null);
  const [debugInfoOpen, setDebugInfoOpen] = useState(initialUiPreferences.debugOpen);
  const [debugInfoView, setDebugInfoView] = useState<DebugInfoView>('readout');
  const [debugCoordinateMode, setDebugCoordinateMode] = useState<DebugCoordinateMode>(initialUiPreferences.debugCoordinateMode);
  const debugInfoRef = useRef<HTMLDivElement>(null);
  const selectedMarkerIdRef = useRef<string | null>(null);
  // Keep the newest visible direction through the entire confirmation
  // lifecycle. `saved` prevents a slider pointer-up from issuing duplicate
  // updates while still leaving the value authoritative for click-away/Enter.
  const vegvisirDirectionPreviewRef = useRef<{ markerId: string; direction: number; saved: boolean } | null>(null);
  const labelPreviewRef = useRef<Label | null>(null);
  const textCreationCommitPromiseRef = useRef<Promise<Label | null> | null>(null);
  const labelCommitPromisesRef = useRef(new Map<string, Promise<boolean>>());
  const markerCommitPromisesRef = useRef(new Map<string, Promise<boolean>>());
  // The Marker payload currently being persisted lets confirmation avoid
  // replaying an identical caption/direction update that pointerdown/blur has
  // already started.
  const markerCommitDraftsRef = useRef(new Map<string, Marker>());
  const pathCommitPromisesRef = useRef(new Map<string, Promise<boolean>>());
  const confirmationInFlightRef = useRef(false);
  const textCreationConfirmInFlightRef = useRef(false);

  const setLabelPreviewState = useCallback((preview: Label | null) => {
    labelPreviewRef.current = preview;
    setLabelPreview(preview);
  }, []);

  useEffect(() => {
    writeMapUiPreferences({
      pathOpacity,
      markerOpacity,
      textOpacity,
      protectEnabled,
      gridEnabled: gridVisible,
      debugOpen: debugInfoOpen,
      debugCoordinateMode,
    });
  }, [debugCoordinateMode, debugInfoOpen, gridVisible, markerOpacity, pathOpacity, protectEnabled, textOpacity]);

  const closeDebugInfo = useCallback(() => {
    setDebugInfoOpen(false);
    setDebugInfoView('readout');
  }, []);

  useEffect(() => {
    if (!debugInfoOpen) return undefined;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // A transient popup owns its own Escape before the persistent Debug
      // shell. Debug never turns that key into an outer-shell close.
      if (opacityPopupOpen || markerGalleryOpen || coordinateNavigatorOpen || document.querySelector('[role="listbox"]')) return;
      if (debugInfoView === 'bug-report') {
        event.preventDefault();
        event.stopPropagation();
        setDebugInfoView('settings');
      } else if (debugInfoView === 'settings') {
        event.preventDefault();
        event.stopPropagation();
        setDebugInfoView('readout');
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [coordinateNavigatorOpen, debugInfoOpen, debugInfoView, markerGalleryOpen, opacityPopupOpen]);

  useEffect(() => {
    const cleared = clearMarkerInteraction();
    setSelectedPathId(null);
    setSelectedMarkerId(cleared.selectedMarkerId);
    selectedMarkerIdRef.current = cleared.selectedMarkerId;
    setSelectedLabelId(null);
    setMarkerPreview(null);
    setLabelPreviewState(null);
    setArmedMarkerType(cleared.armedMarkerType);
    setMarkerCaptionDrafts({});
    setLabelDrafts({});
    setTextCreationDraft('');
    setTextCreationPosition(null);
    setTextCreationSize(DEFAULT_LABEL_FONT_SIZE);
    setMarkerGalleryOpen(false);
    vegvisirDirectionPreviewRef.current = null;
    setMarkerCaptionAutoFocusId(null);
  }, [mapSession.currentMap?.id, setLabelPreviewState]);

  const enterNeutralPan = useCallback(() => {
    setTool('pan');
    setMarkerGalleryOpen(false);
    const cleared = clearMarkerInteraction();
    setArmedMarkerType(cleared.armedMarkerType);
    setSelectedMarkerId(cleared.selectedMarkerId);
    selectedMarkerIdRef.current = cleared.selectedMarkerId;
    setSelectedLabelId(null);
    setSelectedPathId(null);
    setMarkerPreview(null);
    setLabelPreviewState(null);
    setTextCreationDraft('');
    setTextCreationPosition(null);
    setLabelDrafts({});
    vegvisirDirectionPreviewRef.current = null;
    setMarkerCaptionAutoFocusId(null);
  }, [setLabelPreviewState]);

  const finishDeletedObjectInteraction = useCallback(() => {
    enterNeutralPan();
    canvasRef.current?.focus();
  }, [enterNeutralPan]);

  const cancelTextCreation = useCallback(() => {
    setTextCreationDraft('');
    setTextCreationPosition(null);
    setTextCreationSize(DEFAULT_LABEL_FONT_SIZE);
    setLabelPreviewState(null);
  }, [setLabelPreviewState]);

  const changeTool = useCallback((nextTool: MapTool) => {
    if (nextTool === 'pan') {
      enterNeutralPan();
      return;
    }
    if (nextTool !== 'text') {
      cancelTextCreation();
    }
    setTool(nextTool);
    setMarkerGalleryOpen(nextTool === 'marker');
    if (nextTool !== 'marker') {
      setArmedMarkerType(null);
    }
    if (nextTool === 'biome_brush' || nextTool === 'eraser' || nextTool === 'path') {
      const cleared = clearMarkerInteraction();
      setSelectedMarkerId(cleared.selectedMarkerId);
      selectedMarkerIdRef.current = cleared.selectedMarkerId;
      setMarkerPreview(null);
    }
  }, [cancelTextCreation, enterNeutralPan]);

  const selectMarkerGalleryItem = useCallback((markerType: string) => {
    setTool('marker');
    setArmedMarkerType(markerType);
    setMarkerGalleryOpen(false);
  }, []);

  const closeMarkerGallery = useCallback(() => {
    setMarkerGalleryOpen(false);
  }, []);

  const cancelMarkerGalleryAndReturnToPan = useCallback(() => {
    // Unlike unrelated transient popups, the Gallery is part of the Marker
    // placement workflow. One Escape abandons that workflow completely.
    enterNeutralPan();
    canvasRef.current?.focus();
  }, [enterNeutralPan]);

  const disarmMarkerPlacement = useCallback(() => {
    setArmedMarkerType(null);
  }, []);

  const selectPath = useCallback((pathId: string | null) => {
    setSelectedPathId(pathId);
    if (pathId !== null) {
      setSelectedMarkerId(null);
      selectedMarkerIdRef.current = null;
      setMarkerPreview(null);
      vegvisirDirectionPreviewRef.current = null;
      setMarkerCaptionAutoFocusId(null);
      setSelectedLabelId(null);
      setLabelPreviewState(null);
    }
  }, [setLabelPreviewState]);

  const selectMarker = useCallback((markerId: string | null) => {
    const previousMarkerId = selectedMarkerIdRef.current;
    setSelectedMarkerId(markerId);
    selectedMarkerIdRef.current = markerId;
    if (markerId !== previousMarkerId) {
      vegvisirDirectionPreviewRef.current = null;
    }
    setMarkerCaptionAutoFocusId((requestedId) => requestedId === markerId ? requestedId : null);
    if (markerId !== null) {
      setSelectedPathId(null);
      setSelectedLabelId(null);
      setLabelPreviewState(null);
    }
    if (markerId === null) {
      setMarkerPreview(null);
    }
  }, [setLabelPreviewState]);

  const selectLabel = useCallback((labelId: string | null) => {
    setSelectedLabelId(labelId);
    if (labelId !== null) {
      setSelectedMarkerId(null);
      selectedMarkerIdRef.current = null;
      setMarkerPreview(null);
      vegvisirDirectionPreviewRef.current = null;
      setMarkerCaptionAutoFocusId(null);
      setSelectedPathId(null);
    }
    if (labelId === null) {
      setLabelPreviewState(null);
    }
  }, [setLabelPreviewState]);

  const updateMarker = useCallback(
    async (marker: Marker): Promise<boolean> => {
      const pending = markerCommitPromisesRef.current.get(marker.id);
      if (pending) return pending;
      const promise = mapSession.saveMarkerUpdate(marker);
      markerCommitPromisesRef.current.set(marker.id, promise);
      markerCommitDraftsRef.current.set(marker.id, marker);
      try {
        const saved = await promise;
        if (!saved && selectedMarkerIdRef.current === marker.id) setMarkerPreview(marker);
        return saved;
      } finally {
        markerCommitPromisesRef.current.delete(marker.id);
        markerCommitDraftsRef.current.delete(marker.id);
      }
    },
    [mapSession.saveMarkerUpdate],
  );

  const updatePath = useCallback(async (path: Path): Promise<boolean> => {
    const pending = pathCommitPromisesRef.current.get(path.id);
    if (pending) return pending;
    const promise = mapSession.savePathUpdate(path);
    pathCommitPromisesRef.current.set(path.id, promise);
    try { return await promise; }
    finally { pathCommitPromisesRef.current.delete(path.id); }
  }, [mapSession.savePathUpdate]);

  const updateMarkerCaptionDraft = useCallback((markerId: string, draft: string | null) => {
    setMarkerCaptionDrafts((current) => {
      if (draft === null) {
        if (!(markerId in current)) {
          return current;
        }
        const { [markerId]: _discarded, ...remaining } = current;
        return remaining;
      }
      return current[markerId] === draft ? current : { ...current, [markerId]: draft };
    });
  }, []);

  const deleteMarker = useCallback(async (markerId: string): Promise<boolean> => {
    const deleted = await mapSession.removeMarker(markerId);
    if (!deleted) return false;
    updateMarkerCaptionDraft(markerId, null);
    finishDeletedObjectInteraction();
    return true;
  }, [finishDeletedObjectInteraction, mapSession.removeMarker, updateMarkerCaptionDraft]);

  const deleteSelectedMarker = useCallback(() => {
    if (selectedMarkerId !== null) {
      void deleteMarker(selectedMarkerId);
    }
  }, [deleteMarker, selectedMarkerId]);

  const selectedLabel = mapSession.labels.find((label) => label.id === selectedLabelId) ?? (
    selectedLabelId !== null && labelPreviewRef.current?.id === selectedLabelId
      ? labelPreviewRef.current
      : null
  );

  const updateLabelDraft = useCallback((labelId: string, draft: string | null) => {
    setLabelDrafts((current) => {
      if (draft === null) {
        const { [labelId]: _discarded, ...remaining } = current;
        return remaining;
      }
      return current[labelId] === draft ? current : { ...current, [labelId]: draft };
    });
    const label = mapSession.labels.find((candidate) => candidate.id === labelId) ?? null;
    if (label === null) return;
    if (draft === null) {
      setLabelPreviewState(null);
      return;
    }
    setLabelPreviewState({ ...label, text: draft });
  }, [mapSession.labels, setLabelPreviewState]);

  const updateTextCreationDraft = useCallback((draft: string) => {
    setTextCreationDraft(draft);
    const text = normaliseLabelText(draft);
    if (text === null || mapSession.currentMap === null) {
      setTextCreationPosition(null);
      setLabelPreviewState(null);
      return;
    }
    const position = textCreationPosition ?? [mapSession.camera.cameraX, mapSession.camera.cameraY] as WorldPoint;
    setTextCreationPosition(position);
    setLabelPreviewState(createOptimisticLabel({
      id: 'text-draft',
      mapId: mapSession.currentMap.id,
      x: position[0],
      y: position[1],
      text,
      fontSize: textCreationSize,
      referenceZoom: mapSession.camera.zoom,
      rotationDegrees: 0,
    }));
  }, [mapSession.camera.cameraX, mapSession.camera.cameraY, mapSession.camera.zoom, mapSession.currentMap, setLabelPreviewState, textCreationPosition, textCreationSize]);

  // A draft is authored at the current zoom. Keep that temporary anchor in
  // sync while zooming so committing at the latest zoom cannot cause a jump.
  useEffect(() => {
    const text = normaliseLabelText(textCreationDraft);
    const map = mapSession.currentMap;
    if (tool !== 'text' || selectedLabelId !== null || text === null || map === null) return;
    const position = textCreationPosition ?? [mapSession.camera.cameraX, mapSession.camera.cameraY] as WorldPoint;
    if (textCreationPosition === null) setTextCreationPosition(position);
    setLabelPreviewState(createOptimisticLabel({
      id: 'text-draft',
      mapId: map.id,
      x: position[0],
      y: position[1],
      text,
      fontSize: textCreationSize,
      referenceZoom: mapSession.camera.zoom,
      rotationDegrees: 0,
    }));
  }, [
    mapSession.camera.cameraX,
    mapSession.camera.cameraY,
    mapSession.camera.zoom,
    mapSession.currentMap,
    selectedLabelId,
    setLabelPreviewState,
    textCreationDraft,
    textCreationPosition,
    textCreationSize,
    tool,
  ]);

  const commitTextCreation = useCallback(async (): Promise<Label | null> => {
    if (textCreationCommitPromiseRef.current !== null) {
      return textCreationCommitPromiseRef.current;
    }
    const commitPromise = (async (): Promise<Label | null> => {
      const text = normaliseLabelText(textCreationDraft);
      const map = mapSession.currentMap;
      if (text === null || map === null) return null;
      const position = textCreationPosition ?? [mapSession.camera.cameraX, mapSession.camera.cameraY] as WorldPoint;
      const id = crypto.randomUUID();
      const saved = await mapSession.saveLabel({
        id,
        x: position[0],
        y: position[1],
        text,
        fontSize: textCreationSize,
        referenceZoom: mapSession.camera.zoom,
        rotationDegrees: 0,
      });
      if (saved === null) return null;
      setTextCreationDraft('');
      setTextCreationPosition(null);
      // Keep the authoritative response as a short-lived interaction preview
      // until the labels collection catches up. This makes the newly-created
      // object immediately hit-testable/draggable after Enter.
      setLabelPreviewState(saved);
      selectLabel(saved.id);
      return saved;
    })();
    textCreationCommitPromiseRef.current = commitPromise;
    void commitPromise.then(
      () => {
        if (textCreationCommitPromiseRef.current === commitPromise) textCreationCommitPromiseRef.current = null;
      },
      () => {
        if (textCreationCommitPromiseRef.current === commitPromise) textCreationCommitPromiseRef.current = null;
      },
    );
    return commitPromise;
  }, [mapSession, selectLabel, setLabelPreviewState, textCreationDraft, textCreationPosition, textCreationSize]);

  const confirmTextCreationFromMap = useCallback(async (): Promise<void> => {
    if (textCreationConfirmInFlightRef.current) return;
    textCreationConfirmInFlightRef.current = true;
    try {
      if (normaliseLabelText(textCreationDraft) === null) {
        enterNeutralPan();
        return;
      }
      const saved = await commitTextCreation();
      if (saved !== null) {
        enterNeutralPan();
      }
    } finally {
      textCreationConfirmInFlightRef.current = false;
    }
  }, [commitTextCreation, enterNeutralPan, textCreationDraft]);

  const updateLabel = useCallback(async (label: Label): Promise<boolean> => {
    const existing = labelCommitPromisesRef.current.get(label.id);
    if (existing !== undefined) return existing;
    const previousPreview = labelPreviewRef.current?.id === label.id ? labelPreviewRef.current : null;
    const promise = (async () => {
      setLabelPreviewState(null);
      const saved = await mapSession.saveLabelUpdate(label);
      if (!saved && previousPreview !== null) {
        setLabelPreviewState(previousPreview);
      }
      return saved;
    })();
    labelCommitPromisesRef.current.set(label.id, promise);
    void promise.then(
      () => {
        if (labelCommitPromisesRef.current.get(label.id) === promise) labelCommitPromisesRef.current.delete(label.id);
      },
      () => {
        if (labelCommitPromisesRef.current.get(label.id) === promise) labelCommitPromisesRef.current.delete(label.id);
      },
    );
    return promise;
  }, [mapSession.saveLabelUpdate, setLabelPreviewState]);

  const commitSelectedLabelAndExit = useCallback(async (): Promise<boolean> => {
    if (selectedLabel === null) {
      enterNeutralPan();
      return true;
    }
    const pending = labelCommitPromisesRef.current.get(selectedLabel.id);
    if (pending !== undefined) {
      if (!(await pending)) return false;
      enterNeutralPan();
      return true;
    }
    const preview = labelPreviewRef.current?.id === selectedLabel.id ? labelPreviewRef.current : selectedLabel;
    const draftText = labelDrafts[selectedLabel.id];
    const nextText = draftText === undefined ? preview.text : normaliseLabelText(draftText) ?? selectedLabel.text;
    const draft = { ...preview, text: nextText };
    const changed =
      draft.text !== selectedLabel.text ||
      draft.fontSize !== selectedLabel.fontSize ||
      draft.referenceZoom !== selectedLabel.referenceZoom ||
      draft.rotationDegrees !== selectedLabel.rotationDegrees;
    if (!changed) {
      enterNeutralPan();
      return true;
    }
    const saved = await updateLabel(draft);
    if (!saved) return false;
    setLabelDrafts((current) => {
      const { [selectedLabel.id]: _discarded, ...remaining } = current;
      return remaining;
    });
    setLabelPreviewState(null);
    enterNeutralPan();
    return true;
  }, [enterNeutralPan, labelDrafts, selectedLabel, setLabelPreviewState, updateLabel]);

  const activateObjectTool = useCallback((nextTool: MapTool) => {
    setMarkerGalleryOpen(false);
    setArmedMarkerType(null);
    setTool(nextTool);
  }, []);

  const previewLabelSize = useCallback((fontSize: number) => {
    if (selectedLabel === null) {
      setTextCreationSize(fontSize);
      if (textCreationDraft.length > 0) updateTextCreationDraft(textCreationDraft);
      return;
    }
    setLabelPreviewState({ ...selectedLabel, fontSize, referenceZoom: mapSession.camera.zoom });
  }, [mapSession.camera.zoom, selectedLabel, setLabelPreviewState, textCreationDraft, updateTextCreationDraft]);

  const commitLabelSize = useCallback(() => {
    const preview = labelPreviewRef.current;
    if (selectedLabel !== null && preview !== null && preview.id === selectedLabel.id && preview.fontSize !== selectedLabel.fontSize) {
      void updateLabel({ ...preview, referenceZoom: mapSession.camera.zoom });
    }
  }, [mapSession.camera.zoom, selectedLabel, updateLabel]);

  const previewLabelRotation = useCallback((rotationDegrees: number) => {
    if (selectedLabel === null) return;
    setLabelPreviewState({ ...selectedLabel, rotationDegrees: normaliseLabelRotation(rotationDegrees) });
  }, [selectedLabel, setLabelPreviewState]);

  const commitLabelRotation = useCallback(() => {
    const preview = labelPreviewRef.current;
    if (selectedLabel !== null && preview !== null && preview.id === selectedLabel.id && preview.rotationDegrees !== selectedLabel.rotationDegrees) {
      void updateLabel(preview);
    }
  }, [selectedLabel, updateLabel]);

  const deleteLabel = useCallback(async (labelId: string): Promise<boolean> => {
    const deleted = await mapSession.removeLabel(labelId);
    if (!deleted) return false;
    updateLabelDraft(labelId, null);
    finishDeletedObjectInteraction();
    return true;
  }, [finishDeletedObjectInteraction, mapSession.removeLabel, updateLabelDraft]);

  const deletePath = useCallback(async (pathId: string): Promise<boolean> => {
    const deleted = await mapSession.removePath(pathId);
    if (!deleted) return false;
    finishDeletedObjectInteraction();
    return true;
  }, [finishDeletedObjectInteraction, mapSession.removePath]);

  const selectedMarker = mapSession.markers.find((marker) => marker.id === selectedMarkerId) ?? null;

  // A placement-only request survives the optimistic Marker while its caption
  // input is disabled, then is consumed by MarkerCaptionField once the server
  // response makes that exact selected Marker editable.
  useEffect(() => {
    if (markerCaptionAutoFocusId === null) return;
    const requestedMarker = mapSession.markers.find((marker) => marker.id === markerCaptionAutoFocusId);
    if (
      selectedMarkerId !== markerCaptionAutoFocusId ||
      (requestedMarker === undefined && !mapSession.pendingMarkerIds.has(markerCaptionAutoFocusId))
    ) {
      setMarkerCaptionAutoFocusId(null);
    }
  }, [mapSession.markers, mapSession.pendingMarkerIds, markerCaptionAutoFocusId, selectedMarkerId]);

  const requestMarkerCaptionAutoFocus = useCallback((markerId: string) => {
    setMarkerCaptionAutoFocusId(markerId);
  }, []);

  const consumeMarkerCaptionAutoFocus = useCallback((markerId: string) => {
    setMarkerCaptionAutoFocusId((requestedId) => requestedId === markerId ? null : requestedId);
  }, []);

  const previewVegvisirDirection = useCallback((directionDegrees: number) => {
    if (selectedMarker === null || !isVegvisirMarker(selectedMarker.markerType)) {
      return;
    }
    const direction = normaliseDirectionDegrees(directionDegrees);
    vegvisirDirectionPreviewRef.current = { markerId: selectedMarker.id, direction, saved: false };
    setMarkerPreview(markerWithDirection(selectedMarker, direction));
  }, [selectedMarker]);

  const persistPendingVegvisirDirection = useCallback(async (marker: Marker | null = selectedMarker): Promise<boolean> => {
    const pendingDirection = vegvisirDirectionPreviewRef.current;
    if (
      marker === null ||
      !isVegvisirMarker(marker.markerType) ||
      pendingDirection === null ||
      pendingDirection.markerId !== marker.id
    ) {
      return true;
    }
    if (pendingDirection.saved) {
      return true;
    }
    const draft = markerWithDirection(marker, pendingDirection.direction);
    if (draft.directionDegrees === marker.directionDegrees) {
      pendingDirection.saved = true;
      return true;
    }
    const saved = await updateMarker(draft);
    if (saved && vegvisirDirectionPreviewRef.current === pendingDirection) {
      // The preview remains rendered until the selected-object confirmation
      // has completed. Clearing it here can expose the old Marker for a frame
      // before React has rendered the optimistic/server replacement.
      pendingDirection.saved = true;
    }
    return saved;
  }, [selectedMarker, updateMarker]);

  const commitVegvisirDirection = useCallback(() => {
    if (selectedMarker === null || markerCaptionDrafts[selectedMarker.id] !== undefined) {
      // Enter/click-away aggregates a dirty caption and direction into one
      // normal Marker update instead of racing two independent updates.
      return;
    }
    void persistPendingVegvisirDirection(selectedMarker);
  }, [markerCaptionDrafts, persistPendingVegvisirDirection, selectedMarker]);

  const updateMarkerWithLatestVegvisirDirection = useCallback((marker: Marker): Promise<boolean> => {
    const pendingDirection = vegvisirDirectionPreviewRef.current;
    const draft =
      pendingDirection !== null &&
      pendingDirection.markerId === marker.id &&
      isVegvisirMarker(marker.markerType)
        ? markerWithDirection(marker, pendingDirection.direction)
        : marker;
    return updateMarker(draft);
  }, [updateMarker]);

  // All selected-object Enter actions await the same logical save. The key
  // owner prevents native activation of a previously focused HUD button.
  const confirmSelectedObject = useCallback(async (): Promise<boolean> => {
    if (confirmationInFlightRef.current) return false;
    confirmationInFlightRef.current = true;
    let confirmed = false;
    try {
      if (!(await (canvasRef.current?.finishSelectedGesture() ?? Promise.resolve(true)))) return false;
      if (selectedLabel !== null) {
        confirmed = await commitSelectedLabelAndExit();
        return confirmed;
      }
      if (selectedMarker !== null) {
        const pending = markerCommitPromisesRef.current.get(selectedMarker.id);
        const pendingDraft = markerCommitDraftsRef.current.get(selectedMarker.id);
        if (pending === undefined && mapSession.pendingMarkerIds.has(selectedMarker.id)) return false;
        const captionDraft = markerCaptionDrafts[selectedMarker.id];
        const pendingDirection = vegvisirDirectionPreviewRef.current?.markerId === selectedMarker.id
          ? vegvisirDirectionPreviewRef.current
          : null;
        const preview = markerPreview?.id === selectedMarker.id ? markerPreview : selectedMarker;
        const name = normaliseMarkerCaption(captionDraft ?? preview.name ?? '');
        const draft = isVegvisirMarker(preview.markerType)
          ? markerWithDirection({ ...preview, name }, pendingDirection?.direction ?? preview.directionDegrees ?? 0)
          : { ...preview, name };
        if (pending !== undefined) {
          if (!(await pending)) return false;
          // A slider pointer-up has already persisted a direction-only edit.
          // A caption draft intentionally deferred that pointer-up save, so it
          // still needs this one aggregated marker mutation after the prior
          // caption operation settles.
          if (
            captionDraft !== undefined &&
            (pendingDraft === undefined || pendingDraft.name !== draft.name || pendingDraft.directionDegrees !== draft.directionDegrees)
          ) {
            if (!(await updateMarker(draft))) return false;
            if (pendingDirection !== null && vegvisirDirectionPreviewRef.current === pendingDirection) pendingDirection.saved = true;
          }
        } else if (captionDraft !== undefined || pendingDirection?.saved !== true) {
          if (draft.name !== selectedMarker.name || draft.directionDegrees !== selectedMarker.directionDegrees) {
            if (!(await updateMarker(draft))) return false;
          }
          if (pendingDirection !== null && vegvisirDirectionPreviewRef.current === pendingDirection) pendingDirection.saved = true;
        }
        updateMarkerCaptionDraft(selectedMarker.id, null);
      }
      if (selectedPathId !== null) {
        const pending = pathCommitPromisesRef.current.get(selectedPathId);
        if (pending === undefined && mapSession.pendingPathIds.has(selectedPathId)) return false;
        if (pending !== undefined && !(await pending)) return false;
      }
      enterNeutralPan();
      confirmed = true;
      return true;
    } finally {
      if (confirmed) canvasRef.current?.focus();
      confirmationInFlightRef.current = false;
    }
  }, [commitSelectedLabelAndExit, enterNeutralPan, markerCaptionDrafts, markerPreview, selectedLabel, selectedMarker, selectedPathId, updateMarker, updateMarkerCaptionDraft, mapSession.pendingMarkerIds, mapSession.pendingPathIds]);

  const persistSelectedMarkerBeforeSelectionChange = useCallback(() => {
    void persistPendingVegvisirDirection(selectedMarker);
  }, [persistPendingVegvisirDirection, selectedMarker]);
  const cursorValheim = cursorWorld === null ? null : mapToValheimCoordinates(cursorWorld[0], cursorWorld[1]);
  const centreValheim = mapToValheimCoordinates(mapSession.camera.cameraX, mapSession.camera.cameraY);
  const debugValheim = debugCoordinateMode === 'cursor' ? cursorValheim : centreValheim;

  const openDebugInfo = useCallback(() => {
    setDebugInfoView('readout');
    setDebugInfoOpen(true);
  }, []);

  const selectDebugCoordinateMode = useCallback((mode: DebugCoordinateMode) => {
    setDebugCoordinateMode(mode);
    setDebugInfoView('readout');
  }, []);

  const closeOrBackDebugInfo = useCallback(() => {
    if (debugInfoView === 'bug-report') {
      setDebugInfoView('readout');
    } else if (debugInfoView === 'settings') {
      setDebugInfoView('readout');
    } else {
      closeDebugInfo();
    }
  }, [closeDebugInfo, debugInfoView]);

  const goToCoordinate = useCallback(
    (coordinate: { x: number; y: number }) => {
      mapSession.setCamera({ ...mapSession.camera, cameraX: coordinate.x, cameraY: coordinate.y });
    },
    [mapSession.camera, mapSession.setCamera],
  );

  const requestUndo = useCallback(() => {
    canvasRef.current?.cancelTransientInteraction();
    void mapSession.undo();
  }, [mapSession.undo]);

  const requestRedo = useCallback(() => {
    canvasRef.current?.cancelTransientInteraction();
    void mapSession.redo();
  }, [mapSession.redo]);

  const openCoordinateNavigator = useCallback((trigger: HTMLElement) => {
    setCoordinateNavigatorAnchor(trigger.getBoundingClientRect());
    setCoordinateNavigatorOpen(true);
  }, []);

  const closeCoordinateNavigator = useCallback(() => {
    setCoordinateNavigatorOpen(false);
    setCoordinateNavigatorAnchor(null);
  }, []);

  const utilityItems: ResponsiveOverflowItem[] = [
    {
      id: 'map-library',
      render: () => (
        <MapMenu
          maps={mapSession.maps}
          currentMapId={mapSession.currentMap?.id ?? null}
          disabled={mapSession.mapActionsDisabled}
          error={mapSession.mapError}
          onSelectMap={mapSession.switchMap}
          onCreateMap={mapSession.createAndSelectMap}
          onRenameMap={mapSession.renameExistingMap}
          onDuplicateMap={mapSession.duplicateAndSelectMap}
          onDeleteMap={mapSession.deleteExistingMap}
          workspace={{ markerOpacity, pathOpacity, textOpacity, gridEnabled: gridVisible, protectEnabled, camera: mapSession.camera }}
          onImportMap={async snapshot => {
            const result = await mapSession.importAndSelectMap(snapshot);
            if (result.ok) {
              setMarkerOpacity(snapshot.workspace.markerOpacity);
              setPathOpacity(snapshot.workspace.pathOpacity);
              setTextOpacity(snapshot.workspace.textOpacity);
              setGridVisible(snapshot.workspace.gridEnabled);
              setProtectEnabled(snapshot.workspace.protectEnabled);
            }
            return result;
          }}
        />
      ),
    },
    {
      id: 'reset-view',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { canvasRef.current?.resetView(); closeOverflow(); }}>
          Reset view
        </button>
      ),
    },
    {
      id: 'zoom-to-one',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { canvasRef.current?.zoomToOne(); closeOverflow(); }}>
          Zoom to 100%
        </button>
      ),
    },
    {
      id: 'undo',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { requestUndo(); closeOverflow(); }} disabled={mapSession.undoPending || mapSession.redoPending}>
          Undo
        </button>
      ),
    },
    {
      id: 'redo',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" onClick={() => { requestRedo(); closeOverflow(); }} disabled={mapSession.redoPending || mapSession.undoPending}>
          Redo
        </button>
      ),
    },
    {
      id: 'grid',
      render: ({ closeOverflow }) => (
        <button type="button" className="utility-control" aria-pressed={gridVisible} onClick={() => { setGridVisible((visible) => !visible); closeOverflow(); }}>
          Grid
        </button>
      ),
    },
    {
      id: 'opacity',
      render: ({ closeOverflow }) => (
        <button
          type="button"
          className="utility-control"
          aria-label="Opacity"
          ref={opacityButtonRef}
          aria-pressed={opacityPopupOpen}
          title="Opacity"
          aria-expanded={opacityPopupOpen}
          aria-haspopup="dialog"
          onClick={() => { setOpacityPopupOpen((open) => !open); closeOverflow(); }}
        >
          Opacity
        </button>
      ),
    },
    {
      id: 'protect',
      render: ({ closeOverflow }) => (
        <button
          type="button"
          className="utility-control"
          aria-pressed={protectEnabled}
          aria-label="Prevent markers and paths from being selected while using Pan"
          title="Prevent markers and paths from being selected while using Pan"
          onClick={() => {
            const next = !protectEnabled;
            setProtectEnabled(next);
            if (next && tool === 'pan') {
              setSelectedPathId(null);
              setSelectedMarkerId(null);
              selectedMarkerIdRef.current = null;
              setSelectedLabelId(null);
              setLabelPreviewState(null);
            }
            closeOverflow();
          }}
        >
          Protect
        </button>
      ),
    },
    {
      id: 'coordinate',
      render: ({ closeOverflow }) => (
        <button
          type="button"
          className="utility-control"
          aria-label="Go to Valheim coordinates. In-game, enable the console, press F5, type `pos`, and use the displayed X and Z coordinates"
          title="Go to Valheim coordinates. In-game, enable the console, press F5, type `pos`, and use the displayed X and Z coordinates"
          aria-expanded={coordinateNavigatorOpen}
          aria-haspopup="dialog"
          onClick={(event) => {
            if (coordinateNavigatorOpen) {
              closeCoordinateNavigator();
              return;
            }
            openCoordinateNavigator(event.currentTarget);
            closeOverflow();
          }}
        >
          Add coordinate
        </button>
      ),
    },
  ];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target) || (event.target instanceof Element && event.target.closest('[role="dialog"], [role="listbox"]'))) {
        return;
      }

      // Disabling an input while saving can move browser focus to body. The
      // selected-object confirmation must still work there, including retry.
      if (event.key === 'Enter' && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey &&
          (selectedLabelId !== null || selectedMarkerId !== null || selectedPathId !== null) &&
          !(event.target instanceof Element && event.target.closest('.debug-info'))) {
        event.preventDefault();
        event.stopPropagation();
        void confirmSelectedObject();
        return;
      }

      const redoShortcut =
        ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z' && !event.altKey) ||
        (event.ctrlKey && event.key.toLowerCase() === 'y' && !event.metaKey && !event.altKey && !event.shiftKey);
      if (redoShortcut) {
        event.preventDefault();
        requestRedo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        requestUndo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'h':
          changeTool('pan');
          break;
        case 'b':
          changeTool('biome_brush');
          break;
        case 'e':
          changeTool('eraser');
          break;
        case 'p':
          changeTool('path');
          break;
        case 'v':
          changeTool('select');
          break;
        case 'm':
          changeTool('marker');
          break;
        case 't':
          event.preventDefault();
          changeTool(tool === 'text' ? 'pan' : 'text');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeTool, confirmSelectedObject, requestRedo, requestUndo, selectedLabelId, selectedMarkerId, selectedPathId, tool]);

  return (
    <main className="map-workspace" data-ui-mode="immersive" onKeyDown={(event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Enter') return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"], [role="listbox"], .debug-info')) return;
      if (isTypingTarget(target) && !(target instanceof Element && target.closest('.tool-context-panel'))) return;
      if (selectedLabelId === null && selectedMarkerId === null && selectedPathId === null) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmSelectedObject();
    }}>
      <MapCanvas
        ref={canvasRef}
        camera={mapSession.camera}
        tool={tool}
        biome={biome}
        brushWidth={brushWidth}
        strokes={mapSession.strokes}
        paths={mapSession.paths}
        markers={mapSession.markers}
        labels={mapSession.labels}
        pendingPathIds={mapSession.pendingPathIds}
        pendingMarkerIds={mapSession.pendingMarkerIds}
        pendingLabelIds={mapSession.pendingLabelIds}
        pathOpacity={pathOpacity}
        markerOpacity={markerOpacity}
        textOpacity={textOpacity}
        protectEnabled={protectEnabled}
        pathGeometryType={pathGeometryType}
        armedMarkerType={armedMarkerType}
        selectedPathId={selectedPathId}
        selectedMarkerId={selectedMarkerId}
        selectedLabelId={selectedLabelId}
        textCreationActive={tool === 'text' && selectedLabelId === null}
        markerPreview={markerPreview}
        labelPreview={labelPreview}
        gridVisible={gridVisible}
        mapId={mapSession.currentMap?.id ?? null}
        interactionEnabled={mapSession.loadState === 'ready' && !mapSession.mapActionBusy}
        onCameraChange={mapSession.setCamera}
        onCursorWorldChange={setCursorWorld}
        onStrokeComplete={mapSession.saveStroke}
        onPathComplete={mapSession.savePath}
        onPathUpdate={updatePath}
        onPathDelete={deletePath}
        onPathSelectionChange={selectPath}
        onMarkerComplete={mapSession.saveMarker}
        onMarkerUpdate={updateMarkerWithLatestVegvisirDirection}
        onMarkerDelete={deleteMarker}
        onMarkerSelectionChange={selectMarker}
        onMarkerPlacementSelected={requestMarkerCaptionAutoFocus}
        onSelectedMarkerBeforeSelectionChange={persistSelectedMarkerBeforeSelectionChange}
        onLabelUpdate={updateLabel}
        onLabelDelete={deleteLabel}
        onLabelSelectionChange={selectLabel}
        onTextCreationMapConfirm={confirmTextCreationFromMap}
        onTextCreationPointerDown={commitTextCreation}
        onSelectedObjectMapClickAway={confirmSelectedObject}
        onMarkerPlacementDisarm={disarmMarkerPlacement}
        onToolChange={changeTool}
        onObjectToolChange={activateObjectTool}
      />

      {gridVisible && <div className="map-centre-reticle" aria-hidden="true" />}

      <img
        className="immersive-compass-rose"
        src={compassRoseUrl}
        alt=""
        aria-hidden="true"
      />

      <div className="map-top-hud" data-layout-mode={layoutMode}>
        <div className="map-top-hud__utility map-top-hud__utility--opacity">
          <ResponsiveOverflowBar ariaLabel="Map viewport controls" className="map-controls" items={utilityItems} mode={layoutMode} group="utility" />
          <OpacityPopup
            open={opacityPopupOpen}
            anchorRef={opacityButtonRef}
            anchorLayout={`${layoutMode}:${mapSession.currentMap?.name ?? ''}`}
            markerOpacity={markerOpacity}
            pathOpacity={pathOpacity}
            textOpacity={textOpacity}
            onMarkerOpacityChange={setMarkerOpacity}
            onPathOpacityChange={setPathOpacity}
            onTextOpacityChange={setTextOpacity}
            onClose={() => setOpacityPopupOpen(false)}
          />
        </div>

        <div ref={toolsHudRef} className="map-top-hud__tools">
          <MapToolbar
            onConfirmSelectedObject={confirmSelectedObject}
            layoutMode={layoutMode}
            tool={tool}
            biome={biome}
            brushWidth={brushWidth}
            pathGeometryType={pathGeometryType}
            hasSelectedPath={selectedPathId !== null}
            selectedPathPending={selectedPathId !== null && mapSession.pendingPathIds.has(selectedPathId)}
            hasSelectedMarker={selectedMarkerId !== null}
            selectedMarkerPending={selectedMarkerId !== null && mapSession.pendingMarkerIds.has(selectedMarkerId)}
            selectedMarker={selectedMarker}
            markerCaptionAutoFocusRequested={selectedMarkerId !== null && selectedMarkerId === markerCaptionAutoFocusId}
            markerCaptionDraft={selectedMarker === null ? undefined : markerCaptionDrafts[selectedMarker.id]}
            selectedVegvisir={selectedMarker !== null && isVegvisirMarker(selectedMarker.markerType)}
            vegvisirDirection={selectedMarker?.directionDegrees ?? 0}
            hasSelectedLabel={selectedLabelId !== null}
            selectedLabelPending={selectedLabelId !== null && mapSession.pendingLabelIds.has(selectedLabelId)}
            selectedLabel={selectedLabel}
            labelDraft={selectedLabel === null ? undefined : labelDrafts[selectedLabel.id]}
            textCreationDraft={textCreationDraft}
            textCreationSize={textCreationSize}
            onToolChange={changeTool}
            onVegvisirDirectionPreview={previewVegvisirDirection}
            onVegvisirDirectionCommit={commitVegvisirDirection}
            onBiomeChange={setBiome}
            onBrushWidthChange={setBrushWidth}
            onPathGeometryTypeChange={setPathGeometryType}
            onDeleteSelectedPath={() => canvasRef.current?.deleteSelectedPath()}
            onDeleteSelectedMarker={deleteSelectedMarker}
            onDeleteSelectedLabel={() => {
              if (selectedLabelId !== null) void deleteLabel(selectedLabelId);
            }}
            onMarkerCaptionDraftChange={updateMarkerCaptionDraft}
            onMarkerUpdate={updateMarkerWithLatestVegvisirDirection}
            onMarkerCaptionAutoFocusConsumed={consumeMarkerCaptionAutoFocus}
            onTextCreationDraftChange={updateTextCreationDraft}
            onTextCreationCommit={commitTextCreation}
            onTextCreationCancel={() => {
              if (textCreationDraft.trim() === '') enterNeutralPan();
              else cancelTextCreation();
            }}
            onLabelDraftChange={updateLabelDraft}
            onLabelUpdate={updateLabel}
            onLabelSizePreview={previewLabelSize}
            onLabelSizeCommit={commitLabelSize}
            onLabelRotationPreview={previewLabelRotation}
            onLabelRotationCommit={commitLabelRotation}
          />
        </div>

      </div>

      <div className="map-popover-layer">
        <CoordinateNavigator
          anchorRect={coordinateNavigatorAnchor}
          open={coordinateNavigatorOpen}
          onClose={closeCoordinateNavigator}
          onGo={goToCoordinate}
        />
      </div>

      <MarkerGallery
        open={tool === 'marker' && markerGalleryOpen}
        anchorRef={toolsHudRef}
        armedMarkerType={armedMarkerType}
        onSelect={selectMarkerGalleryItem}
        onClose={closeMarkerGallery}
        onEscape={cancelMarkerGalleryAndReturnToPan}
      />

      <div className="debug-info" ref={debugInfoRef}>
        {!debugInfoOpen ? (
          <button
            type="button"
            className="debug-info__button immersive-wood-button"
            aria-label="Show debug information"
            aria-controls="debug-info-popup"
            aria-expanded={debugInfoOpen}
            onClick={openDebugInfo}
          >
            <span className="debug-info__symbol" aria-hidden="true">?</span>
          </button>
        ) : (
          <section id="debug-info-popup" className="debug-info__popup" aria-live="polite">
            {debugInfoView === 'bug-report' ? (
              <section className="debug-info__bug-report" aria-label="Bug report">
                <div className="debug-info__bug-report-actions">
                  <button
                    type="button"
                    className="debug-info__action immersive-wood-button"
                    aria-label="Back to debug information"
                    onClick={closeOrBackDebugInfo}
                  >
                    X
                  </button>
                </div>
                <a
                  className="debug-info__report-button immersive-wood-button"
                  href={BUG_REPORT_MAILTO}
                  aria-label="Report bug"
                >
                  REPORT BUG
                </a>
              </section>
            ) : debugInfoView === 'settings' ? (
              <section className="debug-info__settings" aria-label="Debug settings">
                <div className="debug-info__settings-line">
                  <h2>Coordinates</h2>
                  <div className="debug-info__actions">
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Debug settings"
                      aria-pressed="true"
                      onClick={() => setDebugInfoView('settings')}
                    >
                      ?
                    </button>
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Back to debug information"
                      onClick={closeOrBackDebugInfo}
                    >
                      X
                    </button>
                  </div>
                </div>
                <div className="debug-info__coordinate-options" role="radiogroup" aria-label="Coordinate source">
                  {(['cursor', 'centre'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className="debug-info__coordinate-option"
                      role="radio"
                      aria-checked={debugCoordinateMode === mode}
                      onClick={() => selectDebugCoordinateMode(mode)}
                    >
                      <span aria-hidden="true">{debugCoordinateMode === mode ? '✓' : ''}</span>
                      {mode === 'cursor' ? 'Cursor' : 'Centre'}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <div className="debug-info__readout">
                <div className="debug-info__zoom-line">
                  <span>ZOOM: {(mapSession.camera.zoom * 100).toFixed(0)}%</span>
                  <div className="debug-info__actions">
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Report Bug"
                      title="Report Bug"
                      onClick={() => setDebugInfoView('bug-report')}
                    >
                      !
                    </button>
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Coordinates Settings"
                      title="Coordinates Settings"
                      onClick={() => setDebugInfoView('settings')}
                    >
                      ?
                    </button>
                    <button
                      type="button"
                      className="debug-info__action immersive-wood-button"
                      aria-label="Close debug information"
                      onClick={closeOrBackDebugInfo}
                    >
                      X
                    </button>
                  </div>
                </div>
                <div className="debug-info__coordinate-line"><span>X:</span><span>{formatCoordinate(debugValheim?.x)}</span></div>
                <div className="debug-info__coordinate-line debug-info__coordinate-line--versioned">
                  <span className="debug-info__coordinate-leading"><span>Z:</span><span>{formatCoordinate(debugValheim?.z)}</span></span>
                  <span className="debug-info__version" aria-hidden="true">{APP_VERSION}</span>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      {mapSession.loadState !== 'ready' && (
        <section className="map-loading" role={mapSession.loadState === 'error' ? 'alert' : 'status'}>
          {mapSession.loadState === 'loading' ? (
            'Loading map…'
          ) : (
            <>
              <span>Could not load saved map: {mapSession.loadError}</span>
              <button type="button" onClick={() => void mapSession.retryBootstrap()}>
                Retry
              </button>
            </>
          )}
        </section>
      )}
    </main>
  );
}

function formatCoordinate(value: number | undefined): string {
  return value === undefined ? '—' : Math.round(value).toString();
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
