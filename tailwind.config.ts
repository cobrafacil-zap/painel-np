import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './modules/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#0a0a0b', soft: '#15151a', elevated: '#1f1f26' },
        accent: { 400: '#22c55e', 500: '#16a34a' },
        border: '#2a2a32',
        // Glass — superfícies com backdrop-blur. Usados em .glass / .glass-elevated
        glass: 'rgb(255 255 255 / 0.03)',
        elevated: 'rgb(255 255 255 / 0.05)',
        glassBorder: 'rgb(255 255 255 / 0.06)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulseSlow 3s ease-in-out infinite',
        'pulse-border': 'pulseBorder 2.4s ease-in-out infinite',
        'draw-ring': 'drawRing 1.2s ease-out forwards',
        'fade-up': 'fadeUp 400ms ease-out both',
        'fade-in-up': 'fadeInUp 320ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'shimmer': 'shimmer 1.6s linear infinite',
      },
      keyframes: {
        pulseSlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        pulseBorder: {
          '0%, 100%': { borderLeftColor: 'rgb(239 68 68 / 0.4)' },
          '50%': { borderLeftColor: 'rgb(239 68 68 / 0.85)' },
        },
        drawRing: {
          from: { strokeDashoffset: 'var(--ring-circumference)' },
          to: { strokeDashoffset: 'var(--ring-target)' },
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
