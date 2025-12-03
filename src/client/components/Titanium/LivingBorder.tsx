import React from 'react';
import { motion } from 'framer-motion';
import { colors } from '../../constants';

interface LivingBorderProps {
    mode: 'edit' | 'add';
    isActive?: boolean;
}

export const LivingBorder = ({ mode, isActive = false }: LivingBorderProps) => {
    // Define gradients based on mode
    const gradient = mode === 'add'
        ? `conic-gradient(from 0deg, transparent 0deg, ${colors.addMode} 90deg, ${colors.brand} 180deg, ${colors.addMode} 270deg, transparent 360deg)`
        : `conic-gradient(from 0deg, transparent 0deg, ${colors.editMode} 90deg, ${colors.brand} 180deg, ${colors.editMode} 270deg, transparent 360deg)`;

    return (
        <div style={{
            position: 'absolute',
            inset: '-50%', // Oversize to cover corners during rotation
            zIndex: 0,
            overflow: 'hidden',
        }}>
            <motion.div
                animate={{
                    rotate: isActive ? 360 : 0,
                    opacity: isActive ? 0.8 : 0.1, // Dim when idle
                }}
                transition={{
                    rotate: {
                        duration: isActive ? 3 : 0, // Spin only when active
                        repeat: Infinity,
                        ease: "linear"
                    },
                    opacity: { duration: 0.5 }
                }}
                style={{
                    width: '100%',
                    height: '100%',
                    background: isActive ? gradient : 'rgba(255,255,255,0.1)', // Simple border when idle
                    filter: 'blur(20px)',
                }}
            />
        </div>
    );
};
