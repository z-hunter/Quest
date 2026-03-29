import React, { useState, useEffect } from 'react';
import { listProjectFiles, openProjectFolder } from '../platform/fileApi';

interface FileBrowserProps {
  mode: 'save' | 'load';
  directory: string; // e.g., 'public/scenes'
  defaultFilename?: string;
  onConfirm: (filename: string) => void;
  onCancel: () => void;
  title?: string;
  extension?: string;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({
  mode,
  directory,
  defaultFilename = '',
  onConfirm,
  onCancel,
  title,
  extension = '.json',
}) => {
  // Current Path State
  const [currentPath, setCurrentPath] = useState(directory);
  // Files State
  const [items, setItems] = useState<{ name: string; isDir: boolean }[]>([]);

  // Selection
  const [filename, setFilename] = useState(defaultFilename);
  // Smart Filter Term (Detached from filename)
  const [filterText, setFilterText] = useState('');

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial Path Sync
  useEffect(() => {
    setCurrentPath(directory);
    setFilterText(''); // Reset filter on dir change? Optional but good UX.
  }, [directory]);

  // Fetch when currentPath changes
  useEffect(() => {
    setIsLoading(true);
    setError(null);
    // Clear filter when changing directory
    setFilterText('');

    listProjectFiles(currentPath)
      .then((files) => {
        setItems(files);
      })
      .catch((err) => {
        const raw = String(err);
        if (raw.includes('Failed to fetch')) {
          setError(
            `File API is unavailable. Start the Vite dev server or run the desktop shell.`
          );
        } else {
          setError(raw);
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [currentPath]);

  // Derived: Can we go up?
  const canGoUp = currentPath.replace(/\\/g, '/') !== 'public';

  // Combine items for unified rendering and navigation
  const displayItems = React.useMemo(() => {
    const list: { name: string; isDir: boolean; isUp?: boolean }[] = [];
    if (canGoUp) {
      list.push({ name: '..', isDir: true, isUp: true });
    }

    // Smart Filter using filterText (not filename)
    let filtered = items;
    if (filterText && filterText.length > 0) {
      const lower = filterText.toLowerCase();
      filtered = items.filter((i) => i.isDir || i.name.toLowerCase().includes(lower));
    }

    return list.concat(filtered);
  }, [items, canGoUp, filterText]);

  // Selection Index for Keyboard Navigation
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  // Reset selection when path changes
  useEffect(() => {
    setSelectedIndex(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [currentPath]);

  // Clamp selection when list changes size
  useEffect(() => {
    setSelectedIndex((prev) => {
      const max = Math.max(0, displayItems.length - 1);
      return prev > max ? max : prev;
    });
  }, [displayItems.length]);

  // Scroll into view when selection changes
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el && listRef.current) {
      const container = listRef.current;
      const elTop = el.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      const cTop = container.scrollTop;
      const cBottom = cTop + container.clientHeight;

      if (elTop < cTop) {
        container.scrollTop = elTop;
      } else if (elBottom > cBottom) {
        container.scrollTop = elBottom - container.clientHeight;
      }
    }
    // Removed auto-sync to filename to prevent filter collapse during navigation
  }, [selectedIndex, displayItems]);

  const handleConfirm = () => {
    if (!filename) return;
    let finalName = filename;

    // Handle comma-separated extensions (e.g. ".mp3,.wav")
    const allowedExtensions = extension
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e);

    let hasValidExt = false;
    for (const ext of allowedExtensions) {
      if (finalName.toLowerCase().endsWith(ext)) {
        hasValidExt = true;
        break;
      }
    }

    // If no valid extension found, append the first one (default behavior)
    if (!hasValidExt && allowedExtensions.length > 0) {
      finalName += allowedExtensions[0];
    }

    const exists = items.some((i) => !i.isDir && i.name === finalName);
    if (mode === 'save' && exists) {
      if (!confirm(`Overwrite ${finalName}?`)) {
        return;
      }
    }

    let resultPath = finalName;
    // Relative path logic
    const base = directory.replace(/\\/g, '/');
    const curr = currentPath.replace(/\\/g, '/');

    if (curr !== base && curr.startsWith(base)) {
      const relDir = curr.substring(base.length + 1);
      if (relDir) resultPath = `${relDir}/${finalName}`;
    } else if (curr !== base) {
      // Up logic fallback
      if (curr.startsWith(base)) {
        const diff = curr.substring(base.length);
        if (diff.startsWith('/') || diff.startsWith('\\')) {
          resultPath = diff.substring(1) + '/' + finalName;
        } else if (diff) {
          resultPath = diff + '/' + finalName;
        }
      } else {
        const baseParts = base.split('/').filter((x) => x);
        const currParts = curr.split('/').filter((x) => x);
        let i = 0;
        while (i < baseParts.length && i < currParts.length && baseParts[i] === currParts[i]) i++;
        const upSteps = baseParts.length - i;
        const downSteps = currParts.slice(i);
        const relParts = [];
        for (let j = 0; j < upSteps; j++) relParts.push('..');
        relParts.push(...downSteps);
        relParts.push(finalName);
        resultPath = relParts.join('/');
      }
    }
    onConfirm(resultPath);
  };

  const handleUp = () => {
    const normalized = currentPath.replace(/\\/g, '/');
    if (normalized === 'public' || normalized === 'public/') return;
    const parts = normalized.split('/');
    if (parts.length > 1) {
      parts.pop();
      setCurrentPath(parts.join('/'));
    }
  };

  // Action wrappers for list interaction
  const handleSelect = (item: { name: string; isDir: boolean }) => {
    if (!item.isDir) {
      // Only update filename, NOT the filter!
      setFilename(item.name);
    }
  };

  const handleDoubleClick = (item: { name: string; isDir: boolean }) => {
    if (item.isDir) {
      setCurrentPath((prev) => `${prev}/${item.name}`.replace('//', '/'));
      setFilename('');
    } else {
      setFilename(item.name);
      setTimeout(() => handleConfirm(), 0);
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, displayItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = displayItems[selectedIndex];
      if (item) {
        if (item.isUp) handleUp();
        else handleDoubleClick(item);
      }
    }
  };

  // Focus Trap & Esc Key
  const modalRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="file-browser-modal">
      <div ref={modalRef} className="file-browser-window">
        <div className="file-browser-header">
          <div className="file-browser-title-row">
            <h3 style={{ margin: 0 }}>{title || (mode === 'save' ? 'Save File' : 'Load File')}</h3>
            <span className="file-browser-path">{currentPath}</span>
          </div>
          <button
            onClick={() => {
              void openProjectFolder(currentPath);
            }}
            title="Open in System Explorer"
            className="e-btn"
            style={{ marginLeft: '10px' }}
          >
            📁 Explore
          </button>
        </div>

        <div className="file-browser-list" ref={listRef} tabIndex={0} onKeyDown={handleListKeyDown}>
          {isLoading && <div>Loading...</div>}
          {error && <div className="file-browser-error">Error: {error}</div>}

          {!isLoading &&
            !error &&
            displayItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.name + (item.isUp ? '_up' : '')}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  onClick={() => {
                    setSelectedIndex(index);
                    if (item.isUp) return;
                    handleSelect(item);
                  }}
                  onDoubleClick={() => {
                    if (item.isUp) handleUp();
                    else handleDoubleClick(item);
                  }}
                  className={`file-browser-item ${item.isDir ? 'is-dir' : ''} ${isSelected ? 'is-selected' : ''}`}
                >
                  {item.isDir ? '📁' : '📄'} {item.name}
                </div>
              );
            })}
          {!isLoading && displayItems.length === 0 && (
            <div className="file-browser-empty">Directory is empty</div>
          )}
        </div>

        <div className="browser-footer">
          <div className="file-browser-form-row">
            <label className="file-browser-label">Name:</label>
            <input
              type="text"
              value={filename}
              className="e-input"
              onChange={(e) => {
                setFilename(e.target.value);
                setFilterText(e.target.value); // Sync filter only on manual input
              }}
              style={{ flex: 1 }}
              autoFocus
            />
          </div>
          <div className="file-browser-actions">
            <button onClick={onCancel} className="e-btn" style={{ padding: '5px 15px' }}>
              Cancel
            </button>
            <button onClick={handleConfirm} className="e-btn e-btn-enter" style={{ padding: '5px 15px' }}>
              {mode === 'save' ? 'Save' : 'Load'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
