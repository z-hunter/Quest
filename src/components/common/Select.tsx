import React, { useState, useRef, useEffect } from 'react';

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
}

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  placeholder,
  style,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null); // Ref for options container
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');

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
      const idx = options.findIndex((opt) => opt.value === value);
      setFocusedIndex(idx);

      // Focus container to capture keys
      if (containerRef.current) {
        containerRef.current.focus();
      }
    }
  }, [isOpen, value, options]);

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
        setFocusedIndex((prev) => Math.min(prev + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIndex >= 0) {
          handleSelect(options[focusedIndex].value);
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
      tabIndex={0} // Make focusable for keyboard events
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="custom-select-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '4px',
        }}
      >
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
        <span className="custom-select-caret" aria-hidden="true" />
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
            // Removed 'right: 0' to allow expansion
            minWidth: '100%', // At least as wide as trigger
            width: 'max-content', // Allow growing to fit content
            zIndex: 1000,
            maxHeight: '200px',
            overflowY: 'auto',
          }}
        >
          {options.map((opt, idx) => (
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
          ))}
        </div>
      )}
    </div>
  );
};
