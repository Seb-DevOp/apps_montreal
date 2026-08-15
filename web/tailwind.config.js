/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Palette « nuit montréalaise » : fond profond, accent bleu STM,
        // accent chaud pour les alertes météo et les échéances dépassées.
        ink: {
          900: '#070d18',
          800: '#0b1220',
          700: '#131c2e',
          600: '#1c2740',
          500: '#2a3552',
        },
        frost: '#e8eefc',
        stm: '#0a7cff',
        maple: '#e14b4b',
        mint: '#2fbf9b',
        amber: '#f0a23b',
      },
      fontFamily: {
        sans: ['"Inter var"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      spacing: {
        // Zones sûres iOS (encoche + barre home) : indispensable en standalone.
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease-out',
        'slide-up': 'slideUp 240ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
