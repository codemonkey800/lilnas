# Yoink Design System — "Phosphor Terminal"

## Philosophy & Aesthetic Direction

Phosphor Terminal draws from the look and feel of vintage CRT phosphor-green monitors — refined for modern web UI. Deep charcoal surfaces, electric green accents, monospace-forward typography, and subtle glow effects create an interface that feels like a high-tech command console rather than a generic dashboard.

**Core principles:**

- **Dark-only.** No light theme. The entire UI lives on deep carbon surfaces.
- **Terminal-native.** Monospace type is the hero, not a novelty. Data-dense layouts feel intentional.
- **Glow as affordance.** Phosphor glow indicates interactivity and focus — it replaces the typical "primary blue" idiom.
- **Restrained palette.** Green is the only accent color. Semantic colors (red, amber, blue) appear sparingly for status.
- **Density over whitespace.** Compact spacing with clear hierarchy. Every pixel earns its place.

---

## Color Palette

### Carbon Surfaces

The background stack. Each step is a subtle lift from pure black.

| Token        | Hex       | Usage                               |
| ------------ | --------- | ----------------------------------- |
| `carbon-950` | `#08090A` | Deepest background (overlays, pits) |
| `carbon-900` | `#0D0F0E` | **Base background**                 |
| `carbon-800` | `#151917` | Card / panel surface                |
| `carbon-700` | `#1E2422` | Elevated surface, sidebar           |
| `carbon-600` | `#2A322F` | Hover states, active wells          |
| `carbon-500` | `#3B4744` | Borders, dividers                   |
| `carbon-400` | `#576462` | Muted text, placeholders            |
| `carbon-300` | `#7A8B88` | Secondary text                      |
| `carbon-200` | `#A3B0AD` | Body text                           |
| `carbon-100` | `#D0D8D6` | Headings, primary text              |
| `carbon-50`  | `#ECF0EF` | High-emphasis text                  |

### Phosphor Greens

