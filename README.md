# flexysnap

Structural wireframe snapshot testing for Playwright — built for e-commerce.

Traditional pixel-diffing tools flag every layout shift as a failure, even a 2px nudge from a font render or a shifting badge. Real webshops also have content that changes on purpose: cross-sell blocks, promo banners, stock counters. `flexysnap` takes a different approach. Instead of comparing raw pixels, it extracts a structural wireframe from the page — bounding boxes, text content, and image color histograms — then compares that wireframe against a baseline. You test what actually matters: is the layout intact, is the text correct, did an image visually change — without drowning in false positives from anti-aliasing noise.

## Why flexysnap

- **Structural diffing** — captures element bounding boxes, text nodes, and image histograms instead of raw pixels, so sub-pixel font rendering and anti-aliasing never fail your suite.
- **Position tolerance** — element groups can set `options.strictPosition: false` to check size only, ignoring exact placement for content that legitimately moves.
- **Digit masking** — digits are masked by default, so counters, prices, and timers don't fail on numeric churn.
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
  { selector: '.cross-sell-carousel', type: 'box', options: { strictPosition: false } },
  { selector: '.price', type: 'text', options: { maskDigits: false } },
  { selector: '.stock-status', type: 'text', textIgnoreClasses: ['screen-reader-text'] }
];
```

Comparison behavior is set in `options`:

- `strictPosition: false` (default `true`) — compare element size only, not exact position.
- `strictSize: false` (default `true`) — for position-tolerant groups, compare size by ratio rather than absolute pixel difference.
- `maskDigits: false` (default `true`) — digit runs are replaced with a placeholder before comparing text. Set to `false` to compare digits literally.
- `extraAllowed: true` (default `false`) — report elements or texts present now but not in baseline as informational notes instead of errors.
- `missingAllowed: true` (default `false`) — report elements or texts present in baseline but not now as informational notes instead of errors.

`textIgnoreClasses` (top level of the group) — skip text found inside elements carrying these class names, at any ancestor level. Text inside elements with the class `screen-reader-text`, and text inside `select`, `option` and `input` elements, is always skipped.

Only visible elements are captured: elements that are `display: none`, `visibility: hidden`, fully transparent, zero-sized, or entirely outside the viewport are skipped.

## Quick start

### Capturing a wireframe

```js
import { test } from '@playwright/test';
import { expectWireframe, setWireframeFolders } from 'flexysnap';

setWireframeFolders({
  currentFolder: 'wireframes/current',
  baselineFolder: 'wireframes/baseline'
});

const elementGroups = [
  { selector: '.hero-banner', type: 'image' },
  { selector: '.product-title', type: 'text' },
  { selector: '.cross-sell-carousel', type: 'box', options: { strictPosition: false } }
];

