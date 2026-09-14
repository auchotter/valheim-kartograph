import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Id, MapRecord } from '../../../shared/domain';
import type { MapActionResult } from '../state/useMapSession';

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
}: MapMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeActionsFor, setActiveActionsFor] = useState<Id | null>(null);
  const [form, setForm] = useState<MenuForm | null>(null);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const currentMapName = maps.find((map) => map.id === currentMapId)?.name ?? 'Maps';

  const close = () => {
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
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        close();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const openForm = (nextForm: MenuForm) => {
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
      <button
        type="button"
        className="map-menu__toggle"
        title="Open the map library and manage maps"
        aria-label="Open the map library and manage maps"
        aria-expanded={open}
        aria-controls="map-management-panel"
        onClick={() => {
          setOpen((visible) => !visible);
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
                <button type="button" disabled={disabled} onClick={() => openForm({ kind: 'create' })}>
                  + New map
                </button>
              </header>

              <div className="map-menu__list" role="list">
                {maps.map((map) => {
                  const selected = map.id === currentMapId;
                  const actionsOpen = activeActionsFor === map.id;
                  return (
                    <div key={map.id} className={selected ? 'map-menu__row map-menu__row--selected' : 'map-menu__row'}>
                      <button
                        type="button"
                        className="map-menu__map-button"
                        disabled={disabled}
                        aria-current={selected ? 'true' : undefined}
                        onClick={() => void selectMap(map.id)}
                      >
                        <span className="map-menu__selection" aria-hidden="true">
                          {selected ? '✓' : ''}
                        </span>
                        <span>{map.name}</span>
                      </button>
                      <button
                        type="button"
                        className="map-menu__actions-toggle"
                        aria-label={`Actions for ${map.name}`}
                        aria-expanded={actionsOpen}
                        disabled={disabled}
                        onClick={() => setActiveActionsFor((current) => (current === map.id ? null : map.id))}
                      >
                        ⋯
                      </button>
                      {actionsOpen && (
                        <div className="map-menu__actions" role="group" aria-label={`Actions for ${map.name}`}>
                          <button type="button" disabled={disabled} onClick={() => openForm({ kind: 'rename', map })}>
                            Rename
                          </button>
                          <button type="button" disabled={disabled} onClick={() => openForm({ kind: 'duplicate', map })}>
                            Duplicate
                          </button>
                          <button
                            type="button"
                            className="map-menu__delete"
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
                <button type="button" disabled={disabled} onClick={() => openFormBack(setForm, setFormError)}>
                  Cancel
                </button>
                <button type="submit" disabled={disabled} className={form.kind === 'delete' ? 'map-menu__delete' : undefined}>
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
