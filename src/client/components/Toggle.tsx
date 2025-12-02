import React from 'react';
import { colors } from '../constants';

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}

export const Toggle = ({ value, onChange, label, disabled = false }: ToggleProps) => (
  <button
    onClick={() => !disabled && onChange(!value)}
    disabled={disabled}
    style={{
      background: 'transparent',
      border: `1px solid ${value ? colors.brand : colors.borderDefault}`,
      borderRadius: '6px',
      padding: '6px 10px',
      color: value ? colors.brand : colors.textSecondary,
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
    <span style={{ 
      width: '6px', height: '6px', borderRadius: '50%', 
      background: value ? colors.brand : colors.textMuted,
      boxShadow: value ? `0 0 8px ${colors.brandGlow}` : 'none',
    }} />
    <span>{label}</span>
    <span style={{ color: value ? colors.brand : colors.textTertiary, fontWeight: 600, fontSize: '10px' }}>
      {value ? 'ON' : 'OFF'}
    </span>
  </button>
);

