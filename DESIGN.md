---
name: Staffly
description: Calm, clinical shift-callout staffing for one hospital - admins on desktop, staff on phones.
colors:
  clinical-plum: "#3B2461"
  plum-50: "#F4F1FA"
  plum-100: "#E8E4F2"
  plum-200: "#D1C8E5"
  plum-500: "#6B5A9C"
  plum-600: "#4A3A7A"
  plum-800: "#2E1C4D"
  plum-900: "#22153A"
  alert-red: "#C41230"
  alert-red-50: "#FBE9EC"
  alert-red-700: "#7C0B1E"
  ward-white: "#F8F9FB"
  surface: "#FFFFFF"
  slate-50: "#F8FAFC"
  slate-100: "#F1F5F9"
  slate-200: "#E2E8F0"
  slate-300: "#CBD5E1"
  slate-400: "#94A3B8"
  slate-500: "#64748B"
  slate-600: "#475569"
  slate-700: "#334155"
  slate-900: "#0F172A"
  assigned-green: "#065F46"
  assigned-green-50: "#ECFDF5"
  overlap-amber: "#92400E"
  overlap-amber-50: "#FFFBEB"
typography:
  display:
    fontFamily: "DM Serif Display, Georgia, serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.55
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.05em"
rounded:
  sm: "6px"
  DEFAULT: "8px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
components:
  button-primary:
    backgroundColor: "{colors.clinical-plum}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.plum-800}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate-700}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.slate-900}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: "20px"
  top-bar:
    backgroundColor: "{colors.clinical-plum}"
    textColor: "{colors.surface}"
    height: "64px"
  status-pill-open:
    backgroundColor: "{colors.plum-50}"
    textColor: "{colors.plum-800}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  status-pill-assigned:
    backgroundColor: "{colors.assigned-green-50}"
    textColor: "{colors.assigned-green}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
---

# Design System: Staffly

## Overview

**Creative North Star: "The Charge Desk"**

Staffly should feel like a well-run charge nurse's desk: quiet, ordered, and instantly legible to someone who has been interrupted three times in the last minute. A single deep plum carries identity and primary action; everything else is cool slate on near-white, so status color (open, assigned, overlap, alert) is the loudest thing on a screen only when it needs to be. Hierarchy comes from type weight, spacing, and the one serif display face, not from decoration.

Density follows the user. Admin screens (desktop, `max-w-6xl` content column) pack cards, metrics, and tables side by side; worker screens are single-column stacks of cards with large touch targets because they are used one-handed on a phone mid-shift. The same components serve both; layouts change at Tailwind's `sm` (640px) and `md` (768px) breakpoints rather than forking components.

Motion is functional and brief: color and shadow transitions on hover/press, opacity fades for affordances, no decorative movement.

**Key Characteristics:**
- One brand hue (clinical plum `#3B2461`) for the top bar, primary buttons, focus rings, and selection.
- Clinical red reserved for alerts, destructive actions, and errors - never decoration.
- Serif display (DM Serif Display) only for page titles and the wordmark; Inter everywhere else.
- White cards with a hairline slate border and a faint plum-tinted shadow on a cool near-white page.
- Pills and badges in uppercase micro-labels for status; plain sentence case for content.

## Colors

A restrained plum-and-slate clinical palette with semantic status accents.

