import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Biome, Marker, PathGeometryType } from '../../../shared/domain';
import { BIOMES, biomeStyle } from '../lib/biomeStyles';
import type { MapTool } from '../state/mapTool';
import { ResponsiveOverflowBar, type ResponsiveOverflowItem } from './ResponsiveOverflowBar';
import type { HudLayoutMode } from '../lib/hudLayout';
import { MarkerCaptionField } from './MarkerInspector';

interface MapToolbarProps {
  layoutMode: HudLayoutMode;
  immersive: boolean;
  tool: MapTool;
  biome: Biome;
  brushWidth: number;
  pathGeometryType: PathGeometryType;
  hasSelectedPath: boolean;
  selectedPathPending: boolean;
  hasSelectedMarker: boolean;
  selectedMarkerPending: boolean;
  selectedMarker: Marker | null;
  markerCaptionDraft: string | undefined;
  selectedVegvisir: boolean;
  vegvisirDirection: number;
  onToolChange: (tool: MapTool) => void;
  onVegvisirDirectionPreview: (direction: number) => void;
  onVegvisirDirectionCommit: () => void;
  onBiomeChange: (biome: Biome) => void;
  onBrushWidthChange: (width: number) => void;
  onPathGeometryTypeChange: (geometryType: PathGeometryType) => void;
  onDeleteSelectedPath: () => void;
  onDeleteSelectedMarker: () => void;
  onMarkerCaptionDraftChange: (markerId: string, draft: string | null) => void;
  onMarkerUpdate: (marker: Marker) => Promise<boolean>;
}

