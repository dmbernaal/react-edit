import React from 'react';
import { motion } from 'framer-motion';
import { colors } from '../../constants';

interface LivingBorderProps {
    mode: 'edit' | 'add';
}

export const LivingBorder = ({ mode }: LivingBorderProps) => {
    // Define gradients based on mode
    // Edit: Mint/Green (Primary #34D399)
    // Add: Cyan/Blue (Primary #06B6D4)

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
                animate={{ rotate: 360 }}
                transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "linear"
                }}
                style={{
                    width: '100%',
                    height: '100%',
                    background: gradient,
                    opacity: 0.8,
                    filter: 'blur(20px)', // Soften the gradient
                }}
            />
        </div>
    );
};
