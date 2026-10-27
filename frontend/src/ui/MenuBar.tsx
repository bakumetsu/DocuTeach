import { useCallback, useEffect, useRef, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useApp } from '../state/store';
import { Popover } from './Popover';

interface MenuItem {
  label: string;
  id?: string;
  // checkbox-style (theme toggle)
  checkbox?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

const MENUS: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'New', id: 'file.new' },
      { label: 'Open…', id: 'file.open' },
      { label: 'Save', id: 'file.save' },
      { label: 'Save as…', id: 'file.saveAs' },
      { label: 'Split into files…', id: 'file.split' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Revert', id: 'edit.undo' },
      { label: 'Redo', id: 'edit.redo' },
      { label: 'Save checkpoint…', id: 'edit.checkpoint' },
      { label: 'Checkpoints…', id: 'edit.checkpoints' },
    ],
  },
  {
    label: 'Tools',
    items: [{ label: 'Page style…', id: 'tools.pageStyle' }],
  },
  {
    label: 'Options',
    items: [{ label: 'Dark theme', checkbox: true }],
  },
  {
    label: 'Help',
    items: [
      { label: 'Keyboard shortcuts', id: 'help.shortcuts' },
      { label: 'About', id: 'help.about' },
    ],
  },
];

interface MenuBarProps {
  onAction: (id: string) => void;
}

export function MenuBar({ onAction }: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [activeItem, setActiveItem] = useState(0);
  const [titleEls, setTitleEls] = useState<(HTMLButtonElement | null)[]>([]);

  const titleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const saveState = useApp((s) => s.saveState);
  const fileName = useApp((s) => s.fileName);
  const dirty = useApp((s) => s.dirty);

  const closeMenu = useCallback(() => {
    setOpenMenu(null);
    setActiveItem(0);
  }, []);

  const openMenuAt = useCallback((idx: number) => {
    setOpenMenu(idx);
    setActiveItem(0);
  }, []);

  const activateItem = useCallback(
    (menuIdx: number, itemIdx: number) => {
      const item = MENUS[menuIdx].items[itemIdx];
      if (item.checkbox) {
        setTheme(theme === 'dark' ? 'light' : 'dark');
      } else if (item.id) {
        onAction(item.id);
      }
      closeMenu();
    },
    [theme, setTheme, onAction, closeMenu],
  );

  // Focus management
  useEffect(() => {
    if (openMenu !== null) {
      const el = itemRefs.current[activeItem];
      el?.focus();
    }
  }, [openMenu, activeItem]);

  // Keyboard handling on the menubar
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (openMenu === null) {
        // A title button is focused
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          const idx = titleRefs.current.findIndex((el) => el === document.activeElement);
          if (idx >= 0) openMenuAt(idx);
        }
        return;
      }

      const items = MENUS[openMenu].items;

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          openMenuAt((openMenu + 1) % MENUS.length);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          openMenuAt((openMenu - 1 + MENUS.length) % MENUS.length);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveItem((i) => (i + 1) % items.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveItem((i) => (i - 1 + items.length) % items.length);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          activateItem(openMenu, activeItem);
          break;
        case 'Escape':
          e.preventDefault();
          closeMenu();
          break;
      }
    },
    [openMenu, activeItem, openMenuAt, activateItem, closeMenu],
  );

  // Save indicator text derived from SaveState object
  let saveText = '';
  let saveTitle: string | undefined;
  switch (saveState.kind) {
    case 'saving':
      saveText = 'Saving…';
      break;
    case 'saved':
      saveText = `Saved ${saveState.at}`;
      break;
    case 'error':
      saveText = 'Not saved';
      saveTitle = saveState.reason;
      break;
    case 'idle':
      break;
  }

  return (
    <nav className="menubar" onKeyDown={handleKeyDown}>
      {MENUS.map((menu, mi) => (
        <div className="menu" key={menu.label}>
          <button
            ref={(el) => {
              titleRefs.current[mi] = el;
              setTitleEls((prev) => {
                if (prev[mi] === el) return prev;
                const next = [...prev];
                next[mi] = el;
                return next;
              });
            }}
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === mi}
            onClick={() => {
              if (openMenu === mi) {
                closeMenu();
              } else {
                openMenuAt(mi);
              }
            }}
          >
            {menu.label}
          </button>

          <Popover
            anchor={titleEls[mi] ?? null}
            open={openMenu === mi}
            onClose={closeMenu}
          >
            <div className="menu-list" role="menu" aria-label={menu.label}>
              {menu.items.map((item, ii) => (
                <button
                  key={item.label}
                  ref={(el) => {
                    itemRefs.current[ii] = el;
                  }}
                  type="button"
                  role={item.checkbox ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={item.checkbox ? theme === 'dark' : undefined}
                  tabIndex={-1}
                  className={`menu-item${activeItem === ii ? ' active' : ''}`}
                  onClick={() => activateItem(mi, ii)}
                  onMouseEnter={() => setActiveItem(ii)}
                >
                  {item.checkbox && (
                    <span className="check">{theme === 'dark' ? '✓' : ''}</span>
                  )}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </Popover>
        </div>
      ))}

      {/* Right side: save indicator + theme toggle */}
      <div className="save-indicator">
        {fileName && (
          <span>{fileName}</span>
        )}
        {dirty && (
          <span className="dot" title="Unsaved changes" aria-label="Unsaved changes" />
        )}
        {saveText && (
          <span title={saveTitle}>{saveText}</span>
        )}
      </div>

      <button
        className="icon-btn"
        aria-label="Toggle theme"
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>
    </nav>
  );
}
