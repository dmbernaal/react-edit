import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { colors } from '../../constants';

interface TitaniumButtonProps {
    onClick: () => void;
    disabled?: boolean;
    isLoading?: boolean;
    mode: 'edit' | 'add';
    children: React.ReactNode;
}

export const TitaniumButton = ({ onClick, disabled, isLoading, mode, children }: TitaniumButtonProps) => {
    const [isHovered, setIsHovered] = useState(false);

    // Deep Plasma Color Palettes
    // Edit: Deep Forest Base -> Emerald -> Mint
    const EDIT_THEME = {
        base: "#064E3B", // Deep Forest
        blob1: "#10B981", // Emerald
        blob2: "#34D399", // Mint
        shadow: "rgba(16, 185, 129, 0.25)"
    };

    // Add: Deep Ocean Base -> Cyan -> Light Cyan
    const ADD_THEME = {
        base: "#164E63", // Deep Ocean
        blob1: "#06B6D4", // Cyan
        blob2: "#67E8F9", // Light Cyan
        shadow: "rgba(6, 182, 212, 0.25)"
    };

    const theme = mode === 'add' ? ADD_THEME : EDIT_THEME;

    return (
        <motion.button
            onClick={onClick}
            disabled={disabled || isLoading}
            onHoverStart={() => setIsHovered(true)}
            onHoverEnd={() => setIsHovered(false)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            style={{
                position: 'relative',
                height: '28px', // Reduced to match other controls
                padding: '0 12px', // Slightly reduced padding
                borderRadius: '999px', // Pill shape
                overflow: 'hidden',
                // border: '1px solid rgba(255,255,255,0.08)', // Removed border
                cursor: disabled || isLoading ? 'not-allowed' : 'pointer',
                // Subtle, premium colored shadow
                boxShadow: disabled ? 'none' : `0 4px 12px -2px ${theme.shadow}, 0 2px 6px -1px ${theme.shadow}`,
                opacity: disabled ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                background: theme.base, // Fallback / Base
            }}
        >
            {/* Layer 1: Deep Plasma Core */}
            {!disabled && (
                <>
                    {/* Blob 1: Primary Energy */}
                    <motion.div
                        animate={{
                            x: ["-20%", "20%", "-20%"],
                            y: ["-20%", "20%", "-20%"],
                            scale: [1, 1.2, 1],
                        }}
                        transition={{
                            duration: 8,
                            repeat: Infinity,
                            ease: "easeInOut"
                        }}
                        style={{
                            position: 'absolute',
                            top: '-50%',
                            left: '-50%',
                            width: '200%',
                            height: '200%',
                            background: `radial-gradient(circle, ${theme.blob1} 0%, transparent 60%)`,
                            filter: 'blur(20px)',
                            opacity: 0.8,
                        }}
                    />

                    {/* Blob 2: Highlight Energy (Counter-motion) */}
                    <motion.div
                        animate={{
                            x: ["20%", "-20%", "20%"],
                            y: ["20%", "-20%", "20%"],
                            scale: [1.2, 1, 1.2],
                        }}
                        transition={{
                            duration: 10,
                            repeat: Infinity,
                            ease: "easeInOut"
                        }}
                        style={{
                            position: 'absolute',
                            top: '-50%',
                            left: '-50%',
                            width: '200%',
                            height: '200%',
                            background: `radial-gradient(circle, ${theme.blob2} 0%, transparent 50%)`,
                            filter: 'blur(25px)',
                            opacity: 0.6,
                        }}
                    />
                </>
            )}

            {/* Layer 2: Glass Surface & Lip */}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    // Softened Glass Lip: Milled glass feel, not plastic
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), inset 0 0 10px rgba(0,0,0,0.1)',
                    background: isHovered
                        ? 'linear-gradient(to bottom, rgba(255,255,255,0.1), transparent)'
                        : 'linear-gradient(to bottom, rgba(255,255,255,0.05), transparent)',
                    transition: 'background 0.3s ease',
                }}
            />

            {/* Layer 3: Content */}
            <div style={{
                position: 'relative',
                zIndex: 10,
                color: '#FFF',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                // Sharpened Text Contrast: Lifted further off the plasma
                textShadow: '0 1px 3px rgba(0,0,0,0.3)',
                letterSpacing: '0.3px',
            }}>
                {isLoading ? (
                    <>
                        <div style={{
                            width: '14px', height: '14px', borderRadius: '50%',
                            border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#FFF',
                            animation: 'spin 1s linear infinite',
                        }} />
                        <span>Processing...</span>
                    </>
                ) : (
                    children
                )}
            </div>

            {/* Global Style for Spin Animation */}
            <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
        </motion.button>
    );
};
