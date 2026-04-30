/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mc: {
          canvas: 'var(--mc-canvas)',
          lifted: 'var(--mc-lifted)',
          white: 'var(--mc-white)',
          bone: 'var(--mc-bone)',
          ink: 'var(--mc-ink)',
          charcoal: 'var(--mc-charcoal)',
          slate: 'var(--mc-slate)',
          granite: 'var(--mc-granite)',
          graphite: 'var(--mc-graphite)',
          dust: 'var(--mc-dust)',
          signal: 'var(--mc-signal)',
          signalLight: 'var(--mc-signalLight)',
          clay: 'var(--mc-clay)',
          linkBlue: 'var(--mc-linkBlue)',
          red: 'var(--mc-red)',
          yellow: 'var(--mc-yellow)',
          ghost: 'var(--mc-ghost)',
        },
        dark: {
          base: 'var(--bg-base)',
          surface: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
          input: 'var(--bg-input)',
        },
        txt: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        accent: {
          orange: 'var(--accent-orange)',
          'orange-hover': 'var(--accent-orange-hover)',
          'orange-glow': 'var(--accent-orange-glow)',
          teal: 'var(--accent-secondary)',
          blue: 'var(--accent-blue)',
          green: 'var(--accent-green)',
          red: 'var(--accent-red)',
          yellow: 'var(--accent-yellow)',
        },
        bdr: {
          subtle: 'var(--border-subtle)',
          medium: 'var(--border-medium)',
          active: 'var(--border-active)',
        },
      },
      fontFamily: {
        mark: ['Sofia Sans', 'Inter', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        'pill': '999px',
        'btn': '12px',
        'card': '16px',
        'chip': '24px',
        'sm': '6px',
      },
      boxShadow: {
        'nav': 'color-mix(in srgb, var(--bg-base) 32%, transparent) 0px 4px 24px 0px',
        'card': 'color-mix(in srgb, var(--bg-base) 40%, transparent) 0px 24px 48px 0px',
        'elevated': 'color-mix(in srgb, var(--bg-base) 62%, transparent) 0px 70px 110px 0px',
        'glow': '0 0 20px var(--accent-primary-glow)',
        'glow-sm': '0 0 8px var(--accent-primary-glow)',
        'glow-md': '0 0 24px var(--accent-primary-glow)',
        'glass': '0 8px 32px color-mix(in srgb, var(--bg-base) 48%, transparent)',
      },
      letterSpacing: {
        'display': '-0.02em',
        'tight': '-0.03em',
        'eyebrow': '0.04em',
        'widest': '0.08em',
      },
      lineHeight: {
        'display': '1',
        'tight': '1.2',
        'body': '1.4',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      }
    },
  },
  plugins: [],
}
