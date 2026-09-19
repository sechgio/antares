// Un color declarado como `var(--x)` en texto plano no admite el modificador de
// alfa de Tailwind: `bg-mc-ink/50` no genera ninguna regla y la utilidad queda
// muerta en silencio. Devolver una función con `color-mix` es el camino que
// soporta `withAlphaValue` y además respeta el valor del token en el tema claro
// y en el oscuro.
//
// Sin modificador, Tailwind pasa `var(--tw-*-opacity, 1)` como `opacityValue`:
// no es un número, así que se devuelve el token intacto para no cambiar el
// comportamiento de las ~2800 clases de color que ya funcionan.
const alpha =
  (cssVar) =>
  ({ opacityValue }) => {
    const amount = Number(opacityValue);
    if (!Number.isFinite(amount)) return `var(${cssVar})`;
    return `color-mix(in srgb, var(${cssVar}) ${Number((amount * 100).toFixed(2))}%, transparent)`;
  };

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        mc: {
          canvas: alpha('--mc-canvas'),
          lifted: alpha('--mc-lifted'),
          white: alpha('--mc-white'),
          bone: alpha('--mc-bone'),
          ink: alpha('--mc-ink'),
          charcoal: alpha('--mc-charcoal'),
          slate: alpha('--mc-slate'),
          granite: alpha('--mc-granite'),
          graphite: alpha('--mc-graphite'),
          dust: alpha('--mc-dust'),
          signal: alpha('--mc-signal'),
          signalLight: alpha('--mc-signalLight'),
          clay: alpha('--mc-clay'),
          linkBlue: alpha('--mc-linkBlue'),
          red: alpha('--mc-red'),
          yellow: alpha('--mc-yellow'),
          ghost: alpha('--mc-ghost'),
        },
        dark: {
          base: alpha('--bg-base'),
          surface: alpha('--bg-surface'),
          elevated: alpha('--bg-elevated'),
          input: alpha('--bg-input'),
        },
        txt: {
          primary: alpha('--text-primary'),
          secondary: alpha('--text-secondary'),
          muted: alpha('--text-muted'),
        },
        accent: {
          orange: alpha('--accent-orange'),
          'orange-hover': alpha('--accent-orange-hover'),
          'orange-glow': alpha('--accent-orange-glow'),
          teal: alpha('--accent-secondary'),
          blue: alpha('--accent-blue'),
          green: alpha('--accent-green'),
          red: alpha('--accent-red'),
          yellow: alpha('--accent-yellow'),
        },
        bdr: {
          subtle: alpha('--border-subtle'),
          medium: alpha('--border-medium'),
          active: alpha('--border-active'),
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
        'out': 'cubic-bezier(0.23, 1, 0.32, 1)',
        'inout': 'cubic-bezier(0.77, 0, 0.175, 1)',
        'drawer': 'cubic-bezier(0.32, 0.72, 0, 1)',
      }
    },
  },
  plugins: [],
}