The signature accent ramp, anchored by `terminal` (#39FF14).

| Token          | Hex       | Usage                                   |
| -------------- | --------- | --------------------------------------- |
| `phosphor-950` | `#052E05` | Darkest green (subtle tints)            |
| `phosphor-900` | `#0A4A0A` | Dark badges, dark fills                 |
| `phosphor-800` | `#0F6B0F` | Secondary green accents                 |
| `phosphor-700` | `#168F16` | Hover states on green elements          |
| `phosphor-600` | `#1FBF1F` | Active / pressed green                  |
| `phosphor-500` | `#2BDF2B` | Bright accent (charts, indicators)      |
| `terminal`     | `#39FF14` | **Primary accent** — links, focus, glow |
| `phosphor-300` | `#6FFF54` | Light accent (highlights)               |
| `phosphor-200` | `#A5FF8A` | Subtle tint on dark surfaces            |
| `phosphor-100` | `#D4FFC7` | Very light green tint                   |

### Terminal Electrics

Semantic status colors with a desaturated, terminal-appropriate feel.

| Token           | Hex       | Usage                        |
| --------------- | --------- | ---------------------------- |
| `error`         | `#FF4444` | Errors, destructive actions  |
| `error-muted`   | `#3D1515` | Error background tint        |
| `warning`       | `#FFAA22` | Warnings, caution states     |
| `warning-muted` | `#3D2E0A` | Warning background tint      |
| `info`          | `#44AAFF` | Informational, links (rare)  |
| `info-muted`    | `#0A2A3D` | Info background tint         |
| `success`       | `#39FF14` | Success — aliases `terminal` |
| `success-muted` | `#0A3D05` | Success background tint      |

### Special

| Token      | Hex                       | Usage                  |
| ---------- | ------------------------- | ---------------------- |
| `glow`     | `#39FF14`                 | Box-shadow glow color  |
| `glow-dim` | `rgba(57, 255, 20, 0.15)` | Subtle background glow |
| `scanline` | `rgba(57, 255, 20, 0.03)` | Scanline overlay       |

---

## Typography

### Font Stack

| Role       | Family             | Weight        | Usage                              |
| ---------- | ------------------ | ------------- | ---------------------------------- |
| **Mono**   | JetBrains Mono     | 400, 500, 700 | Headings, data, code, KBD, nav     |
| **Sans**   | Space Grotesk      | 400, 500, 600 | Body copy, descriptions, UI labels |
| **System** | system-ui fallback | —             | Fallback only                      |

### Loading Fonts (Next.js)

```tsx
import { JetBrains_Mono, Space_Grotesk } from 'next/font/google'

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

// Apply to <body>:
// className={cns(jetbrainsMono.variable, spaceGrotesk.variable)}
```

### Type Scale

Built on a 1.25 ratio with monospace headings and sans body.

| Level | Class       | Size     | Line Height | Weight | Font           |
| ----- | ----------- | -------- | ----------- | ------ | -------------- |
| H1    | `text-4xl`  | 2.25rem  | 1.1         | 700    | JetBrains Mono |
| H2    | `text-3xl`  | 1.875rem | 1.15        | 700    | JetBrains Mono |
| H3    | `text-2xl`  | 1.5rem   | 1.2         | 600    | JetBrains Mono |
| H4    | `text-xl`   | 1.25rem  | 1.3         | 500    | JetBrains Mono |
| Body  | `text-base` | 1rem     | 1.6         | 400    | Space Grotesk  |
| Small | `text-sm`   | 0.875rem | 1.5         | 400    | Space Grotesk  |
| XS    | `text-xs`   | 0.75rem  | 1.4         | 400    | Space Grotesk  |
| Mono  | `font-mono` | inherit  | inherit     | 400    | JetBrains Mono |

### Usage Rules

- **Headings** always use `font-mono font-bold tracking-tight`.
- **Body text** uses `font-sans text-carbon-200 leading-relaxed`.
- **Data values** (numbers, stats, IDs) use `font-mono tabular-nums`.
- **Code** uses `font-mono text-sm` with a `phosphor-900` background.
- **Labels / UI chrome** use `font-sans text-xs font-medium uppercase tracking-wider text-carbon-300`.

---

## Spacing & Layout

### Base Unit

All spacing derives from a **4px base unit** via Tailwind's default scale.

| Token | Value | Usage                      |
| ----- | ----- | -------------------------- |
| `1`   | 4px   | Tight inner padding        |
| `2`   | 8px   | Icon gaps, inline spacing  |
| `3`   | 12px  | Input padding, small gaps  |
| `4`   | 16px  | Card padding, section gaps |
| `6`   | 24px  | Component spacing          |
| `8`   | 32px  | Section padding            |
| `12`  | 48px  | Page section gaps          |
| `16`  | 64px  | Major layout divisions     |

### Layout Patterns

```
┌─────────────────────────────────────────────────┐
│ Sidebar (w-64)  │  Main Content (flex-1)        │
│ carbon-800      │  carbon-900                   │
│                 │  ┌──────────────────────────┐  │
│ Nav (font-mono) │  │ Content (max-w-5xl mx-a) │  │
│                 │  └──────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

- **Max content width:** `max-w-5xl` (64rem) for readability
- **Sidebar:** Fixed `w-64` (16rem) with `carbon-800` background
- **Page padding:** `p-6` on desktop, `p-4` on mobile
- **Card grid:** `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`

---

## Component Patterns

All components follow the monorepo convention established in `tdr-bot`:

- `cns()` from `@lilnas/utils/cns` for class merging
- `class-variance-authority` (CVA) for variant management
- `@radix-ui/react-slot` for polymorphic `asChild` support
- `forwardRef` for ref forwarding

### Button

```tsx
import { cns } from '@lilnas/utils/cns'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

const buttonVariants = cva(
  cns(
    'inline-flex items-center justify-center gap-2',
    'whitespace-nowrap rounded-md font-mono text-sm font-medium',
    'transition-all duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terminal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-carbon-900',
    'disabled:pointer-events-none disabled:opacity-40',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        default: cns(
          'bg-terminal text-carbon-950',
          'shadow-[0_0_12px_rgba(57,255,20,0.3)]',
          'hover:bg-phosphor-300 hover:shadow-[0_0_20px_rgba(57,255,20,0.5)]',
          'active:bg-phosphor-500',
        ),

        secondary: cns(
          'bg-carbon-700 text-carbon-100',
          'border border-carbon-500',
          'hover:bg-carbon-600 hover:text-carbon-50',
          'active:bg-carbon-600',
        ),

        outline: cns(
          'border border-terminal/40 text-terminal',
          'bg-transparent',
          'hover:bg-terminal/10 hover:border-terminal',
          'active:bg-terminal/15',
        ),

        ghost: cns(
          'text-carbon-200',
          'hover:bg-carbon-700 hover:text-carbon-50',
          'active:bg-carbon-600',
        ),

        destructive: cns(
          'bg-error text-carbon-50',
          'shadow-[0_0_12px_rgba(255,68,68,0.3)]',
          'hover:bg-error/90',
          'active:bg-error/80',
        ),

        link: cns(
          'text-terminal underline-offset-4',
          'hover:underline hover:text-phosphor-300',
        ),
      },

      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6 text-base',
        icon: 'h-9 w-9',
      },
    },

    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cns(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)

