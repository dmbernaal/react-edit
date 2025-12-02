import React, { useState } from 'react';
import { colors } from '../constants';
import type { StreamEvent } from '../types';

interface StreamStepProps {
  event: StreamEvent;
  isLast: boolean;
}

export const StreamStep = ({ event, isLast }: StreamStepProps) => {
  const [expanded, setExpanded] = useState(false);
  
  const getIcon = () => {
    switch (event.type) {
      case 'system': return '◆';
      case 'thinking': return '◇';
      case 'tool': return event.action === 'read' ? '◁' : '▷';
      case 'result': return event.success ? '✓' : '✗';
      case 'error': return '!';
      default: return '●';
    }
  };
  
  const getColor = () => {
    switch (event.type) {
      case 'system': return colors.brand;
      case 'thinking': return colors.textTertiary;
      case 'tool': return event.status === 'completed' ? colors.success : colors.warning;
      case 'result': return event.success ? colors.success : colors.error;
      case 'error': return colors.error;
      default: return colors.textMuted;
    }
  };
  
  const getText = () => {
    switch (event.type) {
      case 'system': return `Using ${event.model}`;
      case 'thinking': return event.text?.substring(0, 100) + (event.text && event.text.length > 100 ? '...' : '');
      case 'tool': 
        if (event.status === 'started') return `${event.action === 'read' ? 'Reading' : 'Writing'} ${event.path}`;
        return `${event.action === 'read' ? 'Read' : 'Wrote'} ${event.path} (${event.lines} lines)`;
      case 'result': return event.success ? 'Changes applied' : 'Failed';
      case 'error': return event.text || 'Error occurred';
      default: return '';
    }
  };

  const hasExpandableContent = event.type === 'thinking' && event.text && event.text.length > 100;

  return (
    <div style={{ 
      display: 'flex', 
      gap: '10px',
      paddingBottom: isLast ? 0 : '8px',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '16px' }}>
        <div style={{
          width: '16px',
          height: '16px',
          borderRadius: '4px',
          background: `${getColor()}15`,
          border: `1px solid ${getColor()}30`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '9px',
          color: getColor(),
          fontWeight: 600,
        }}>
          {getIcon()}
        </div>
        {!isLast && (
          <div style={{
            width: '1px',
            flex: 1,
            background: colors.borderSubtle,
            marginTop: '4px',
          }} />
        )}
      </div>
      
      <div style={{ flex: 1, minWidth: 0, paddingTop: '1px' }}>
        <div 
          onClick={() => hasExpandableContent && setExpanded(!expanded)}
          style={{ 
            fontSize: '11px', 
            color: event.type === 'thinking' ? colors.textTertiary : colors.textSecondary,
            fontFamily: event.type === 'tool' ? 'ui-monospace, monospace' : 'inherit',
            cursor: hasExpandableContent ? 'pointer' : 'default',
            lineHeight: 1.4,
          }}
        >
          {expanded ? event.text : getText()}
        </div>
      </div>
    </div>
  );
};

