import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Id, MapRecord } from '../../../shared/domain';
import type { MapActionResult } from '../state/useMapSession';
import { createPortableMap, parsePortableMapJson, portableFilename, MAP_FILE_EXTENSION, MAP_FILE_MIME, MAX_MAP_FILE_BYTES, type PortableMap, type PortableWorkspace } from '../../../shared/portableMap';
import { exportMap } from '../api/maps';

type MenuForm =
  | { kind: 'create' }
  | { kind: 'rename'; map: MapRecord }
  | { kind: 'duplicate'; map: MapRecord }
  | { kind: 'delete'; map: MapRecord };

interface MapMenuProps {
  maps: readonly MapRecord[];
  currentMapId: Id | null;
  disabled: boolean;
  error: string | null;
  onSelectMap: (mapId: Id) => Promise<MapActionResult>;
  onCreateMap: (name: string) => Promise<MapActionResult>;
  onRenameMap: (mapId: Id, name: string) => Promise<MapActionResult>;
  onDuplicateMap: (mapId: Id, name: string) => Promise<MapActionResult>;
  onDeleteMap: (mapId: Id) => Promise<MapActionResult>;
  onImportMap: (snapshot: PortableMap) => Promise<MapActionResult>;
  workspace: PortableWorkspace;
}

export function MapMenu({
  maps,
  currentMapId,
  disabled,
  error,
  onSelectMap,
  onCreateMap,
  onRenameMap,
  onDuplicateMap,
  onDeleteMap,
  onImportMap,
  workspace,
}: MapMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const portableButtonRef = useRef<HTMLButtonElement>(null);
  const portableDrawerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const consumeOutsideClickRef = useRef(false);
  const [portableOpen, setPortableOpen] = useState(false);
  const [portableBusy, setPortableBusy] = useState(false);
  const [portableListHeight, setPortableListHeight] = useState<number | null>(null);
  const [portableDrawerHeight, setPortableDrawerHeight] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeActionsFor, setActiveActionsFor] = useState<Id | null>(null);
  const [form, setForm] = useState<MenuForm | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const currentMapName = maps.find((map) => map.id === currentMapId)?.name ?? 'Maps';

  const close = () => {
    setPortableOpen(false);
    setPortableListHeight(null);
    setPortableDrawerHeight(null);
    setOpen(false);
    setActiveActionsFor(null);
    setForm(null);
    setFormError(null);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const onPointerDown = (event: PointerEvent) => {
      consumeOutsideClickRef.current = false;
      const inPortableUtility =
        event.target instanceof Node
        && (portableButtonRef.current?.contains(event.target) || portableDrawerRef.current?.contains(event.target));
      if (portableOpen && !inPortableUtility) {
        consumeOutsideClickRef.current = true;
        setPortableOpen(false);
        setPortableListHeight(null);
        setPortableDrawerHeight(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    };
    const onLibraryPointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        close();
      }
    };
    const onClick = (event: MouseEvent) => {
      if (!consumeOutsideClickRef.current) return;
      consumeOutsideClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (portableOpen) setPortableOpen(false);
        else close();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerdown', onLibraryPointerDown);
    window.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerdown', onLibraryPointerDown);
      window.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, portableOpen]);

  useLayoutEffect(() => {
    if (!portableOpen) return;
    setPortableDrawerHeight(portableDrawerRef.current?.getBoundingClientRect().height ?? null);
  }, [portableOpen]);

  const download = async () => {
    if (!currentMapId || disabled || portableBusy) return;
    setPortableBusy(true);
    setFormError(null);
    try {
      const snapshot = createPortableMap(await exportMap(currentMapId), workspace);
      const blob = new Blob([JSON.stringify(snapshot, null, 2) + '\n'], { type: MAP_FILE_MIME });
      if (blob.size > MAX_MAP_FILE_BYTES) throw new Error('Valheim Kartograph export exceeds the 64 MiB file limit.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = portableFilename(snapshot.map.name);
      document.body.append(link);
      link.click();
      link.remove();
      // Allow the browser to begin consuming the download before releasing its URL.
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPortableOpen(false);
      setPortableListHeight(null);
      setPortableDrawerHeight(null);
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Valheim Kartograph map export failed.'); }
    finally { setPortableBusy(false); }
  };

  const upload = async (file: File) => {
    if (disabled || portableBusy) return;
    setPortableBusy(true);
    setFormError(null);
    try {
      if (file.size > MAX_MAP_FILE_BYTES) throw new Error('Valheim Kartograph map files must be at most 64 MiB.');
      const result = await onImportMap(parsePortableMapJson(await file.text()));
      if (!result.ok) throw new Error(result.error ?? 'Valheim Kartograph map import failed.');
      close();
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Valheim Kartograph map import failed.'); }
    finally { setPortableBusy(false); }
  };

  const openForm = (nextForm: MenuForm) => {
    setPortableOpen(false);
    setPortableListHeight(null);
    setPortableDrawerHeight(null);
    setForm(nextForm);
    setActiveActionsFor(null);
    setFormError(null);
    setName(nextForm.kind === 'rename' ? nextForm.map.name : '');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (form === null) {
      return;
    }

    let result: MapActionResult;
    switch (form.kind) {
      case 'create':
        result = await onCreateMap(name);
        break;
      case 'rename':
        result = await onRenameMap(form.map.id, name);
        break;
      case 'duplicate':
        result = await onDuplicateMap(form.map.id, name);
        break;
      case 'delete':
        result = await onDeleteMap(form.map.id);
        break;
    }

    if (result.ok) {
      close();
    } else {
      setFormError(result.error ?? 'Map action failed.');
    }
  };

  const selectMap = async (mapId: Id) => {
    if (mapId === currentMapId) {
      close();
      return;
    }
    const result = await onSelectMap(mapId);
    if (result.ok) {
      close();
    } else {
      setFormError(result.error ?? 'Unable to switch maps.');
    }
  };

  return (
    <div ref={rootRef} className="map-menu">
      <input ref={fileRef} type="file" hidden accept={`${MAP_FILE_EXTENSION},.json,${MAP_FILE_MIME}`}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file); }} />
      <button
        type="button"
        className="map-menu__toggle utility-control"
        title="Open the map library and manage maps"
        aria-label="Open the map library and manage maps"
        aria-expanded={open}
        aria-controls="map-management-panel"
        onClick={() => {
          setOpen((visible) => !visible);
          setPortableOpen(false);
          setPortableListHeight(null);
          setPortableDrawerHeight(null);
          setForm(null);
          setFormError(null);
        }}
      >
        <span className="map-menu__toggle-label">{currentMapName}</span>
      </button>

      {open && (
        <section id="map-management-panel" className="map-menu__panel" aria-label="Map management">
          {form === null ? (
            <>
              <header className="map-menu__header">
                <strong>Maps</strong>
                <button ref={portableButtonRef} type="button" className="map-menu__actions-toggle map-menu__portable-toggle immersive-wood-button"
                  aria-label="Import or export map" title="Import or export map" aria-expanded={portableOpen}
                  disabled={disabled || portableBusy} onClick={() => {
                    if (!portableOpen) {
                      setPortableListHeight(listRef.current?.getBoundingClientRect().height ?? null);
                      setPortableDrawerHeight(null);
                    } else {
                      setPortableListHeight(null);
                      setPortableDrawerHeight(null);
                    }
                    setPortableOpen(value => !value);
                    setActiveActionsFor(null);
                  }}>
                  ⋯
                </button>
                <button type="button" className="immersive-wood-button" disabled={disabled} onClick={() => openForm({ kind: 'create' })}>
                  NEW MAP
                </button>
              </header>

              {portableOpen && <div ref={portableDrawerRef} className="map-menu__portable-drawer" role="group" aria-label="Import or export map">
                <button type="button" className="immersive-wood-button" disabled={disabled || portableBusy} onClick={() => fileRef.current?.click()}>IMPORT MAP</button>
                <button type="button" className="immersive-wood-button" disabled={disabled || portableBusy || !currentMapId} onClick={() => void download()}>EXPORT CURRENT MAP</button>
              </div>}

              <div ref={listRef} className="map-menu__list" role="list" style={portableOpen && portableListHeight !== null && portableDrawerHeight !== null
                ? { height: `${Math.max(0, portableListHeight - portableDrawerHeight)}px` }
                : undefined}>
                {maps.map((map) => {
                  const selected = map.id === currentMapId;
                  const actionsOpen = activeActionsFor === map.id;
                  return (
                    <div key={map.id} className={selected ? 'map-menu__row map-menu__row--selected' : 'map-menu__row'}>
                      <button
                        type="button"
                        className="map-menu__map-button immersive-wood-button"
                        disabled={disabled}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => void selectMap(map.id)}
                      >
                        <span>{map.name}</span>
                      </button>
                      <button
                        type="button"
                        className="map-menu__actions-toggle immersive-wood-button"
                        aria-label={`Actions for ${map.name}`}
                        aria-expanded={actionsOpen}
                        disabled={disabled}
                        onClick={() => setActiveActionsFor((current) => (current === map.id ? null : map.id))}
                      >
                        ⋯
                      </button>
                      {actionsOpen && (
                        <div className="map-menu__actions" role="group" aria-label={`Actions for ${map.name}`}>
                          <button type="button" className="immersive-wood-button" disabled={disabled} onClick={() => openForm({ kind: 'rename', map })}>
                            Rename
                          </button>
                          <button type="button" className="immersive-wood-button" disabled={disabled} onClick={() => openForm({ kind: 'duplicate', map })}>
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className="map-menu__delete immersive-wood-button immersive-wood-button--danger"
                            disabled={disabled}
                            onClick={() => openForm({ kind: 'delete', map })}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {(formError ?? error) !== null && <p className="map-menu__error" role="alert">{formError ?? error}</p>}
            </>
          ) : (
            <form className="map-menu__form" onSubmit={(event) => void submit(event)}>
              <h2>{formTitle(form)}</h2>
              {form.kind === 'delete' ? (
                <p>
                  Delete <strong>{form.map.name}</strong>? This cannot be undone from the menu.
                </p>
              ) : (
                <label>
                  <span>Map name</span>
                  <input
                    className="immersive-recessed-field"
                    autoFocus
                    value={name}
                    maxLength={200}
                    disabled={disabled}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              )}
              {(formError ?? error) !== null && <p className="map-menu__error" role="alert">{formError ?? error}</p>}
              <footer>
                <button type="button" className="immersive-wood-button" disabled={disabled} onClick={() => openFormBack(setForm, setFormError)}>
                  Cancel
                </button>
                <button type="submit" disabled={disabled} className={form.kind === 'delete' ? 'map-menu__delete immersive-wood-button immersive-wood-button--danger' : 'immersive-wood-button'}>
                  {form.kind === 'delete' ? 'Delete map' : form.kind === 'rename' ? 'Rename map' : 'Save'}
                </button>
              </footer>
            </form>
          )}
        </section>
      )}
    </div>
  );
}

function formTitle(form: MenuForm): string {
  switch (form.kind) {
    case 'create':
      return 'New map';
    case 'rename':
      return `Rename ${form.map.name}`;
    case 'duplicate':
      return `Duplicate ${form.map.name}`;
    case 'delete':
      return 'Delete map';
  }
}

function openFormBack(
  setForm: (value: MenuForm | null) => void,
  setError: (value: string | null) => void,
): void {
  setForm(null);
  setError(null);
}
