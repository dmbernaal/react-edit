import React from 'react';
import { LivingBorder } from './LivingBorder';
import { TitaniumCore } from './TitaniumCore';
import { colors } from '../../constants';

interface TitaniumShellProps {
    children: React.ReactNode;
    mode: 'edit' | 'add';
    isActive?: boolean;
    style?: React.CSSProperties;
    onMouseDown?: (e: React.MouseEvent) => void;
}

export const TitaniumShell = ({ children, mode, isActive, style, onMouseDown }: TitaniumShellProps) => {
    return (
        <div
            onMouseDown={onMouseDown}
            style={{
                position: 'relative',
                borderRadius: '14px', // Outer shell radius
                padding: '2px', // The gap for the border
                background: 'rgba(255,255,255,0.05)', // Subtle container bg
                overflow: 'hidden',
                boxShadow: '0 50px 100px -20px rgba(0,0,0,0.7), 0 30px 60px -30px rgba(0,0,0,0.8)', // Strong floating shadow
                ...style
            }}
        >
            <LivingBorder mode={mode} isActive={isActive} />
            <TitaniumCore>
                {children}
            </TitaniumCore>
        </div>
    );
};
