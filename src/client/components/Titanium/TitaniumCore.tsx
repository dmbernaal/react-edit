import React from 'react';
import { colors } from '../../constants';

interface TitaniumCoreProps {
    children: React.ReactNode;
    className?: string;
}

export const TitaniumCore = ({ children, className }: TitaniumCoreProps) => {
    return (
        <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            background: '#1C1C1C', // Deep matte charcoal
            borderRadius: '12px', // Slightly smaller than shell
            zIndex: 1, // Sit above the border
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden', // Clip content
            boxShadow: '0 25px 60px rgba(0,0,0,0.5)', // Deep shadow
        }}>
            {children}
        </div>
    );
};
