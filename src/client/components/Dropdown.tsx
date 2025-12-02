import React, { useState, useEffect, useRef } from 'react';
import { colors } from '../constants';

interface DropdownProps {
  value: string;
  options: { id: string; name: string; desc: string }[];
  onChange: (id: string) => void;
  label: string;
  disabled?: boolean;
}

export const Dropdown = ({ value, options, onChange, label, disabled = false }: DropdownProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = options.find(o => o.id === value);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          background: 'transparent',
          border: `1px solid ${colors.borderDefault}`,
          borderRadius: '6px',
          padding: '6px 10px',
          color: disabled ? colors.textMuted : colors.textSecondary,
          fontSize: '11px',
          fontFamily: 'ui-monospace, monospace',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all 0.15s ease',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ color: colors.textTertiary, textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.5px' }}>{label}</span>
        <span style={{ color: colors.textPrimary }}>{selected?.name}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.5 }}>
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      
      {open && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          marginBottom: '4px',
          background: colors.elevated,
          border: `1px solid ${colors.borderDefault}`,
          borderRadius: '8px',
          padding: '4px',
          minWidth: '160px',
          maxHeight: '240px',
          overflowY: 'auto',
          boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
          zIndex: 10,
        }}>
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 10px',
                background: opt.id === value ? colors.brandSoft : 'transparent',
                border: 'none',
                borderRadius: '4px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ color: colors.textPrimary, fontSize: '12px', fontWeight: 500 }}>{opt.name}</div>
              <div style={{ color: colors.textTertiary, fontSize: '10px', marginTop: '2px' }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

