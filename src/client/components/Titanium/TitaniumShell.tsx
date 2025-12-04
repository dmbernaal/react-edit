import React from 'react';
import { LivingBorder } from './LivingBorder';
import { colors } from '../../constants';

interface TitaniumShellProps {
    children: React.ReactNode;
    header?: React.ReactNode;
    footer?: React.ReactNode;
    mode: 'edit' | 'add';
    isActive?: boolean;
    style?: React.CSSProperties;
    onMouseDown?: (e: React.MouseEvent) => void;
}

export const TitaniumShell = ({ children, header, footer, mode, isActive, style, onMouseDown }: TitaniumShellProps) => {
    return (
        // PARENT CONTAINER - handles drag, will have padding later
        <div
            style={{
                position: 'relative',
                borderRadius: '16px',
                padding: '1px', // The gap for the LivingBorder
                background: '#0A0A0A', // Deep, solid base
                boxShadow: '0 12px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)',
                ...style
            }}
        >
            {/* 1. The Living Energy Border */}
            <LivingBorder mode={mode} isActive={isActive} />

            {/* 2. The Inner Content Wrapper */}
            <div style={{
                position: 'relative',
                zIndex: 10,
                background: '#121212',
                borderRadius: '15px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
            }}>

                {/* 3. TOP CONTAINER - Mode indicator, close button - DRAGGABLE */}
                {header && (
                    <div 
                        onMouseDown={onMouseDown}
                        style={{
                            padding: '12px 16px 4px 16px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'grab',
                            // Same color as parent for visual unity (structure ready for future styling)
                        }}
                    >
                        {header}
                    </div>
                )}

                {/* 4. CHAT CONTAINER - The main input area */}
                <div style={{
                    position: 'relative',
                    padding: '0',
                    width: '100%',
                }}>
                    {children}
                </div>

                {/* 5. FOOTER CONTAINER - Buttons - NOT DRAGGABLE */}
                {footer && (
                    <div 
                        onMouseDown={(e) => e.stopPropagation()} // Prevent drag from footer
                        style={{
                            padding: '4px 12px 12px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'default', // Explicitly override any inherited grab cursor
                            position: 'relative', // Establish stacking context
                            zIndex: 1, // Ensure footer is above any overlapping elements
                        }}
                    >
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};
