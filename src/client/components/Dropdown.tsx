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
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  useEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      // Position below the button with a small gap
      setCoords({
        top: rect.bottom + 6,
        left: rect.left,
        width: Math.max(rect.width, 200) // Minimum width for readability
      });
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Close if clicking outside the button (the menu handles its own clicks)
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Check if click is inside the portal menu (we'll add a data attribute or ID to check)
        const menu = document.getElementById('titanium-dropdown-menu');
        if (menu && menu.contains(e.target as Node)) return;
        setOpen(false);
      }
    };
    const scrollHandler = (e: Event) => {
      // If scrolling inside the dropdown menu, don't close
      const menu = document.getElementById('titanium-dropdown-menu');
      if (menu && (e.target === menu || menu.contains(e.target as Node))) return;
      setOpen(false);
    };

    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', () => setOpen(false));

    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', () => setOpen(false));
    };
  }, []);

  const selected = options.find(o => o.id === value);
  const ReactDOM = require('react-dom');

  return (
    <div ref={ref} style={{ position: 'relative', height: '100%' }}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '0 12px',
          height: '100%',
          color: disabled ? colors.textMuted : colors.textSecondary,
          fontSize: '12px',
          fontFamily: 'system-ui, sans-serif',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          transition: 'all 0.15s ease',
          opacity: disabled ? 0.5 : 1,
          minWidth: '120px',
          justifyContent: 'space-between',
        }}
        onMouseEnter={e => !disabled && (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
        onMouseLeave={e => !disabled && (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {label && <span style={{ color: colors.textTertiary, textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.5px' }}>{label}</span>}
          <span style={{ color: colors.textSecondary, fontWeight: 500 }}>{selected?.name}</span>
        </div>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.4, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          <path d="M2 4L5 7L8 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && portalContainer && ReactDOM.createPortal(
        <div
          id="titanium-dropdown-menu"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: coords.width,
            background: '#1C1C1C',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px',
            padding: '4px',
            maxHeight: '300px',
            overflowY: 'auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.2)',
            zIndex: 999999, // Ensure it's on top of everything
            animation: 'fadeIn 0.1s ease-out',
          }}
        >
          {options.map(opt => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                background: opt.id === value ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                textAlign: 'left',
                cursor: 'pointer',
                marginBottom: '2px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => opt.id !== value && (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
              onMouseLeave={e => opt.id !== value && (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ color: opt.id === value ? colors.textPrimary : colors.textSecondary, fontSize: '13px', fontWeight: 500 }}>{opt.name}</div>
              <div style={{ color: colors.textTertiary, fontSize: '11px', marginTop: '2px' }}>{opt.desc}</div>
            </button>
          ))}
        </div>,
        portalContainer
      )}
    </div>
  );
};

