# Design And Theming

Visual preferences and references for future owl.red interfaces. This guide
records direction, not approval to redesign deployed applications or replace
their existing design systems.

## Preferred References

- **The user's own website:** [d0ntb.link](https://d0ntb.link/) is a first-party
  reference for the simple early-internet hacker aesthetic the user likes.
  Its live page, source stylesheet and banner establish concrete examples:
  Fira Mono typography; a small centered personal link directory; `./personal`,
  `./navigation` and `./social` headings; `>` link prefixes; flat, square borders;
  a dark background; and an irreverent "you wouldn't download an owl" banner.
  Its older palette is not the current color preference: use Catppuccin for
  new theming. Favor direct navigation, personal character and
  minimal presentation over generic corporate/SaaS composition for similar work.
- **Hermes Agent website:** the user strongly likes the overall design of
  [hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/).
  Treat this as a preferred website-design reference. Specific fonts, spacing,
  motion, components and individual sections have not been separately selected.
  Inspect the current site visually when proposing a design; do not infer its
  appearance from extracted text alone or copy its branding, assets or wording.
- **Catppuccin:** the user likes the
  [Catppuccin](https://catppuccin.com/) theme ecosystem. Glance uses native
  Catppuccin Mocha/Latte palettes, and the guest portal's approved accent is
  Mocha Mauve, `#cba6f7`. Preserve established typography and layout unless a
  change is requested. The other flavors are Latte, Frappe and Macchiato;
  liking Catppuccin does not require every application to use dark Mocha.

d0ntb.link supplies a personal, minimal hacker-web reference; Hermes supplies
another preferred website-design direction; Catppuccin supplies a palette and
cross-application theme ecosystem. They are complementary sources of inspiration,
not interchangeable themes or an already approved combined spec.
Interest in Hermes's website does not imply approval to deploy Hermes Agent.

## Applying The Direction

- For personal pages and small tools, consider a lightweight static page,
  monospace typography, ordinary link lists, compact headings and simple borders.
  Preserve the old-web character without reproducing legacy HTML limitations,
  inaccessible interactions or fixed-width mobile overflow. The preference does
  not imply fake terminal boot sequences, constant animation or CRT effects.
- Keep operational dashboards compact and easy to scan. Use expressive website
  treatments where appropriate, without turning administration tools into
  marketing pages or hiding useful information behind decorative panels.
- Prefer maintained native themes and existing Catppuccin ports before writing
  application-specific CSS. Check compatibility with the deployed app version;
  an upstream update can invalidate selectors and custom overrides.
- Use semantic color tokens for backgrounds, text, borders, accent, focus and
  success/warning/error states. A mauve accent must not replace status semantics.
  Use labels or icons as well as color to communicate state.
- Use free/openly licensed fonts and assets. Keep license and attribution
  requirements; do not buy fonts or reproduce proprietary design assets.
- Check readable contrast, visible keyboard focus, responsive layouts and
  reduced-motion behavior. Target WCAG AA text contrast: 4.5:1 for normal text
  and 3:1 for large text. A named palette alone does not establish accessibility.
- Before implementation, agree which reference qualities apply to that surface.
  Before rollout, review desktop/mobile output and preserve a rollback path.
  Documentation changes alone must not trigger an application restyle.

## Related Projects

These are visual references to explore, not additional approved theme choices.

| Project | Relationship | Useful For |
|---------|--------------|------------|
| [Catppuccin ports](https://catppuccin.com/ports) | Existing preferred theme ecosystem | Finding supported themes for individual applications before adding custom CSS. |
| [Rose Pine](https://rosepinetheme.com/) | Similar community palette/theme ecosystem | A subtle, muted alternative with many application themes; compare the feel rather than treating it as Catppuccin-compatible. |
| [Nord](https://www.nordtheme.com/) | Similar palette and application-port ecosystem | A cooler, arctic blue-gray alternative for restrained interfaces. |
| [Radix Colors](https://www.radix-ui.com/colors) | UI color system, not a cross-app theme pack | Semantic scales for backgrounds, interaction states and text when building custom interfaces. |

For new work, start with the preferred references. Explore alternatives only
when they solve a concrete requirement or the user requests a comparison.

## Existing Implementations

- [d0ntb.link](https://d0ntb.link/): the user's personal website and direct
  early-internet design reference; its separate repository owns its HTML, CSS
  and banner. This guide does not authorize changing that site.
- [Glance configuration and themes](../../gitops/dashboards/glance.yml).
- [Dashboard guide](../../gitops/dashboards/README.md).
- [Guest portal application](https://github.com/d0ntblink/owl.red-guest-captive-portal):
  separate application repository; preserve its accepted fonts/layout and mauve
  accent unless explicitly revisiting that design.

Keep this guide as the shared reference. Implementation-specific tokens and
styles belong in the application's existing configuration or stylesheets.