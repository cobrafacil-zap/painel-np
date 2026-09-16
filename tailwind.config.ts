import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './modules/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { base: '#0a0a0b', soft: '#15151a', elevated: '#1f1f26' },
        accent: { 400: '#22c55e', 500: '#16a34a' },
        border: '#2a2a32',
      },
    },
  },
  plugins: [],
};

export default config;
