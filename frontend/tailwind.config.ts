import type { Config } from 'tailwindcss'
import tailwindcssAnimate from 'tailwindcss-animate'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './store/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'float-up': {
          '0%': { transform: 'translate3d(-50%, 0, 0) scale(0.75)', opacity: '0' },
          '10%': { transform: 'translate3d(calc(-50% + 10px), -10vh, 0) scale(1.12)', opacity: '1' },
          '38%': { transform: 'translate3d(calc(-50% - 16px), -36vh, 0) scale(1.06)', opacity: '1' },
          '68%': { transform: 'translate3d(calc(-50% + 14px), -66vh, 0) scale(1.0)', opacity: '0.92' },
          '100%': { transform: 'translate3d(calc(-50% - 8px), -92vh, 0) scale(0.9)', opacity: '0' },
        },
        // Используем отдельные CSS-свойства scale/translate вместо transform,
        // чтобы не перебивать inline style.transform от @dnd-kit/sortable.
        'card-enter': {
          '0%': { opacity: '0', scale: '0.95', translate: '0 10px' },
          '100%': { opacity: '1', scale: '1', translate: '0 0' },
        },
        'card-glow': {
          '0%': { boxShadow: '0 0 0 2px hsl(var(--primary) / 0.45), 0 8px 24px -6px hsl(var(--primary) / 0.25)' },
          '100%': { boxShadow: '0 0 0 0px hsl(var(--primary) / 0), 0 1px 2px 0 rgb(0 0 0 / 0.05)' },
        },
        'card-reveal': {
          '0%': { opacity: '0.35', scale: '0.97', filter: 'blur(4px)' },
          '100%': { opacity: '1', scale: '1', filter: 'blur(0px)' },
        },
        'vote-pop': {
          '0%': { opacity: '1', transform: 'translate(-50%, 0) scale(0.85)' },
          '40%': { opacity: '1', transform: 'translate(-50%, -12px) scale(1.12)' },
          '100%': { opacity: '0', transform: 'translate(-50%, -22px) scale(0.95)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'float-up': 'float-up 3.4s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'card-enter': 'card-enter 0.32s cubic-bezier(0.22, 1, 0.36, 1) both',
        'card-glow': 'card-glow 1.3s ease-out forwards',
        'card-reveal': 'card-reveal 0.38s cubic-bezier(0.22, 1, 0.36, 1) both',
        'vote-pop': 'vote-pop 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}

export default config
