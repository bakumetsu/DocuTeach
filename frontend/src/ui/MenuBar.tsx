import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useApp } from '../state/store';
import { Popover } from './Popover';

interface MenuItem {
  label: string;
  id?: string;
  // checkbox-style (theme toggle)
  checkbox?: boolean;
  kind?: 'theme' | 'bg' | 'spell' | 'stats';
  // non-interactive group label shown above this item
  group?: string;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

const MENUS: MenuDef[] = [
  {
    label: 'File',
    items: [
      { label: 'New lesson', id: 'file.new' },
      { label: 'Lessons…', id: 'file.lessons' },
      { label: 'Import .md…', id: 'file.open' },
      { label: 'Export .md…', id: 'file.saveAs' },
      { label: 'Page style…', id: 'tools.pageStyle' },
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
    label: 'Options',
    items: [
      { label: 'Spell check', checkbox: true, kind: 'spell', group: 'Editor' },
      { label: 'Dark theme', checkbox: true, kind: 'theme', group: 'Theme' },
      { label: 'Color theme…', id: 'options.colorTheme' },
      { label: 'Gradient background', checkbox: true, kind: 'bg' },
      { label: 'Skills…', id: 'options.skills', group: 'Skills' },
      { label: 'Models…', id: 'options.models', group: 'Models' },
      { label: 'Show token stats', checkbox: true, kind: 'stats' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Keyboard shortcuts', id: 'help.shortcuts' },
      { label: 'Install fonts', id: 'help.installFonts' },
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
  // Anchor element for the currently open menu. Captured from titleRefs at
  // the moment the menu opens (inside an event handler), never in render
  // or a ref callback.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  const titleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const background = useApp((s) => s.background);
  const setBackground = useApp((s) => s.setBackground);
  const spellcheck = useApp((s) => s.spellcheck);
  const setSpellcheck = useApp((s) => s.setSpellcheck);
  const tokenStats = useApp((s) => s.tokenStats);
  const setTokenStats = useApp((s) => s.setTokenStats);
  const saveState = useApp((s) => s.saveState);
  const fileName = useApp((s) => s.fileName);
  const dirty = useApp((s) => s.dirty);

  const closeMenu = useCallback(() => {
    setOpenMenu(null);
    setActiveItem(0);
    setAnchor(null);
  }, []);

  const openMenuAt = useCallback((idx: number) => {
    setOpenMenu(idx);
    setActiveItem(0);
    // Read the anchor element now, while opening, and store it in state.
    setAnchor(titleRefs.current[idx] ?? null);
  }, []);

  const isChecked = (kind?: MenuItem['kind']) =>
    kind === 'bg' ? background === 'gradient' : kind === 'spell' ? spellcheck : kind === 'stats' ? tokenStats : theme === 'dark';

  const activateItem = useCallback(
    (menuIdx: number, itemIdx: number) => {
      const item = MENUS[menuIdx].items[itemIdx];
      if (item.checkbox) {
        if (item.kind === 'bg') {
          setBackground(background === 'gradient' ? 'flat' : 'gradient');
        } else if (item.kind === 'spell') {
          setSpellcheck(!spellcheck);
        } else if (item.kind === 'stats') {
          setTokenStats(!tokenStats);
        } else {
          setTheme(theme === 'dark' ? 'light' : 'dark');
        }
      } else if (item.id) {
        onAction(item.id);
      }
      closeMenu();
    },
    [theme, background, spellcheck, tokenStats, setTheme, setBackground, setSpellcheck, setTokenStats, onAction, closeMenu],
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
            anchor={openMenu === mi ? anchor : null}
            open={openMenu === mi}
            onClose={closeMenu}
          >
            <div className="menu-list" role="menu" aria-label={menu.label}>
              {menu.items.map((item, ii) => (
                <Fragment key={item.label}>
                  {item.group && (
                    <div className="menu-group" role="presentation">{item.group}</div>
                  )}
                  <button
                    ref={(el) => {
                      itemRefs.current[ii] = el;
                    }}
                    type="button"
                    role={item.checkbox ? 'menuitemcheckbox' : 'menuitem'}
                    aria-checked={item.checkbox ? isChecked(item.kind) : undefined}
                    tabIndex={-1}
                    className={`menu-item${activeItem === ii ? ' active' : ''}`}
                    onClick={() => activateItem(mi, ii)}
                    onMouseEnter={() => setActiveItem(ii)}
                  >
                    {item.checkbox && (
                      <span className="check">{isChecked(item.kind) ? '✓' : ''}</span>
                    )}
                    <span>{item.label}</span>
                  </button>
                </Fragment>
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