### Primary
- **Clinical Plum** (#3B2461): the top bar, primary buttons, wordmark, page titles, active tab underline, selected states. Tailwind `primary-700` (also `primary` / `staffly-purple`).
- **Plum tints** (#F4F1FA to #D1C8E5): selection and hover fills (`primary-50`), open-status pills, unread notification rows, today's calendar cell.
- **Deep Plum** (#2E1C4D / #22153A): primary hover/active, heading text (`primary-900` is the base `h1`-`h6` color).

### Secondary
- **Alert Red** (#C41230): destructive buttons, error text and borders, cancelled status, the unread-count badge. Tailwind `accent`.

### Tertiary
- **Assigned Green** (#065F46 on #ECFDF5): assigned status, delivered/answered outreach, eligible swap candidates (Tailwind `emerald-*`).
- **Overlap Amber** (#92400E on #FFFBEB): a likely double-booking (2+ shifts for one person on one day) in the Location Schedule (Tailwind `amber-*`).

### Neutral
- **Ward White** (#F8F9FB): page background (`staffly-bg`).
- **Surface** (#FFFFFF): cards, panels, inputs, drawers.
- **Slate ramp** (#F8FAFC to #0F172A): borders (`neutral-200`), muted fills (`neutral-100`), secondary text (`neutral-500`, `neutral-600` on tinted fills), body text (`neutral-700`-`900`).

### Named Rules
**The 4.5 Floor Rule.** Text never goes lighter than `neutral-500` on white, and never lighter than `neutral-600` on a tinted fill (`neutral-100`, `primary-50`, card tints). `neutral-400` and lighter are for decorative `aria-hidden` icons, placeholders, and disabled states only.

**The One Alarm Rule.** Clinical red means "something is wrong or destructive". It is never used for emphasis, branding, or decoration.

## Typography

**Display Font:** DM Serif Display (with Georgia, serif), loaded via `next/font` as `--font-dm-serif`.
**Body Font:** Inter (with system-ui, sans-serif), loaded via `next/font` as `--font-inter`.

**Character:** A single editorial serif gives page titles and the wordmark a calm, institutional voice; Inter keeps every data-bearing line neutral and highly legible at small sizes.

### Hierarchy
- **Display** (400, 1.5rem mobile / 1.875rem desktop, `.page-title`, plum 700): one per page, the page title.
- **Headline** (600, 1.5rem, tight tracking): schedule range headings ("October 12-18, 2026").
- **Title** (600, 1.125rem, `.section-title` / card titles): card and section headers.
- **Body** (400, 0.875rem): default UI text; 1rem in form fields below `sm` so iOS never zooms on focus.
- **Label** (600-700, 0.625-0.6875rem, uppercase, 0.05-0.1em tracking): field labels, metric captions, status pills, column headers.

### Named Rules
**The One Serif Rule.** DM Serif Display appears only in the page title and the wordmark. Everything that carries data is Inter.

## Layout

- App shell: sticky 64px plum top bar (`z-40`), then a centered content column (`max-w-6xl`, `px-4 lg:px-8`, `py-8`) inside `<main>`, then a quiet footer.
- Spacing follows Tailwind's 4px scale; cards use 16-20px internal padding, sections are separated by 24-32px.
- Breakpoints: `sm` 640px (phone to larger layouts, input text size), `md` 768px (side-by-side schedule grid + day panel), `lg` 1024px (wider gutters, two-column detail pages).
- Phone (390px) is a first-class target: controls wrap onto one row where they fit, grids keep every day of a week visible, and anything that must scroll sideways (Location Schedule, month heatmap, outreach log) shows an edge fade via `ScrollAreaX` so overflow is never hidden.

## Elevation & Depth

Mostly flat with tonal layering. Cards sit on the page with a hairline border plus a faint, plum-tinted ambient shadow; overlays (drawer, swap panel, notification popover) use a stronger `shadow-xl`/`shadow-lg` over a 40% slate scrim.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 3px rgba(59, 36, 97, 0.06), 0 4px 12px rgba(59, 36, 97, 0.04)`): resting cards (`.card-base`, `shadow-card`).
- **Lifted** (`shadow-md`): hover on clickable shift cards.
- **Overlay** (`shadow-xl` / `shadow-lg`): slide-over panels, drawer, popovers.

### Named Rules
**The Layering Rule.** Sticky header is `z-40`; anything that overlays it (drawer, swap panel) is `z-50`. A new overlay below `z-50` will be painted over by the header.

## Shapes

Gently rounded and consistent: 6px (`rounded-md`) for buttons and inputs, 12px (`rounded-xl`) for cards and large search fields, full pills for status badges, the calendar nav, and segmented view toggles. Borders are 1px slate-200 hairlines; selection adds a 1-2px plum ring rather than a heavier border.

## Components

### Buttons
- **Shape:** gently rounded (6px); heights 32 / 40 / 44px (`sm` / `md` / `lg`).
- **Primary:** plum fill, white text, `hover:primary-800`, `active:primary-900`.
- **Outline / Secondary / Ghost:** white with slate-300 border, slate-100 fill, or text-only.
- **Danger:** clinical red fill.
- **Focus:** 2px `primary-500` ring with 2px offset (`focus-visible` only). Disabled is 50% opacity, no pointer events.

### Chips and Pills
- **Status pills:** uppercase 10px bold, full radius, tinted fill + matching border (`.status-open`, `.status-assigned`, `.status-closed`, `.status-cancelled`).
- **Bid pills:** sentence case (`.bid-pending`, `.bid-selected`, `.bid-not-selected`).
- **Muted pill** (`.pill-muted`): neutral-100 fill, neutral-600 text.

### Cards / Containers
- **Corner Style:** 12px (`.card-base`) or 8px (`Card` primitive).
- **Background:** white on Ward White.
- **Shadow Strategy:** Card shadow at rest; Lifted on hover for clickable cards only.
- **Internal Padding:** 16-20px.

### Inputs / Fields
- **Style:** white, 1px slate-300 border, 6px radius, 40px tall (44px on login/search), 16px text below `sm` / 14px above.
- **Focus:** 2px `primary-500` ring and plum border.
- **Error:** clinical red border plus an inline `text-accent` message, linked with `aria-invalid` / `aria-describedby`.

### Navigation
- **Top bar:** plum, white 44px icon buttons (menu, home, help, notifications), page title or the serif wordmark.
- **Drawer:** left slide-over (`z-50`, `role="dialog"`), account block, "View as" segmented toggle for admins, direct links, then "More". The current page's link is the highlighted one (`aria-current="page"`).
- **Calendar nav:** prev/next pill, Today pill, Day/Week/Month segmented toggle on one row.

### Location Schedule grid (signature component)
Roster rows down the left (sticky staff column), day columns across, one compact "Day 07:00-19:00 / Unit 4B" chip per shift; two shifts in one cell turn the cell amber. Month view collapses to a per-day count heatmap that links to the day.

## Do's and Don'ts

### Do:
- **Do** use `primary-700` for the single most important action on a screen and outline/ghost for the rest.
- **Do** keep text at `neutral-500` or darker on white and `neutral-600` or darker on tinted fills.
- **Do** give every icon-only control an `aria-label` and a 40-44px hit area, even when the icon is 16px.
- **Do** use `transition-colors` / explicit property lists with 150-200ms `ease-out`; add `motion-reduce:transition-none` to anything that moves.
- **Do** wrap horizontally scrolling content in `ScrollAreaX` so hidden columns are marked.

### Don't:
- **Don't** use `transition-all`; name the properties.
- **Don't** introduce a second brand hue or use clinical red for emphasis.
- **Don't** use DM Serif Display outside page titles and the wordmark.
- **Don't** render an overlay below `z-50`, or inside a `space-y-*` stack without `!m-0`.
- **Don't** set form-field text below 16px at phone width.