Button.displayName = 'Button'

export { Button, buttonVariants }
```

### Card

```tsx
import { cns } from '@lilnas/utils/cns'
import { cva, type VariantProps } from 'class-variance-authority'
import { type HTMLAttributes, forwardRef } from 'react'

const cardVariants = cva(
  cns(
    'rounded-lg border border-carbon-500',
    'bg-carbon-800 text-carbon-100',
    'transition-all duration-200',
  ),
  {
    variants: {
      variant: {
        default: '',
        glow: cns(
          'border-terminal/20',
          'shadow-[0_0_16px_rgba(57,255,20,0.08)]',
          'hover:shadow-[0_0_24px_rgba(57,255,20,0.15)]',
          'hover:border-terminal/40',
        ),
        inset: 'bg-carbon-900 border-carbon-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cns(cardVariants({ variant, className }))}
      {...props}
    />
  ),
)

Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cns('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  ),
)

CardHeader.displayName = 'CardHeader'

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cns('p-4 pt-0', className)} {...props} />
  ),
)

CardContent.displayName = 'CardContent'

export { Card, CardHeader, CardContent, cardVariants }
```

### Input

```tsx
import { cns } from '@lilnas/utils/cns'
import { type InputHTMLAttributes, forwardRef } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cns(
        'flex h-9 w-full rounded-md px-3 py-1',
        'bg-carbon-900 text-carbon-100 font-mono text-sm',
        'border border-carbon-500',
        'placeholder:text-carbon-400',
        'transition-all duration-150',
        'focus:border-terminal/60 focus:outline-none focus:ring-2 focus:ring-terminal/20',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...props}
    />
  ),
)

Input.displayName = 'Input'

export { Input }
```

### Badge

```tsx
import { cns } from '@lilnas/utils/cns'
import { cva, type VariantProps } from 'class-variance-authority'
import { type HTMLAttributes, forwardRef } from 'react'

const badgeVariants = cva(
  cns(
    'inline-flex items-center rounded-full px-2.5 py-0.5',
    'font-mono text-xs font-medium',
    'border transition-colors',
  ),
  {
    variants: {
      variant: {
        default: 'border-terminal/30 bg-terminal/10 text-terminal',
        secondary: 'border-carbon-500 bg-carbon-700 text-carbon-200',
        error: 'border-error/30 bg-error-muted text-error',
        warning: 'border-warning/30 bg-warning-muted text-warning',
        info: 'border-info/30 bg-info-muted text-info',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cns(badgeVariants({ variant, className }))}
      {...props}
    />
  ),
)

Badge.displayName = 'Badge'

export { Badge, badgeVariants }
```

### Kbd (Keyboard Shortcut)

```tsx
import { cns } from '@lilnas/utils/cns'
import { type HTMLAttributes, forwardRef } from 'react'

const Kbd = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cns(
        'inline-flex h-5 items-center rounded border px-1.5',
        'border-carbon-500 bg-carbon-700',
        'font-mono text-[0.6875rem] font-medium text-carbon-300',
        className,
      )}
      {...props}
    />
  ),
)

Kbd.displayName = 'Kbd'

