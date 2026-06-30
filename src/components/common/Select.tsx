import React, { useState, useRef, useEffect, useMemo } from 'react';

interface Option {
  label: string;
  value: string;
  icon?: string;
}

interface SelectProps {
  options: Option[];
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string; // Additional classes
  filterable?: boolean; // Enable inline filtering input when open
}

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  style,
  className,
  filterable = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null); // Ref for options container
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  const [filterQuery, setFilterQuery] = useState('');

  // Calculate placement options based on search query
  const filteredOptions = useMemo(() => {
    if (!filterable || !filterQuery) return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(filterQuery.toLowerCase()));
  }, [options, filterable, filterQuery]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Calculate position
  useEffect(() => {
    if (isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      // Check space below
      const spaceBelow = window.innerHeight - rect.bottom;
      // Needed space (approx 200px max height)
      if (spaceBelow < 220) {
        setPlacement('top');
      } else {
        setPlacement('bottom');
      }
    }
  }, [isOpen]);

  // Handle initial focus index
  useEffect(() => {
    if (isOpen) {
      const idx = filteredOptions.findIndex((opt) => opt.value === value);
      setFocusedIndex(idx >= 0 ? idx : 0);

      // Focus container to capture keys (if not filterable, otherwise input handles focus)
      if (!filterable && containerRef.current) {
        containerRef.current.focus();
      }
    }
  }, [isOpen, value, filteredOptions, filterable]);

  // Adjust focusedIndex when filteredOptions changes
  useEffect(() => {
    if (isOpen && filterable) {
      setFocusedIndex((prev) => {
        if (filteredOptions.length === 0) return -1;
        if (prev >= filteredOptions.length) return 0;
        return prev >= 0 ? prev : 0;
      });
    }
  }, [filteredOptions, isOpen, filterable]);

  // Reset filter query when dropdown closes
  useEffect(() => {
    if (!isOpen) {
      setFilterQuery('');
    }
  }, [isOpen]);

  // Scroll focused item into view
  useEffect(() => {
    if (isOpen && optionsRef.current && focusedIndex >= 0) {
      const optionEl = optionsRef.current.children[focusedIndex] as HTMLElement;
      if (optionEl) {
        optionEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex, isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, filteredOptions.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0 && filteredOptions[focusedIndex]) {
          handleSelect(filteredOptions[focusedIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption ? selectedOption.label : placeholder || 'Select...';

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${className || ''}`}
      style={{
        position: 'relative',
        cursor: 'pointer',
        outline: 'none', // Handle focus style via CSS if needed
        ...style,
      }}
      tabIndex={filterable && isOpen ? -1 : 0} // Make container unfocusable when typing in input
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="custom-select-trigger"
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen && filterable) {
            // Clicking the input area or trigger area while filtering shouldn't toggle/close it
            return;
          }
          setIsOpen(!isOpen);
        }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px',
        }}
      >
        {isOpen && filterable ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              position: 'relative',
              boxSizing: 'border-box',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              className="e-input"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter..."
              autoFocus
              style={{
                width: '100%',
                boxSizing: 'border-box',
                paddingRight: filterQuery ? '20px' : '4px',
                height: '18px',
                border: 'none',
                background: 'transparent',
                color: 'var(--ui-input-text, #79efa4)',
                fontFamily: 'inherit',
                fontSize: 'inherit',
                outline: 'none',
                paddingTop: 0,
                paddingBottom: 0,
                paddingLeft: 0,
              }}
            />
            {filterQuery && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFilterQuery('');
                }}
                style={{
                  position: 'absolute',
                  right: '0',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--ui-label-color, #888)',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: '10px',
                  fontWeight: 'bold',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '16px',
                  height: '16px',
                }}
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
            {selectedOption?.icon && (
              <div
                style={{
                  width: '1em',
                  height: '1em',
                  marginRight: '6px',
                  backgroundColor: 'currentColor',
                  maskImage: `url("${selectedOption.icon}")`,
                  WebkitMaskImage: `url("${selectedOption.icon}")`,
                  maskSize: 'contain',
                  maskRepeat: 'no-repeat',
                  maskPosition: 'center',
                  flexShrink: 0,
                }}
              />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayLabel}
            </span>
          </div>
        )}
        {!(isOpen && filterable) && <span className="custom-select-caret" aria-hidden="true" />}
      </div>

      {isOpen && (
        <div
          className="custom-select-options"
          ref={optionsRef}
          style={{
            position: 'absolute',
            top: placement === 'bottom' ? '100%' : 'auto',
            bottom: placement === 'top' ? '100%' : 'auto',
            left: 0,
            minWidth: '100%',
            width: 'max-content',
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          {filteredOptions.length === 0 ? (
            <div
              className="custom-option"
              style={{
                padding: '4px',
                color: 'var(--ui-label-color, #888)',
                fontStyle: 'italic',
                cursor: 'default',
              }}
            >
              No matches found
            </div>
          ) : (
            filteredOptions.map((opt, idx) => (
              <div
                key={opt.value}
                className={`custom-option ${opt.value === value ? 'selected' : ''} ${idx === focusedIndex ? 'focused' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(opt.value);
                }}
                onMouseEnter={() => setFocusedIndex(idx)}
                style={{
                  padding: '4px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {opt.icon && (
                  <div
                    style={{
                      width: '1em',
                      height: '1em',
                      marginRight: '6px',
                      backgroundColor: 'currentColor',
                      maskImage: `url("${opt.icon}")`,
                      WebkitMaskImage: `url("${opt.icon}")`,
                      maskSize: 'contain',
                      maskRepeat: 'no-repeat',
                      maskPosition: 'center',
                      flexShrink: 0,
                    }}
                  />
                )}
                {opt.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