test('product page wireframe', async ({ page }) => {
  await page.goto('https://example-shop.com/products/example-item');

  await expectWireframe(
    page,
    elementGroups,
    'product-page',     // output file basename
    'Product Page',     // human-readable name
    { retryDelay: 1000, maxRetryCount: 10, metadata: { url: page.url() } }
  );
});
```

`expectWireframe` captures a stable wireframe (re-sampling until the layout settles), then writes `<outputFile>.json` and `<outputFile>.png` into the output folder chosen by `setWireframeFolders`. It returns:

```js
{
  wireframeOutput,  // the JSON object that was written
  screenshotPath,   // absolute path of the PNG
  outputDir         // folder the files were written to
}
```

### Wireframe JSON shape

```json
{
  "name": "Product Page",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "scrollPosition": { "x": 0, "y": 0 },
  "screenshotScrollPosition": { "x": 0, "y": 0 },
  "viewport": { "width": 1280, "height": 800 },
  "deviceScaleFactor": 1,
  "elementGroups": [
    {
      "selector": ".product-title",
      "type": "text",
      "options": {
        "strictPosition": true,
        "strictSize": true,
        "maskDigits": true,
        "extraAllowed": false,
        "missingAllowed": false
      },
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

Image elements carry a `histogram` array instead of a `texts` entry. Anything passed as `options.metadata` is merged into the top level of this object.

## API

`flexysnap` exports the following from its main entry point:

### Test utilities

- `waitForCompleteLoad(page)` — wait for `domcontentloaded` and `load`, with a timeout.
- `navigate(page, url)` — navigate to a URL and wait for `domcontentloaded` and `load`. Throws if the response status is 400 or higher.
- `click(page, locator)` — resilient click that closes popups, re-hovers, scrolls into view, and retries.
- `highlightedClick(page, locator)` — scroll a locator into the viewport and force-click it.
- `hover(page, locator)` — hover a locator and remember it for re-hovering.
- `rehover(page)` — re-hover the last hovered locator.
- `fill(page, field, value)` — click and fill an input by name or locator.
- `selectOption(page, field, value)` — click and select an option by label or locator.
- `scrollToTopOfElement(page, target, offset?)` — scroll so a locator (or selector string) is positioned near the top of the viewport, minus an optional offset in pixels.
- `setClosePopups(fn)` — register a function used to dismiss popups before interactions and before each element group extraction.
- `setBaseUrl(url)` — set the base URL whose document, XHR and fetch requests are cache-busted.
- `setCacheableUrlPattern(pattern)` — add a URL path pattern that is never cache-busted, in addition to `/wp-content/` and `/wp-includes/`.
- `logTimestamp(eventName)` — log an event with elapsed time since test start.

### Wireframe capture

- `expectWireframe(page, elementGroups, outputFile, outputName, options?)` — capture a stable wireframe and write JSON + screenshot to the folder set by `setWireframeFolders`.
  - `options.retryDelay` (default `1000`) — minimum milliseconds between stability samples.
  - `options.maxRetryCount` (default `10`) — maximum number of extraction attempts.
  - `options.metadata` (default `{}`) — extra fields merged into the written JSON.
- `getRGBHistogramFromBuffer(buffer)` — compute a 48-bin RGB histogram (16 bins per channel, values normalized to percentages) from an image buffer.

### Wireframe comparison

- `compareWireframes(baselineWireframe, currentWireframe)` — diff two wireframes and return the current wireframe annotated with `differences`. Element groups are matched by index and must appear in the same order and count in both wireframes. Within each group, elements are paired with the baseline using nearest bounding-box matching, then diffed for layout shifts, size mismatches, text mismatches, and image histogram differences. Elements missing from the current capture are appended to the current wireframe's element groups so they still appear in the output, marked as `missing_element` (or `missing_text`).

### Stability

- `areWireframesStable(previousWireframeData, currentWireframeData)` — determine whether two consecutive captures are stable enough to trust, by checking for empty element groups, mismatched element counts, text content differences, and overall bounding-box size drift.

### Output folders

- `setWireframeFolders({ currentFolder, baselineFolder })` — set the folders wireframes are written to. Both must be non-empty strings; relative paths are resolved against the current working directory. Throws if either is missing.

## How it works

1. **Wireframe extraction** — `flexysnap` walks the DOM in the browser, collecting bounding boxes for each matched visible element and text nodes for `text` groups. For `image` groups it tags the element, waits for its images to finish loading, screenshots it, and computes an RGB histogram with `canvas`. Tagging attributes are removed and the original scroll position is restored afterwards.
2. **Stability loop** — the wireframe is captured repeatedly until consecutive captures are stable. Each attempt waits out the remainder of `retryDelay`, so slow pages aren't penalized twice. This defeats lazy loading and animation flakiness.
3. **Baseline comparison** — element groups from the current run are paired with the baseline using nearest bounding-box matching. Each pair is diffed for layout shifts, text mismatches, and histogram (image) differences. Unmatched elements are reported as extra or missing.

Comparison tolerances: bounding boxes allow up to 10px of drift on any edge, and image histograms allow a total absolute difference of 15.

## Output paths

`expectWireframe` writes to one of the two folders configured with `setWireframeFolders`:

- If `<baselineFolder>/<outputFile>.json` does not exist yet, the wireframe and screenshot are written to `baselineFolder`. This is how a new baseline is created.
- Otherwise they are written to `currentFolder`, so the stored baseline is left untouched and can be compared against.

```js
setWireframeFolders({
  currentFolder: 'wireframes/current',
  baselineFolder: 'wireframes/baseline'
});
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

Each difference has a `kind`. `error` marks a failing difference. `note` marks an informational one, such as an extra or missing element allowed by `extraAllowed` or `missingAllowed`, or a size ratio change in a position-tolerant group with `strictSize: false`.

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
flexysnap annotate ./wireframes/current/product-page
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