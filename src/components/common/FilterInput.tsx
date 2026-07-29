import React from 'react';

interface FilterInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value: string;
  onClear: () => void;
  containerStyle?: React.CSSProperties;
  showClearButton?: boolean;
}

export const FilterInput = React.forwardRef<HTMLInputElement, FilterInputProps>(
  ({ value, onClear, containerStyle, style, className, showClearButton, ...props }, ref) => {
    const shouldShowClearButton = showClearButton !== undefined ? showClearButton : !!value;
    return (
      <div style={{ position: 'relative', display: 'flex', flex: 1, ...containerStyle }}>
        <input
          ref={ref}
          type="text"
          className={className || 'e-input'}
          value={value}
          style={{
            width: '100%',
            paddingRight: shouldShowClearButton ? '28px' : undefined,
            ...style,
          }}
          {...props}
        />
        {shouldShowClearButton && (
          <button
            className="toolbar-icon-btn"
            type="button"
            title="Clear"
            aria-label="Clear filter"
            onClick={onClear}
            style={{
              position: 'absolute',
              right: '2px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '22px',
              height: '22px',
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            x
          </button>
        )}
      </div>
    );
  }
);
FilterInput.displayName = 'FilterInput';
