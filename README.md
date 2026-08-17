# flexysnap

Structural wireframe snapshot testing for Playwright — built for e-commerce.

Traditional pixel-diffing tools flag every layout shift as a failure, even a 2px nudge from a font render or a shifting badge. Real webshops also have content that changes on purpose: cross-sell blocks, promo banners, stock counters. `flexysnap` takes a different approach. Instead of comparing raw pixels, it extracts a structural wireframe from the page — bounding boxes, text content, and image color histograms — then compares that wireframe against a baseline. You test what actually matters: is the layout intact, is the text correct, did an image visually change — without drowning in false positives from anti-aliasing noise.

## Why flexysnap

- **Structural diffing** — captures element bounding boxes, text nodes, and image histograms instead of raw pixels, so sub-pixel font rendering and anti-aliasing never fail your suite.
- **Position tolerance** — element groups can be marked `strictPosition: false` to check size only, ignoring exact placement for content that legitimately moves.
- **Stability detection** — wireframes are re-captured until the layout settles, so lazy-loaded images, animations, and reflow don't produce flaky baselines.
- **Built on Playwright** — works with your existing Playwright config, fixtures, and test runner. No new browser automation layer to learn.
- **Rich HTML reports** — generate an interactive report with baseline/current image sliders, annotated wireframe overlays, and categorized differences (text, image, layout).

## Installation

```bash
npm install --save-dev flexysnap
npx playwright install
```

## Concepts

### Element groups

You describe the page as a list of **element groups**. Each group targets a CSS selector and declares a type:

| Type    | What it captures                                              |
|---------|--------------------------------------------------------------|
| `box`   | Bounding box only (layout/size)                              |
| `image` | Bounding box plus an RGB color histogram for visual comparison |
| `text`  | Bounding box plus every visible direct text node inside it   |

```js
const elementGroups = [
  { selector: '.hero-banner', type: 'image' },
  { selector: '.product-title', type: 'text' },
  { selector: '.cross-sell-carousel', type: 'box', strictPosition: false },
  { selector: '.price', type: 'text', textIgnoreClasses: ['screen-reader-text'] }
];
```

- `strictPosition: false` — compare element size only, not exact position.
- `textIgnoreClasses` — skip text found inside elements carrying these class names.

## Quick start

### Capturing a wireframe

```js
import { test } from '@playwright/test';
import { expectWireframe } from 'flexysnap/wireframeUtils.js';

const elementGroups = [
  { selector: '.hero-banner', type: 'image' },
  { selector: '.product-title', type: 'text' },
  { selector: '.cross-sell-carousel', type: 'box', strictPosition: false }
];

test('product page wireframe', async ({ page }) => {
  await page.goto('https://example-shop.com/products/example-item');

  await expectWireframe(
    page,
    elementGroups,
    'product-config',   // config name
    'product-page',     // output file basename
    'Product Page'      // human-readable name
  );
});
```

`expectWireframe` captures a stable wireframe (re-sampling until the layout settles), writes a JSON wireframe and a PNG screenshot into:

```
wireframes/test/<TEST_TYPE>/<config>/<DEVICE_TYPE>/<USER_TYPE>/
```

## How it works

1. **Wireframe extraction** — `flexysnap` walks the DOM in the browser, collecting bounding boxes for each matched element, text nodes for `text` groups, and RGB histograms (via `sharp`) for `image` groups.
2. **Stability loop** — the wireframe is captured repeatedly until consecutive captures are stable (element counts match, text is unchanged, and total bounding-box area drift stays under 3%). This defeats lazy loading and animation flakiness.
3. **Baseline comparison** — element groups from the current run are paired with the baseline using nearest bounding-box matching. Each pair is diffed for layout shifts, text mismatches, and histogram (image) differences. Unmatched elements are reported as extra or missing.

## Environment variables

Wireframe paths are namespaced by environment variables so the same tests can run across devices and user roles:

| Variable      | Example      | Purpose                          |
|---------------|--------------|----------------------------------|
| `TEST_TYPE`   | `smoke`      | Top-level test grouping          |
| `TEST_CONFIG` | `production` | Configuration name               |
| `DEVICE_TYPE` | `mobile`     | Device / viewport identifier     |
| `USER_TYPE`   | `guest`      | User role identifier             |

## Comparing against a baseline

The comparison suite reads baseline and current wireframes and asserts they match:

```bash
TEST_TYPE=smoke TEST_CONFIG=production DEVICE_TYPE=mobile USER_TYPE=guest \
  npx playwright test compare-wireframes.spec.js
```

It reads from:

```
wireframes/baseline/<TEST_TYPE>/<TEST_CONFIG>/<DEVICE_TYPE>/<USER_TYPE>/
wireframes/test/<TEST_TYPE>/<TEST_CONFIG>/<DEVICE_TYPE>/<USER_TYPE>/
```

Each matched wireframe is diffed and re-written with annotated `differences`, then every difference is asserted as a soft failure so the whole page is reported at once.

## Difference types

| Type                   | Meaning                                            |
|------------------------|----------------------------------------------------|
| `layout_shift`         | Bounding box moved beyond the position tolerance   |
| `size_mismatch`        | Size changed (position-tolerant groups)            |
| `text_mismatch`        | Text content differs between baseline and current  |
| `extra_text`           | Text present now but not in baseline               |
| `missing_text`         | Text present in baseline but not now               |
| `histogram_difference` | Image content changed visually                     |
| `extra_element`        | Element present now but not in baseline            |
| `missing_element`      | Element present in baseline but not now            |

## Annotating screenshots

Overlay the captured wireframe onto its screenshot to visualize what was checked and what differed:

```bash
# annotate a single pair
node annotateWireframe.mjs wireframe.json screenshot.png

# annotate every matching .json/.png pair in a folder
node annotateWireframe.mjs ./wireframes/test/smoke/production/mobile/guest
```

Boxes are color-coded: text (blue), image (green), box (amber), and error (red) for any element carrying differences. Dashed borders indicate position-tolerant groups. Output is written as `<name>_wireframe.png`.

## Generating an HTML report

```bash
node generate-report.js <baseline-folder> <current-folder> [output-file]
```

Example:

```bash
node generate-report.js \
  wireframes/baseline/smoke/production/mobile/guest \
  wireframes/test/smoke/production/mobile/guest \
  report.html
```

The report includes:

- Summary statistics (elements checked, total / text / image / layout differences) with click-to-jump navigation.
- A baseline↔current comparison slider (via cocoen) when both images are available.
- A global toggle between **original** and **annotated** screenshots.
- A per-wireframe list of detected differences, with empty sections auto-collapsed.

## Roadmap

- [ ] Region auto-detection for common e-commerce patterns (cart, checkout, PDP)
- [ ] GitHub Actions annotation integration
- [ ] Plugin-change tracking integrated into the HTML report

## Contributing

Issues and pull requests are welcome. Please open an issue before submitting large changes so we can discuss the approach first.

## License

MIT
