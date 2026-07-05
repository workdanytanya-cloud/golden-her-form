
# Tanya Fitness — Premium Landing (Phase 1)

Scope for this round: **landing page only**. Auth, questionnaire, calculations, dashboard, admin, payments, and AI are explicitly deferred to later phases.

Note on design directions: the `create_directions` tool refused (it requires a screenshot of existing UI and this is a net-new build). I'll go straight to build with the locked luxury spec below and we can iterate on look-and-feel from the live preview.

## Locked design tokens

- Background: `#0B0B0C` (near-black), surface `#141412` warm-black
- Ivory: `#F5F1EA`, warm gray `#8A857D`, hairline `rgba(200,154,74,0.25)`
- Gold accent: `#C89A4A`
- Typography: **Fraunces** (editorial serif display) + **Inter** (neutral sans) — loaded via `<link>` in `__root.tsx`
- Radius: 20–28px on cards; gold 1px hairlines instead of heavy borders
- Motion: fade-up on scroll (IntersectionObserver), parallax hero, `CountUp` counters, hover image zoom, gold underline draw

## Imagery strategy

Since the VK community isn't scrapeable and we shouldn't alter the trainer's appearance, we'll use **AI-generated environmental/supporting imagery** for hero backdrop, program cards, before/after placeholders, and CTA — cinematic gym textures, sunlit studios, equipment stills, silhouettes shot from behind. **No AI-generated faces of the trainer.** When you upload authentic photos of Tanya later, we swap them into the hero, About portrait, and CTA slots (already wired as image variables).

Generated assets (agent-side `generate_image`, stored in `src/assets/`):
1. Hero backdrop — cinematic dark studio, warm rim light, silhouette from behind
2. About-section environment — soft window light on workout mat, no face
3. 6 program tiles — weight loss, home workouts, stretching, muscle tone, nutrition, personal coaching (all environmental / equipment / textural)
4. Before/after placeholder pair (silhouettes, back-to-camera)
5. CTA full-bleed — dramatic dawn lighting, movement blur

## Page structure (`src/routes/index.tsx` + section components)

```
src/
  components/
    landing/
      Nav.tsx              (sticky, glass, gold logo mark)
      Hero.tsx             (full-bleed image, H1 serif, CTA pair, 3 counters)
      About.tsx            (asymmetric: portrait left, story + timeline right)
      WhyChoose.tsx        (6 glass cards, gold icons)
      Programs.tsx         (6 tiles, hover zoom + gold overlay)
      Results.tsx          (before/after slider + testimonial trio)
      HowItWorks.tsx       (6-step vertical timeline with gold rail)
      Faq.tsx              (shadcn accordion, gold expand indicator)
      CtaFinal.tsx         (full-bleed image, oversized headline, button)
      Footer.tsx
    ui/
      CountUp.tsx          (IntersectionObserver + rAF)
      BeforeAfterSlider.tsx (drag handle, gold divider)
      Reveal.tsx           (fade-up on view)
  routes/
    index.tsx              (composes sections)
    __root.tsx             (updated: real title/desc/OG, Fraunces+Inter <link>)
  styles.css               (tokens + custom utilities: .hairline, .glass, .gold-underline)
  assets/                  (generated images)
```

## Section content

1. **Hero** — Headline: *"Твоё тело. Твоя дисциплина."* (or EN: *"Your body. Your discipline."*), sub: 10 years of coaching women toward lasting transformation. CTAs: *Начать трансформацию* (primary gold) / *Бесплатная консультация* (ghost). Counters: 500+ / 10+ / 100%.
2. **About** — portrait slot + name, one-paragraph story, certificates row (chips), 4-item timeline (2014 → today), mission statement.
3. **Why choose me** — 6 cards: Individual approach · Online support · Nutrition · Workout plans · Motivation · Result guarantee.
4. **Programs** — 6 tiles: Weight loss · Home workouts · Stretching · Muscle tone · Nutrition · Personal coaching. Hover: image zoom + gold overlay + "View program →".
5. **Results** — Interactive before/after slider (drag handle, gold vertical rule) + 3 testimonials with star ratings + animated stat strip.
6. **How it works** — Vertical timeline (gold rail, numbered nodes): Register → Fill questionnaire → Get calculations → Receive plan → Train → Get results.
7. **FAQ** — shadcn Accordion, 6–8 Q&A on pricing, format, guarantees, refunds, mobile access, nutrition.
8. **Final CTA** — Full-bleed cinematic image, oversized serif headline, single primary CTA, phone/email/socials strip in footer below.

## Technical

- TanStack Start route; SSR-safe (no `window` at module scope in animations — all IntersectionObserver work in `useEffect`).
- `__root.tsx` head() gets real title (*Tanya — Premium Fitness Coaching*), description, og:title/og:description/og:type/twitter:card. `og:image` added on `index.tsx` head() only, pointing to the generated hero image at absolute URL.
- Fonts: `<link rel="preconnect">` + `<link rel="stylesheet">` for Fraunces + Inter in `__root.tsx` head links array. `--font-display` and `--font-sans` registered in `@theme` in `styles.css`. **Do not** `@import` remote URLs from CSS.
- Tokens registered in `@theme inline`; shadcn `--background`/`--foreground`/etc. remapped to the dark luxury palette so all existing shadcn components inherit correctly.
- Animations via CSS keyframes (`fade-in`, existing) + a small `Reveal` wrapper. Counters use `requestAnimationFrame`.
- Fully responsive (mobile-first). Sticky nav collapses to a sheet on mobile.
- Accessibility: alt text on every image, focus rings in gold, `prefers-reduced-motion` disables parallax + counters animate.
- SEO: single H1 (hero), semantic sections, JSON-LD `LocalBusiness`/`Person` in root head scripts array.

## Out of scope this round (explicit)

Auth, JWT, roles, questionnaire form, BMR/macro calculator, admin panel, workout/nutrition builders, client dashboard, messaging, payments, AI features. Lovable Cloud is **not** enabled in this phase — we'll enable it in phase 2 when we add auth + questionnaire.

## Deliverable

A single premium landing page live in the preview, ready for you to drop authentic photos of Tanya into three named slots (hero, about-portrait, cta) via a one-line swap. After you approve this, phase 2 will add Cloud + auth + questionnaire + BMR results screen.