export function MapToolbar({
  layoutMode,
  immersive,
  tool,
  biome,
  brushWidth,
  pathGeometryType,
  hasSelectedPath,
  selectedPathPending,
  hasSelectedMarker,
  selectedMarkerPending,
  selectedMarker,
  markerCaptionDraft,
  selectedVegvisir,
  vegvisirDirection,
  onToolChange,
  onVegvisirDirectionPreview,
  onVegvisirDirectionCommit,
  onBiomeChange,
  onBrushWidthChange,
  onPathGeometryTypeChange,
  onDeleteSelectedPath,
  onDeleteSelectedMarker,
  onMarkerCaptionDraftChange,
  onMarkerUpdate,
}: MapToolbarProps) {
  const showsInlineBrushControls = !immersive && (tool === 'biome_brush' || tool === 'eraser');
  const showsContextualBrushControls = immersive && (tool === 'biome_brush' || tool === 'eraser');
  const showsInlinePathControls = !immersive && tool === 'path';
  const showsContextualPathControls = immersive && tool === 'path';
  const hasDeletableSelection = hasSelectedPath || hasSelectedMarker;
  const showsSelectedMarkerControls = selectedMarker !== null;
  const showsContextualPanel = immersive && (showsContextualBrushControls || showsContextualPathControls || hasDeletableSelection || showsSelectedMarkerControls);
  const handleToolClick = (nextTool: MapTool) => {
    onToolChange(nextTool === tool && nextTool !== 'pan' ? 'pan' : nextTool);
  };
  const toolItems: ResponsiveOverflowItem[] = [
    toolItem('pan', 'Pan', 'H'),
    toolItem('biome_brush', 'Biome Brush', 'B'),
    toolItem('eraser', 'Eraser', 'E'),
    toolItem('path', 'Path', 'P'),
    toolItem('marker', 'Marker', 'M'),
    toolItem('select', 'Select', 'V'),
  ].map((item) => ({
    ...item,
    active: tool === item.tool,
    render: ({ closeOverflow, inOverflow }) => (
      <ToolButton
        active={tool === item.tool}
        label={item.label}
        shortcut={item.shortcut}
        showShortcut={inOverflow}
        onClick={() => { handleToolClick(item.tool); closeOverflow(); }}
      />
    ),
  }));

  return (
    <>
    <section className="map-toolbar" aria-label="Map drawing tools">
      <ResponsiveOverflowBar ariaLabel="Active tool" className="map-toolbar__tools" items={toolItems} mode={layoutMode} group="tools" />

      {showsInlinePathControls && (
        <label className="map-toolbar__field">
          <span>Mode</span>
          <select
            value={pathGeometryType}
            aria-label="Path drawing mode"
            onChange={(event) => {
              onPathGeometryTypeChange(event.target.value as PathGeometryType);
              event.currentTarget.blur();
            }}
          >
            <option value="freehand">Freehand</option>
            <option value="straight">Straight</option>
            <option value="curve">Curve</option>
          </select>
        </label>
      )}

      {showsInlineBrushControls && <BiomeBrushControls biome={biome} brushWidth={brushWidth} disabled={tool === 'eraser'} onBiomeChange={onBiomeChange} onBrushWidthChange={onBrushWidthChange} />}

      {!immersive && hasSelectedPath && (
        <button type="button" className="map-toolbar__delete" disabled={selectedPathPending} onClick={onDeleteSelectedPath}>
          Delete path
        </button>
      )}
    </section>
    {showsContextualPanel && (
      <section className="map-toolbar tool-context-panel" aria-label="Tool context controls">
        {showsContextualBrushControls && (
          <BrushControls
            biome={biome}
            brushWidth={brushWidth}
            disabled={false}
            showBiome={tool === 'biome_brush'}
            onBiomeChange={onBiomeChange}
            onBrushWidthChange={onBrushWidthChange}
          />
        )}
        {showsContextualPathControls && (
          <PathModePicker pathGeometryType={pathGeometryType} onPathGeometryTypeChange={onPathGeometryTypeChange} />
        )}
        {selectedVegvisir && (
          <VegvisirDirectionControl
            direction={vegvisirDirection}
            disabled={selectedMarkerPending}
            onPreview={onVegvisirDirectionPreview}
            onCommit={onVegvisirDirectionCommit}
          />
        )}
        {selectedMarker !== null && (
          <MarkerCaptionField
            marker={selectedMarker}
            disabled={selectedMarkerPending}
            captionDraft={markerCaptionDraft}
            onCaptionDraftChange={onMarkerCaptionDraftChange}
            onUpdate={onMarkerUpdate}
            className="marker-caption-field__input"
          />
        )}
        {hasDeletableSelection && (
          <button
            type="button"
            className="immersive-wood-button immersive-wood-button--danger tool-context-panel__delete"
            aria-label="Delete selected object"
            disabled={hasSelectedPath ? selectedPathPending : selectedMarkerPending}
            onClick={hasSelectedPath ? onDeleteSelectedPath : onDeleteSelectedMarker}
          >
            DELETE
          </button>
        )}
      </section>
    )}
    </>
  );
}

function VegvisirDirectionControl({
  direction,
  disabled,
  onPreview,
  onCommit,
}: {
  direction: number;
  disabled: boolean;
  onPreview: (direction: number) => void;
  onCommit: () => void;
}) {
  const [previewDirection, setPreviewDirection] = useState(direction);

  useEffect(() => {
    setPreviewDirection(direction);
  }, [direction]);

  return (
    <div className="biome-brush-controls__size tool-context-panel__direction">
      <input
        className="biome-brush-controls__slider"
        type="range"
        min="0"
        max="359"
        step="1"
        value={previewDirection}
        disabled={disabled}
        aria-label="Vegvisir direction"
        onChange={(event) => {
          const nextDirection = Number(event.target.value);
          setPreviewDirection(nextDirection);
          onPreview(nextDirection);
        }}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyUp={(event) => {
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
            onCommit();
          }
        }}
      />
    </div>
  );
}

