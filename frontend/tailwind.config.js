const v = (name) => `rgb(var(${name}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Per-tenant branding is injected as CSS variables at runtime (see lib/branding.ts)
        brand: { DEFAULT: v('--brand'), fg: v('--brand-fg') },
        accent: { DEFAULT: v('--accent'), fg: v('--accent-fg') },
        sun: { DEFAULT: '#f5b301', soft: '#fff7dd' },
        ink: { DEFAULT: '#0f2a43', muted: '#5b6b7c' },
        surface: { DEFAULT: '#ffffff', alt: '#f6f8fa', line: '#e3e8ee' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(15,42,67,0.06), 0 1px 3px rgba(15,42,67,0.04)' },
    },
  },
  plugins: [],
};
