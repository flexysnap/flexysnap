# flexysnap

Structural wireframe snapshot testing for Playwright — built for e-commerce.

Traditional pixel-diffing tools flag every layout shift as a failure, even a 2px nudge from a font render or a shifting badge. Real webshops also have content that changes on purpose: cross-sell blocks, promo banners, stock counters. `flexysnap` takes a different approach. Instead of comparing raw pixels, it extracts a structural wireframe from the page — bounding boxes, text content, and image color histograms — then compares that wireframe against a baseline. You test what actually matters: is the layout intact, is the text correct, did an image visually change — without drowning in false positives from anti-aliasing noise.

## Why flexysnap

- **Structural diffing** — captures element bounding boxes, text nodes, and image histograms instead of raw pixels, so sub-pixel font rendering and anti-aliasing never fail your suite.
- **Position tolerance** — element groups can be marked `strictPosition: false` to check size only, ignoring exact placement for content that legitimately moves.
- **Stability detection** — wireframes are re-captured until the layout settles, so lazy-loaded images, animations, and reflow don't produce flaky baselines.
- **Built on Playwright** — works with your existing Playwright config, fixtures, and test runner. No new browser automation layer to learn.
- **Annotated screenshots** — overlay the captured wireframe onto its screenshot to visualize what was checked and what differed.

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
import { expectWireframe } from 'flexysnap';

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

## API

`flexysnap` exports the following from its main entry point:

### Test utilities

- `waitForCompleteLoad(page)` — wait for `domcontentloaded`, `load`, and a settle delay.
- `click(page, locator)` — resilient click that closes popups, re-hovers, scrolls into view, and retries.
- `highlightedClick(page, locator)` — scroll a locator into the viewport and force-click it.
- `hover(page, locator)` — hover a locator and remember it for re-hovering.
- `rehover(page)` — re-hover the last hovered locator.
- `fill(page, field, value)` — click and fill an input by name or locator.
- `setClosePopups(fn)` — register a function used to dismiss popups before interactions.
- `setBaseUrl(url)` — set the base URL used for request cache-busting.
- `logTimestamp(eventName)` — log an event with elapsed time since test start.

### Wireframe capture

- `expectWireframe(page, elementGroups, configName, outputFile, outputName, retryDelay?, maxRetryCount?)` — capture a stable wireframe and write JSON + screenshot.
- `getRGBHistogramFromBuffer(buffer)` — compute a 48-bin RGB histogram from an image buffer.

### Wireframe comparison

- `compareWireframes(baselineWireframe, currentWireframe)` — diff two wireframes and annotate the current one with `differences`.
- `compareElements(baselineElement, currentElement, strictPosition?)`
- `compareTexts(baselineTexts, currentTexts, strictPosition?)`
- `compareBoundingBoxes(baselineRect, currentRect, tolerance?, strictPosition?)`
- `createPairings(currentElements, baselineElements)` — nearest bounding-box matching between two element sets.
- `histogramDiff(a, b)` — sum of absolute differences between two histograms.

### Stability

- `areWireframesStable(previousWireframeData, currentWireframeData)` — determine whether two consecutive captures are stable enough to trust.

## How it works

1. **Wireframe extraction** — `flexysnap` walks the DOM in the browser, collecting bounding boxes for each matched element, text nodes for `text` groups, and RGB histograms (via `sharp`) for `image` groups.
2. **Stability loop** — the wireframe is captured repeatedly until consecutive captures are stable (element counts match, text is unchanged, and total bounding-box area drift stays under 3%). This defeats lazy loading and animation flakiness.
3. **Baseline comparison** — element groups from the current run are paired with the baseline using nearest bounding-box matching. Each pair is diffed for layout shifts, text mismatches, and histogram (image) differences. Unmatched elements are reported as extra or missing.

## Environment variables

Wireframe paths are namespaced by environment variables so the same tests can run across devices and user roles:

| Variable      | Example      | Purpose                          |
|---------------|--------------|----------------------------------|
| `TEST_TYPE`   | `smoke`      | Top-level test grouping          |
| `DEVICE_TYPE` | `mobile`     | Device / viewport identifier     |
| `USER_TYPE`   | `guest`      | User role identifier             |

The output path for a captured wireframe is:

```
wireframes/test/<TEST_TYPE>/<configName>/<DEVICE_TYPE>/<USER_TYPE>/
```

where `configName` is passed directly to `expectWireframe`.

## Comparing against a baseline

Use `compareWireframes` in your own Playwright spec to diff a captured wireframe against a stored baseline. It pairs each element group's elements with the baseline using nearest bounding-box matching, then annotates the current wireframe's elements and texts with a `differences` array.

```js
import { compareWireframes } from 'flexysnap';

const annotated = compareWireframes(baselineWireframe, currentWireframe);
```

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

## CLI

`flexysnap` ships a small CLI:

```bash
# print usage
flexysnap

# regenerate baseline snapshots (not implemented yet)
flexysnap update

# annotate a single wireframe/screenshot pair
flexysnap annotate wireframe.json screenshot.png

# annotate every matching .json/.png pair in a folder
flexysnap annotate ./wireframes/test/smoke/product-config/mobile/guest
```

### Annotating screenshots

Overlay the captured wireframe onto its screenshot to visualize what was checked and what differed. Boxes are color-coded: text (blue), image (green), box (amber), and error (red) for any element carrying differences. Dashed borders indicate position-tolerant groups. Output is written next to the screenshot as `<name>_wireframe.png`.

## Roadmap

- [ ] Baseline update command (`flexysnap update`)
- [ ] Region auto-detection for common e-commerce patterns (cart, checkout, PDP)
- [ ] GitHub Actions annotation integration
- [ ] HTML report generation with comparison sliders

## Contributing

Issues and pull requests are welcome. Please open an issue before submitting large changes so we can discuss the approach first.

## License

MIT