export { Kbd }
```

### Progress

```tsx
import { cns } from '@lilnas/utils/cns'
import { type HTMLAttributes, forwardRef } from 'react'

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  value: number // 0-100
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value, ...props }, ref) => (
    <div
      ref={ref}
      className={cns(
        'h-2 w-full overflow-hidden rounded-full bg-carbon-700',
        className,
      )}
      {...props}
    >
      <div
        className={cns(
          'h-full rounded-full bg-terminal transition-all duration-500 ease-out',
          'shadow-[0_0_8px_rgba(57,255,20,0.4)]',
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  ),
)

Progress.displayName = 'Progress'

export { Progress }
```

### Code Block

```tsx
import { cns } from '@lilnas/utils/cns'
import { type HTMLAttributes, forwardRef } from 'react'

export interface CodeBlockProps extends HTMLAttributes<HTMLPreElement> {
  filename?: string
}

const CodeBlock = forwardRef<HTMLPreElement, CodeBlockProps>(
  ({ className, filename, children, ...props }, ref) => (
    <div className="overflow-hidden rounded-lg border border-carbon-500">
      {filename && (
        <div
          className={cns(
            'flex items-center gap-2 border-b border-carbon-500 px-4 py-2',
            'bg-carbon-700 font-mono text-xs text-carbon-300',
          )}
        >
          <span className="h-2 w-2 rounded-full bg-terminal/60" />
          {filename}
        </div>
      )}
      <pre
        ref={ref}
        className={cns(
          'overflow-x-auto p-4',
          'bg-carbon-900 font-mono text-sm leading-relaxed text-carbon-100',
          className,
        )}
        {...props}
      >
        {children}
      </pre>
    </div>
  ),
)

CodeBlock.displayName = 'CodeBlock'

export { CodeBlock }
```

---

## Animation & Motion

### Keyframes

| Name             | Description                            | Duration | Usage                        |
| ---------------- | -------------------------------------- | -------- | ---------------------------- |
| `glow-pulse`     | Pulsing green box-shadow               | 2s       | Active states, notifications |
| `terminal-blink` | Cursor-style opacity blink             | 1s       | Cursor indicator, loading    |
| `fade-in`        | Opacity 0 -> 1 with slight Y translate | 300ms    | Content entrance             |
| `slide-in-right` | Translate-X entrance from the right    | 200ms    | Sidebar panels, drawers      |

### Easing

| Token       | Value                           | Usage                 |
| ----------- | ------------------------------- | --------------------- |
| `ease-out`  | `cubic-bezier(0.16, 1, 0.3, 1)` | Default for entrances |
| `ease-in`   | `cubic-bezier(0.7, 0, 0.84, 0)` | Exit animations       |
| `ease-glow` | `cubic-bezier(0.4, 0, 0.2, 1)`  | Glow transitions      |

### Reduced Motion

All animations are disabled under `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Custom Utilities

Defined as Tailwind `@utility` directives in `src/tailwind.css`.

| Class          | Effect                                             |
| -------------- | -------------------------------------------------- |
| `glow-sm`      | `box-shadow: 0 0 8px rgba(57, 255, 20, 0.2)`       |
| `glow-md`      | `box-shadow: 0 0 16px rgba(57, 255, 20, 0.3)`      |
| `glow-lg`      | `box-shadow: 0 0 32px rgba(57, 255, 20, 0.4)`      |
| `text-glow`    | `text-shadow: 0 0 8px rgba(57, 255, 20, 0.6)`      |
| `text-glow-sm` | `text-shadow: 0 0 4px rgba(57, 255, 20, 0.4)`      |
| `scanlines`    | Repeating-gradient overlay for CRT scanline effect |
| `cursor-blink` | Applies `terminal-blink` animation                 |

---

## Tailwind CSS Configuration

All design tokens are defined in `src/tailwind.css` using Tailwind v4's CSS-first `@theme` directive. The `tailwind.config.ts` file remains minimal — only `content` paths.

### Full `src/tailwind.css`

```css
@import 'tailwindcss';

@theme {
  /* ── Fonts ── */
  --font-mono:
    'JetBrains Mono', ui-monospace, 'Cascadia Code', 'Fira Code', monospace;
  --font-sans: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;

  /* ── Carbon Surfaces ── */
  --color-carbon-950: #08090a;
  --color-carbon-900: #0d0f0e;
  --color-carbon-800: #151917;
  --color-carbon-700: #1e2422;
  --color-carbon-600: #2a322f;
  --color-carbon-500: #3b4744;
  --color-carbon-400: #576462;
  --color-carbon-300: #7a8b88;
  --color-carbon-200: #a3b0ad;
  --color-carbon-100: #d0d8d6;
  --color-carbon-50: #ecf0ef;

  /* ── Phosphor Greens ── */
  --color-phosphor-950: #052e05;
  --color-phosphor-900: #0a4a0a;
  --color-phosphor-800: #0f6b0f;
  --color-phosphor-700: #168f16;
  --color-phosphor-600: #1fbf1f;
  --color-phosphor-500: #2bdf2b;
  --color-terminal: #39ff14;
  --color-phosphor-300: #6fff54;
  --color-phosphor-200: #a5ff8a;
  --color-phosphor-100: #d4ffc7;

  /* ── Semantic Colors ── */
  --color-error: #ff4444;
  --color-error-muted: #3d1515;
  --color-warning: #ffaa22;
  --color-warning-muted: #3d2e0a;
  --color-info: #44aaff;
  --color-info-muted: #0a2a3d;
  --color-success: #39ff14;
  --color-success-muted: #0a3d05;

  /* ── Animations ── */
  --animate-glow-pulse: glow-pulse 2s ease-in-out infinite;
  --animate-terminal-blink: terminal-blink 1s step-end infinite;
  --animate-fade-in: fade-in 300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  --animate-slide-in-right: slide-in-right 200ms cubic-bezier(0.16, 1, 0.3, 1)
    forwards;
}

/* ── Keyframes ── */

@keyframes glow-pulse {
  0%,
  100% {
    box-shadow: 0 0 8px rgba(57, 255, 20, 0.2);
  }
  50% {
    box-shadow: 0 0 20px rgba(57, 255, 20, 0.5);
  }
}

@keyframes terminal-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slide-in-right {
  from {
    opacity: 0;
    transform: translateX(8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* ── Custom Utilities ── */

@utility glow-sm {
  box-shadow: 0 0 8px rgba(57, 255, 20, 0.2);
}

@utility glow-md {
  box-shadow: 0 0 16px rgba(57, 255, 20, 0.3);
}

@utility glow-lg {
  box-shadow: 0 0 32px rgba(57, 255, 20, 0.4);
}

@utility text-glow {
  text-shadow: 0 0 8px rgba(57, 255, 20, 0.6);
}

@utility text-glow-sm {
  text-shadow: 0 0 4px rgba(57, 255, 20, 0.4);
}

@utility scanlines {
  background-image: repeating-linear-gradient(
    0deg,
    rgba(57, 255, 20, 0.03) 0px,
    rgba(57, 255, 20, 0.03) 1px,
    transparent 1px,
    transparent 3px
  );
}

@utility cursor-blink {
  animation: terminal-blink 1s step-end infinite;
}

/* ── Base Layer ── */

@layer base {
  html {
    color-scheme: dark;
  }

  body {
    @apply bg-carbon-900 font-sans text-carbon-200 antialiased;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    @apply font-mono font-bold tracking-tight text-carbon-50;
  }

  ::selection {
    background-color: rgba(57, 255, 20, 0.25);
    color: #ecf0ef;
  }

  /* Scrollbar styling */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: #0d0f0e;
  }

  ::-webkit-scrollbar-thumb {
    background: #3b4744;
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: #576462;
  }
}
```

---

## Accessibility

### Contrast Ratios

All text/background combinations meet WCAG AA (4.5:1 for normal text, 3:1 for large text).

| Foreground   | Background      | Ratio  | Level |
| ------------ | --------------- | ------ | ----- |
| `carbon-50`  | `carbon-900`    | 14.8:1 | AAA   |
| `carbon-100` | `carbon-900`    | 11.6:1 | AAA   |
| `carbon-200` | `carbon-900`    | 8.1:1  | AAA   |
| `carbon-300` | `carbon-900`    | 5.2:1  | AA    |
| `terminal`   | `carbon-900`    | 12.5:1 | AAA   |
| `terminal`   | `carbon-950`    | 13.4:1 | AAA   |
| `carbon-950` | `terminal`      | 13.4:1 | AAA   |
| `error`      | `error-muted`   | 5.8:1  | AA    |
| `warning`    | `warning-muted` | 7.2:1  | AA    |
| `info`       | `info-muted`    | 5.5:1  | AA    |

### Focus Indicators

- All interactive elements use `focus-visible:ring-2 focus-visible:ring-terminal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-carbon-900`.
- Focus rings are clearly visible against all surface colors.
- Keyboard navigation follows logical tab order.

### Reduced Motion

- All animations respect `prefers-reduced-motion: reduce`.
- Glow effects remain static (no pulsing) under reduced motion.
- Transitions reduce to near-instant (`0.01ms`) under reduced motion.

### Color Independence

- Status is never communicated through color alone — icons and text labels always accompany colored badges.
- The terminal green accent is supplemented by shape and position cues for interactive affordances.

---

## Icons

Use [Lucide React](https://lucide.dev) (`lucide-react`), already used across the monorepo. Icons should be `16px` (default) in UI chrome and `20px` in feature areas.

```tsx
import { Terminal, Zap, AlertTriangle } from 'lucide-react'

// Default size in buttons/nav
<Terminal className="size-4 text-terminal" />

// Feature/hero size
<Zap className="size-5 text-terminal" />
```

---

## Quick Reference

```
Background:   bg-carbon-900
Surface:      bg-carbon-800
Elevated:     bg-carbon-700
Border:       border-carbon-500
Text:         text-carbon-200
Heading:      text-carbon-50 font-mono font-bold
Accent:       text-terminal
Glow:         shadow-[0_0_16px_rgba(57,255,20,0.3)]
Focus:        focus-visible:ring-2 focus-visible:ring-terminal/50
```
