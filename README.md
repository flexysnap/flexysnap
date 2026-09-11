# flexysnap

Structural wireframe snapshot testing for Playwright — built for e-commerce.

Traditional pixel-diffing tools flag every layout shift as a failure, even a 2px nudge from a font render or a shifting badge. Real webshops also have content that changes on purpose: cross-sell blocks, promo banners, stock counters. `flexysnap` takes a different approach. Instead of comparing raw pixels, it extracts a structural wireframe from the page — bounding boxes, text content, and image color histograms — then compares that wireframe against a baseline. You test what actually matters: is the layout intact, is the text correct, did an image visually change — without drowning in false positives from anti-aliasing noise.

## Why flexysnap

- **Structural diffing** — captures element bounding boxes, text nodes, and image histograms instead of raw pixels, so sub-pixel font rendering and anti-aliasing never fail your suite.
- **Position tolerance** — element groups can be marked `strictPosition: false` to check size only, ignoring exact placement for content that legitimately moves.
- **Digit masking** — element groups can be marked `maskDigits: true` so counters, prices, and timers don't fail on numeric churn.
- **Stability detection** — wireframes are re-captured until the layout settles, so lazy-loaded images, animations, and reflow don't produce flaky baselines.
- **Scroll-safe capture** — the scroll position at extraction time is recorded and restored, and stored alongside the screenshot.
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
  { selector: '.price', type: 'text', maskDigits: true },
  { selector: '.stock-status', type: 'text', textIgnoreClasses: ['screen-reader-text'] }
];
```

- `strictPosition: false` — compare element size only, not exact position.
- `maskDigits: true` — replace digit runs with a placeholder before comparing text.
- `textIgnoreClasses` — skip text found inside elements carrying these class names, at any ancestor level.

Only visible elements are captured: elements that are `display: none`, `visibility: hidden`, fully transparent, zero-sized, or entirely outside the viewport are skipped.

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
    'product-config',   // output directory
    'product-page',     // output file basename
    'Product Page',     // human-readable name
    { retryDelay: 1000, maxRetryCount: 10, metadata: { url: page.url() } }
  );
});
```

`expectWireframe` captures a stable wireframe (re-sampling until the layout settles), then writes `<outputFile>.json` and `<outputFile>.png` into the resolved output directory. It returns:

```js
{
  wireframeOutput,  // the JSON object that was written
  screenshotPath,   // absolute path of the PNG
  outputDir         // resolved output directory
}
```

### Wireframe JSON shape

```json
{
  "name": "Product Page",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "scrollPosition": { "x": 0, "y": 0 },
  "screenshotScrollPosition": { "x": 0, "y": 0 },
  "elementGroups": [
    {
      "selector": ".product-title",
      "type": "text",
      "strictPosition": true,
      "elements": [
        {
          "index": 0,
          "type": "text",
          "boundingRect": { "top": 120, "left": 32, "bottom": 148, "right": 420 },
          "texts": [
            {
              "text": "Example Item",
              "boundingRect": { "top": 120, "left": 32, "bottom": 148, "right": 260 }
            }
          ]
        }
      ]
    }
  ]
}
```

Anything passed as `options.metadata` is merged into the top level of this object.

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

- `expectWireframe(page, elementGroups, outputDir, outputFile, outputName, options?)` — capture a stable wireframe and write JSON + screenshot.
  - `options.retryDelay` (default `1000`) — minimum milliseconds between stability samples.
  - `options.maxRetryCount` (default `10`) — maximum number of extraction attempts.
  - `options.metadata` (default `{}`) — extra fields merged into the written JSON.
- `getRGBHistogramFromBuffer(buffer)` — compute a 48-bin RGB histogram (16 bins per channel, values normalized to percentages) from an image buffer.

### Wireframe comparison

- `compareWireframes(baselineWireframe, currentWireframe)` — diff two wireframes and annotate the current one with `differences`.
- `compareElements(baselineElement, currentElement, strictPosition?, maskDigits?)`
- `compareTexts(baselineTexts, currentTexts, strictPosition?, maskDigits?)`
- `compareBoundingBoxes(baselineRect, currentRect, tolerance?, strictPosition?)`
- `createPairings(currentElements, baselineElements)` — nearest bounding-box matching between two element sets, returning `{ matchedPairs, unmatchedCurrent, unmatchedBaseline }`.
- `histogramDiff(a, b)` — sum of absolute differences between two histograms.

### Stability

- `areWireframesStable(previousWireframeData, currentWireframeData)` — determine whether two consecutive captures are stable enough to trust.

## How it works

1. **Wireframe extraction** — `flexysnap` walks the DOM in the browser, collecting bounding boxes for each matched visible element and text nodes for `text` groups. For `image` groups it tags the element, waits for its images to finish loading, screenshots it, and computes an RGB histogram with `canvas`. Tagging attributes are removed and the original scroll position is restored afterwards.
2. **Stability loop** — the wireframe is captured repeatedly until consecutive captures are stable. Each attempt waits out the remainder of `retryDelay`, so slow pages aren't penalized twice. This defeats lazy loading and animation flakiness.
3. **Baseline comparison** — element groups from the current run are paired with the baseline using nearest bounding-box matching. Each pair is diffed for layout shifts, text mismatches, and histogram (image) differences. Unmatched elements are reported as extra or missing.

Comparison tolerances: bounding boxes allow up to 10px of drift on any edge, and image histograms allow a total absolute difference of 15.

## Output paths

The `outputDir` argument is resolved by `resolveWireframeOutputDir`, which namespaces wireframes by environment variables so the same tests can run across devices and user roles:

| Variable      | Example      | Purpose                          |
|---------------|--------------|----------------------------------|
| `TEST_TYPE`   | `smoke`      | Top-level test grouping          |
| `DEVICE_TYPE` | `mobile`     | Device / viewport identifier     |
| `USER_TYPE`   | `guest`      | User role identifier             |

```
wireframes/test/<TEST_TYPE>/<outputDir>/<DEVICE_TYPE>/<USER_TYPE>/
```

## Comparing against a baseline

Use `compareWireframes` in your own Playwright spec to diff a captured wireframe against a stored baseline. It pairs each element group's elements with the baseline using nearest bounding-box matching, then annotates the current wireframe's elements and texts with a `differences` array. Elements and texts without differences are left with `differences` undefined, so an unchanged page produces a clean wireframe.

```js
import fs from 'fs';
import { compareWireframes } from 'flexysnap';

const baselineWireframe = JSON.parse(fs.readFileSync('baseline/product-page.json', 'utf8'));
const currentWireframe = JSON.parse(fs.readFileSync('current/product-page.json', 'utf8'));

const annotated = compareWireframes(baselineWireframe, currentWireframe);
```

Elements missing from the current capture are appended to the current element group so they still appear in annotated output, marked as `missing_element` (or `missing_text`).

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