function BiomeBrushControls({
  biome,
  brushWidth,
  disabled,
  onBiomeChange,
  onBrushWidthChange,
}: {
  biome: Biome;
  brushWidth: number;
  disabled: boolean;
  onBiomeChange: (biome: Biome) => void;
  onBrushWidthChange: (width: number) => void;
}) {
  return (
    <BrushControls
      biome={biome}
      brushWidth={brushWidth}
      disabled={disabled}
      showBiome
      onBiomeChange={onBiomeChange}
      onBrushWidthChange={onBrushWidthChange}
    />
  );
}

function BrushControls({
  biome,
  brushWidth,
  disabled,
  showBiome,
  onBiomeChange,
  onBrushWidthChange,
}: {
  biome: Biome;
  brushWidth: number;
  disabled: boolean;
  showBiome: boolean;
  onBiomeChange: (biome: Biome) => void;
  onBrushWidthChange: (width: number) => void;
}) {
  return (
    <div className="biome-brush-controls" aria-label={showBiome ? 'Biome Brush controls' : 'Eraser controls'}>
      {showBiome && <BiomePicker biome={biome} disabled={disabled} onBiomeChange={onBiomeChange} />}
      <BrushSizeControl brushWidth={brushWidth} onBrushWidthChange={onBrushWidthChange} />
    </div>
  );
}

function BrushSizeControl({
  brushWidth,
  onBrushWidthChange,
}: {
  brushWidth: number;
  onBrushWidthChange: (width: number) => void;
}) {
  return (
    <div className="biome-brush-controls__size">
      <input
        className="biome-brush-controls__slider"
        type="range"
        min="20"
        max="500"
        step="10"
        value={brushWidth}
        aria-label="Brush size"
        onChange={(event) => onBrushWidthChange(Number(event.target.value))}
      />
    </div>
  );
}

const PICKER_VIEWPORT_MARGIN = 12;
const PICKER_OFFSET = 4;

interface ContextualPickerOption<T extends string> {
  value: T;
  label: string;
}

const BIOME_OPTIONS: readonly ContextualPickerOption<Biome>[] = BIOMES.map((value) => ({
  value,
  label: biomeStyle(value).label,
}));

const PATH_MODE_OPTIONS: readonly ContextualPickerOption<PathGeometryType>[] = [
  { value: 'freehand', label: 'Freehand' },
  { value: 'straight', label: 'Straight' },
  { value: 'curve', label: 'Curve' },
];

function BiomePicker({
  biome,
  disabled,
  onBiomeChange,
}: {
  biome: Biome;
  disabled: boolean;
  onBiomeChange: (biome: Biome) => void;
}) {
  return (
    <ContextualPicker
      pickerId="biome-picker"
      value={biome}
      options={BIOME_OPTIONS}
      disabled={disabled}
      triggerLabel="Select biome"
      listboxLabel="Available biomes"
      onChange={onBiomeChange}
    />
  );
}

function PathModePicker({
  pathGeometryType,
  onPathGeometryTypeChange,
}: {
  pathGeometryType: PathGeometryType;
  onPathGeometryTypeChange: (geometryType: PathGeometryType) => void;
}) {
  return (
    <ContextualPicker
      pickerId="path-mode-picker"
      value={pathGeometryType}
      options={PATH_MODE_OPTIONS}
      disabled={false}
      triggerLabel="Path drawing mode"
      listboxLabel="Path drawing modes"
      onChange={onPathGeometryTypeChange}
    />
  );
}

