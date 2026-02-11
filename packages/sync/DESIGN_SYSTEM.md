# Sync Design System

A minimal, delightful dark-purple design system built on Tailwind CSS v4.

All tokens are defined in `src/tailwind.css` via Tailwind's `@theme` directive. This means every token listed below automatically generates utility classes — no extra configuration needed.

---

## Table of Contents

- [Colors](#colors)
- [Typography](#typography)
- [Spacing & Layout](#spacing--layout)
- [Radii](#radii)
- [Shadows](#shadows)
- [Animations](#animations)
- [Responsive Design](#responsive-design)
- [Component Patterns](#component-patterns)
- [Accessibility](#accessibility)

---

## Colors

### Backgrounds

Use these for page backgrounds and layered surfaces. Each step is slightly lighter, creating depth through elevation.

| Token                | Utility         | Hex       | Usage                       |
| -------------------- | --------------- | --------- | --------------------------- |
| `--color-bg`         | `bg-bg`         | `#0a0a12` | Page background             |
| `--color-bg-raised`  | `bg-bg-raised`  | `#11111e` | Slightly elevated surfaces  |
| `--color-bg-surface` | `bg-bg-surface` | `#1a1a2e` | Cards, panels, inputs       |
| `--color-bg-overlay` | `bg-bg-overlay` | `#22223a` | Dropdowns, modals, tooltips |

### Primary (Purple)

The core brand color with a full scale for flexible usage.

| Token                 | Utility            | Hex       | Usage                     |
| --------------------- | ------------------ | --------- | ------------------------- |
| `--color-primary-50`  | `bg-primary-50`    | `#f3f0ff` | Lightest tint             |
| `--color-primary-100` | `bg-primary-100`   | `#e5deff` | Very light tint           |
| `--color-primary-200` | `bg-primary-200`   | `#cdbdff` | Light backgrounds         |
| `--color-primary-300` | `text-primary-300` | `#b197fc` | Highlighted text, accents |
| `--color-primary-400` | `text-primary-400` | `#9775fa` | Links, icons              |
| `--color-primary-500` | `bg-primary-500`   | `#845ef7` | Default primary           |
| `--color-primary-600` | `bg-primary-600`   | `#7048e8` | Hover state               |
| `--color-primary-700` | `bg-primary-700`   | `#5f3dc4` | Active/pressed state      |
| `--color-primary-800` | `bg-primary-800`   | `#4c309e` | Dark accent               |
| `--color-primary-900` | `bg-primary-900`   | `#3b2478` | Darkest accent            |
| `--color-primary`     | `bg-primary`       | `#845ef7` | Shorthand (same as 500)   |

### Text

| Token                    | Utility               | Hex       | Usage                   |
| ------------------------ | --------------------- | --------- | ----------------------- |
| `--color-text`           | `text-text`           | `#f0eef6` | Primary text, headings  |
| `--color-text-secondary` | `text-text-secondary` | `#a8a3b8` | Body text, descriptions |
| `--color-text-muted`     | `text-text-muted`     | `#6e6880` | Captions, placeholders  |
| `--color-text-inverse`   | `text-text-inverse`   | `#0a0a12` | Text on primary buttons |

### Borders & Rings

| Token                   | Utility                | Hex         | Usage               |
| ----------------------- | ---------------------- | ----------- | ------------------- |
| `--color-border`        | `border-border`        | `#2a2a40`   | Default borders     |
| `--color-border-subtle` | `border-border-subtle` | `#1e1e32`   | Subtle dividers     |
| `--color-ring`          | `ring-ring`            | `#845ef780` | Default focus ring  |
| `--color-ring-focus`    | `ring-ring-focus`      | `#9775fa`   | Keyboard focus ring |

### Semantic

| Token                   | Utility            | Hex       | Usage               |
| ----------------------- | ------------------ | --------- | ------------------- |
| `--color-success`       | `text-success`     | `#34d399` | Success messages    |
| `--color-success-muted` | `bg-success-muted` | `#065f46` | Success backgrounds |
| `--color-warning`       | `text-warning`     | `#fbbf24` | Warning messages    |
| `--color-warning-muted` | `bg-warning-muted` | `#78350f` | Warning backgrounds |
| `--color-error`         | `text-error`       | `#fb7185` | Error messages      |
| `--color-error-muted`   | `bg-error-muted`   | `#881337` | Error backgrounds   |

---

## Typography

Use the system font stack (no extra fonts to load). Tailwind's default type scale applies.

### Scale

| Class       | Size | Usage                        |
| ----------- | ---- | ---------------------------- |
| `text-xs`   | 12px | Captions, timestamps         |
| `text-sm`   | 14px | Secondary text, helper text  |
| `text-base` | 16px | Body text (default)          |
| `text-lg`   | 18px | Subheadings, emphasized body |
| `text-xl`   | 20px | Section headings             |
| `text-2xl`  | 24px | Page section titles          |
| `text-3xl`  | 30px | Page titles                  |
| `text-4xl`  | 36px | Hero headings                |

### Weights

| Class           | Weight | Usage             |
| --------------- | ------ | ----------------- |
| `font-normal`   | 400    | Body text         |
| `font-medium`   | 500    | Labels, emphasis  |
| `font-semibold` | 600    | Subheadings       |
| `font-bold`     | 700    | Headings, numbers |

### Recommended Pairings

```html
<!-- Page title -->
<h1 class="text-3xl font-bold tracking-tight md:text-4xl">Title</h1>

<!-- Section heading -->
<h2 class="text-xl font-semibold">Section</h2>

<!-- Body text -->
<p class="text-base text-text-secondary">Description text here.</p>

<!-- Caption / helper -->
<span class="text-sm text-text-muted">Last updated 2 minutes ago</span>
```

---

## Spacing & Layout

Use Tailwind's default spacing scale. Here are the most commonly used values:

| Class   | Value | Common Usage                |
| ------- | ----- | --------------------------- |
| `p-1`   | 4px   | Tight inner padding         |
| `p-2`   | 8px   | Small padding               |
| `p-3`   | 12px  | Compact component padding   |
| `p-4`   | 16px  | Standard padding            |
| `p-6`   | 24px  | Card/section padding        |
| `p-8`   | 32px  | Page section padding        |
| `gap-2` | 8px   | Tight spacing between items |
| `gap-3` | 12px  | Compact spacing             |
| `gap-4` | 16px  | Standard spacing            |
| `gap-6` | 24px  | Section spacing             |
| `gap-8` | 32px  | Large section spacing       |

### Container Pattern

```html
<!-- Centered content container with responsive padding -->
<div class="mx-auto w-full max-w-2xl px-4 md:px-6 lg:px-8">
  <!-- content -->
</div>
```

---

## Radii

| Token           | Utility        | Value    | Usage                   |
| --------------- | -------------- | -------- | ----------------------- |
| `--radius-sm`   | `rounded-sm`   | `6px`    | Buttons, inputs, badges |
| `--radius-md`   | `rounded-md`   | `10px`   | Cards, panels           |
| `--radius-lg`   | `rounded-lg`   | `16px`   | Modals, large cards     |
| `--radius-full` | `rounded-full` | `9999px` | Avatars, pills          |

---

## Shadows

Purple-tinted shadows for depth that feels cohesive with the dark theme.

| Token            | Utility        | Usage                         |
| ---------------- | -------------- | ----------------------------- |
| `--shadow-sm`    | `shadow-sm`    | Subtle lift (buttons, badges) |
| `--shadow-md`    | `shadow-md`    | Cards, dropdowns              |
| `--shadow-lg`    | `shadow-lg`    | Modals, popovers              |
| `--shadow-glow`  | `shadow-glow`  | Decorative purple glow        |
| `--shadow-focus` | `shadow-focus` | Focus ring alternative        |

### Usage Example

```html
<!-- Card with elevation -->
<div class="rounded-md bg-bg-surface p-6 shadow-md">Card content</div>

<!-- Focus ring via shadow (for components where outline doesn't work) -->
<button class="focus-visible:shadow-focus">Click me</button>
```

---

## Animations

Short, purposeful animations. Use sparingly for entrances and state changes.

| Token                  | Utility              | Duration | Usage                  |
| ---------------------- | -------------------- | -------- | ---------------------- |
| `--animate-fade-in`    | `animate-fade-in`    | 300ms    | Page/section entrance  |
| `--animate-slide-up`   | `animate-slide-up`   | 300ms    | Content entrance       |
| `--animate-scale-in`   | `animate-scale-in`   | 200ms    | Modal/popover entrance |
| `--animate-pulse-glow` | `animate-pulse-glow` | 2s loop  | Active/live indicators |

### Easing

| Token           | Utility       | Usage                      |
| --------------- | ------------- | -------------------------- |
| `--ease-smooth` | `ease-smooth` | Standard transitions       |
| `--ease-bounce` | `ease-bounce` | Playful micro-interactions |

### Usage Example

```html
<!-- Fade in a page section -->
<section class="animate-fade-in">Content that fades in</section>

<!-- Smooth color transition on hover -->
<button class="transition-colors duration-150 ease-smooth hover:bg-primary-600">
  Hover me
</button>
```

---

## Responsive Design

This system uses a **mobile-first** approach. Base styles target mobile, then layer on overrides at larger breakpoints.

### Breakpoints

| Prefix | Min Width | Target           |
| ------ | --------- | ---------------- |
| (none) | 0px       | Mobile (default) |
| `sm:`  | 640px     | Large phone      |
| `md:`  | 768px     | Tablet           |
| `lg:`  | 1024px    | Desktop          |

### Common Responsive Patterns

#### Stack to Row

```html
<!-- Stacked on mobile, side-by-side on tablet+ -->
<div class="flex flex-col gap-4 md:flex-row md:gap-6">
  <div>First</div>
  <div>Second</div>
</div>
```

#### Responsive Padding

```html
<!-- Tighter on mobile, more breathing room on desktop -->
<section class="px-4 py-6 md:px-6 md:py-8 lg:px-8 lg:py-12">Content</section>
```

#### Responsive Typography

```html
<!-- Smaller heading on mobile, larger on desktop -->
<h1 class="text-2xl font-bold md:text-3xl lg:text-4xl">Page Title</h1>
```

#### Responsive Grid

```html
<!-- 1 column mobile, 2 on tablet, 3 on desktop -->
<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  <div>Card 1</div>
  <div>Card 2</div>
  <div>Card 3</div>
</div>
```

#### Hide/Show by Breakpoint

```html
<!-- Mobile only -->
<nav class="md:hidden">Mobile nav</nav>

<!-- Desktop only -->
<aside class="hidden lg:block">Sidebar</aside>
```

---

## Component Patterns

Copy-paste Tailwind class recipes for common UI patterns. These are not pre-built components — just documented class combinations to keep the UI consistent.

### Buttons

#### Primary Button

```html
<button
  class="inline-flex items-center justify-center rounded-sm bg-primary px-4 py-2 text-sm font-medium text-text-inverse transition-colors duration-150 ease-smooth hover:bg-primary-600 focus-visible:shadow-focus disabled:opacity-40"
>
  Button
</button>
```

#### Secondary Button

```html
<button
  class="inline-flex items-center justify-center rounded-sm border border-border bg-bg-surface px-4 py-2 text-sm font-medium text-text transition-colors duration-150 ease-smooth hover:bg-bg-overlay focus-visible:shadow-focus disabled:opacity-40"
>
  Button
</button>
```

#### Ghost Button

```html
<button
  class="inline-flex items-center justify-center rounded-sm px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 ease-smooth hover:bg-bg-surface hover:text-text focus-visible:shadow-focus disabled:opacity-40"
>
  Button
</button>
```

#### Icon Button

```html
<button
  class="flex h-10 w-10 items-center justify-center rounded-sm bg-bg-surface text-text-secondary transition-colors duration-150 ease-smooth hover:bg-bg-overlay hover:text-text focus-visible:shadow-focus disabled:opacity-40"
>
  <!-- icon -->
</button>
```

### Cards

```html
<div class="rounded-md border border-border bg-bg-surface p-4 shadow-md md:p-6">
  <h3 class="text-lg font-semibold">Card Title</h3>
  <p class="mt-2 text-sm text-text-secondary">Card description.</p>
</div>
```

#### Card with Hover

```html
<div
  class="rounded-md border border-border bg-bg-surface p-4 shadow-md transition-all duration-150 ease-smooth hover:border-primary-700 hover:shadow-glow md:p-6"
>
  <h3 class="text-lg font-semibold">Interactive Card</h3>
  <p class="mt-2 text-sm text-text-secondary">Hover to see the glow.</p>
</div>
```

### Inputs

```html
<input
  type="text"
  placeholder="Enter value..."
  class="w-full rounded-sm border border-border bg-bg-raised px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-150 ease-smooth focus:border-primary focus:outline-none focus-visible:shadow-focus"
/>
```

#### Input with Label

```html
<label class="flex flex-col gap-1.5">
  <span class="text-sm font-medium text-text-secondary">Label</span>
  <input
    type="text"
    placeholder="Enter value..."
    class="rounded-sm border border-border bg-bg-raised px-3 py-2 text-sm text-text placeholder:text-text-muted transition-colors duration-150 ease-smooth focus:border-primary focus:outline-none focus-visible:shadow-focus"
  />
</label>
```

### Badges

```html
<!-- Default -->
<span
  class="inline-flex items-center rounded-full bg-bg-surface px-2.5 py-0.5 text-xs font-medium text-text-secondary"
>
  Badge
</span>

<!-- Primary -->
<span
  class="inline-flex items-center rounded-full bg-primary-900 px-2.5 py-0.5 text-xs font-medium text-primary-300"
>
  Active
</span>

<!-- Success -->
<span
  class="inline-flex items-center rounded-full bg-success-muted px-2.5 py-0.5 text-xs font-medium text-success"
>
  Online
</span>

<!-- Error -->
<span
  class="inline-flex items-center rounded-full bg-error-muted px-2.5 py-0.5 text-xs font-medium text-error"
>
  Error
</span>
```

### Divider

```html
<hr class="border-border-subtle" />
```

---

## Accessibility

### Contrast

All text/background combinations in this system meet WCAG AA contrast requirements:

- `text` (`#f0eef6`) on `bg` (`#0a0a12`) — **15.8:1**
- `text-secondary` (`#a8a3b8`) on `bg` (`#0a0a12`) — **7.5:1**
- `text-muted` (`#6e6880`) on `bg` (`#0a0a12`) — **3.9:1** (decorative/non-essential only)
- `text-inverse` (`#0a0a12`) on `primary` (`#845ef7`) — **4.5:1**

### Focus States

- All interactive elements should have visible focus indicators
- The system provides `:focus-visible` styles automatically via the base layer
- Use `focus-visible:shadow-focus` for additional emphasis when needed

### Motion

- All animations use `prefers-reduced-motion` safe defaults via Tailwind
- Keep animations under 300ms for UI transitions
- Avoid animation on essential content — it should be for delight, not comprehension

### Touch Targets

- Minimum interactive element size: `h-10 w-10` (40x40px)
- Buttons should have at least `px-4 py-2` padding
- Space interactive elements at least `gap-2` (8px) apart