function ContextualPicker<T extends string>({
  pickerId,
  value,
  options,
  disabled,
  triggerLabel,
  listboxLabel,
  onChange,
}: {
  pickerId: string;
  value: T;
  options: readonly ContextualPickerOption<T>[];
  disabled: boolean;
  triggerLabel: string;
  listboxLabel: string;
  onChange: (value: T) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState({ left: PICKER_VIEWPORT_MARGIN, top: PICKER_VIEWPORT_MARGIN });

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const closeForOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', closeForOutsidePointer);
    document.addEventListener('keydown', closeForEscape);
    return () => {
      document.removeEventListener('pointerdown', closeForOutsidePointer);
      document.removeEventListener('keydown', closeForEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return undefined;
    }

    const positionPopup = () => {
      const trigger = triggerRef.current;
      const popup = listboxRef.current;
      if (!trigger || !popup) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const maxLeft = Math.max(PICKER_VIEWPORT_MARGIN, window.innerWidth - popupRect.width - PICKER_VIEWPORT_MARGIN);
      const maxTop = Math.max(PICKER_VIEWPORT_MARGIN, window.innerHeight - popupRect.height - PICKER_VIEWPORT_MARGIN);
      const topBelow = triggerRect.bottom + PICKER_OFFSET;
      const topAbove = triggerRect.top - popupRect.height - PICKER_OFFSET;
      const top = topBelow + popupRect.height <= window.innerHeight - PICKER_VIEWPORT_MARGIN
        ? topBelow
        : Math.max(PICKER_VIEWPORT_MARGIN, Math.min(topAbove, maxTop));

      setPosition({
        left: Math.max(PICKER_VIEWPORT_MARGIN, Math.min(triggerRect.left, maxLeft)),
        top,
      });
    };

    positionPopup();
    window.addEventListener('resize', positionPopup);
    window.addEventListener('scroll', positionPopup);
    listboxRef.current?.focus();
    return () => {
      window.removeEventListener('resize', positionPopup);
      window.removeEventListener('scroll', positionPopup);
    };
  }, [open]);

  const chooseOption = (nextValue: T) => {
    onChange(nextValue);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActiveOption = (offset: number) => {
    setActiveIndex((current) => (current + offset + options.length) % options.length);
  };

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActiveOption(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveOption(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) {
        chooseOption(option.value);
      }
    }
  };

  const selectedLabel = options[selectedIndex]?.label ?? options[0]?.label ?? '';
  return (
    <div className="contextual-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="immersive-wood-button contextual-picker__trigger"
        aria-label={`${triggerLabel}: ${selectedLabel}`}
        aria-controls={`${pickerId}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setActiveIndex(selectedIndex);
            setOpen((current) => !current);
          }
        }}
      >
        <span>{selectedLabel}</span>
        <span className="contextual-picker__indicator" aria-hidden="true">▼</span>
      </button>

      {open && (
        <div
          id={`${pickerId}-listbox`}
          ref={listboxRef}
          className="contextual-picker__popup"
          role="listbox"
          aria-label={listboxLabel}
          aria-activedescendant={`${pickerId}-option-${options[activeIndex]?.value}`}
          tabIndex={-1}
          style={position}
          onKeyDown={handleListboxKeyDown}
        >
          <div className="contextual-picker__list">
            {options.map((option, index) => {
              const selected = option.value === value;
              const active = index === activeIndex;
              return (
                <div
                  id={`${pickerId}-option-${option.value}`}
                  key={option.value}
                  role="option"
                  aria-selected={selected}
                  aria-current={selected ? 'true' : undefined}
                  className={`immersive-wood-button contextual-picker__option${selected ? ' contextual-picker__option--selected' : ''}${active ? ' contextual-picker__option--active' : ''}`}
                  onClick={() => chooseOption(option.value)}
                  onMouseMove={() => setActiveIndex(index)}
                >
                  <span>{option.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function toolItem(tool: MapTool, label: string, shortcut: string) {
  return { id: tool, tool, label, shortcut };
}

function ToolButton({
  active,
  label,
  shortcut,
  showShortcut,
  onClick,
}: {
  active: boolean;
  label: string;
  shortcut: string;
  showShortcut: boolean;
  onClick: () => void;
}) {
  const shortcutDescription = `${label} — shortcut ${shortcut}`;
  return (
    <button
      type="button"
      className={active ? 'map-toolbar__tool map-toolbar__tool--active' : 'map-toolbar__tool'}
      aria-pressed={active}
      aria-label={shortcutDescription}
      title={shortcutDescription}
      onClick={onClick}
    >
      {label}{showShortcut && <> <kbd>{shortcut}</kbd></>}
    </button>
  );
}
