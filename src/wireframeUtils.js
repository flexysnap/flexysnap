import fs from 'fs';
import path from 'path';
import { logTimestamp } from './testUtils.js';
import { loadImage, createCanvas } from 'canvas';
import { areWireframesStable } from './wireframeStability.js';
import { resolveWireframeOutputDir } from './wireframeOutput.js';

const FLEXYSNAP_ELEMENT_ID_ATTRIBUTE = 'data-flexysnap-id';

async function getRGBHistogramFromBuffer(buffer) {
    const image = await loadImage(buffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    const { data } = ctx.getImageData(0, 0, image.width, image.height);

    const histogram = new Array(48).fill(0);
    const pixelCount = image.width * image.height;

    if (pixelCount === 0) {
        return histogram;
    }

    for (let i = 0; i < data.length; i += 4) {
        histogram[Math.floor(data[i] / 16)]++;
        histogram[Math.floor(data[i + 1] / 16) + 16]++;
        histogram[Math.floor(data[i + 2] / 16) + 32]++;
    }

    for (let i = 0; i < 48; i++) {
        histogram[i] = Math.round((histogram[i] / pixelCount) * 100);
    }

    return histogram;
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function extractWireframe(page, elementGroups) {
    const wireframeData = await page.evaluate(async ({elementGroups, elementIdAttribute}) => {

        function createBoundingRect(element) {
            const rect = element.getBoundingClientRect();
            return {
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                bottom: Math.round(rect.bottom),
                right: Math.round(rect.right)
            };
        }

        function getTextNodeBoundingBox(textNode) {
            const range = document.createRange();
            range.selectNodeContents(textNode);
            const rect = range.getBoundingClientRect();
            return {
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                bottom: Math.round(rect.bottom),
                right: Math.round(rect.right)
            };
        }

        function isElementVisible(element) {
            const style = window.getComputedStyle(element);
            if (style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.opacity === '0' ||
                element.offsetWidth <= 0 ||
                element.offsetHeight <= 0) {
                return false;
            }

            const rect = element.getBoundingClientRect()

            return rect.right >= 0 &&
                rect.left < window.innerWidth &&
                rect.bottom >= 0 &&
                rect.top < window.innerHeight;
        }


        for (let groupIndex = 0; groupIndex < elementGroups.length; groupIndex++) {
            const elementGroup = elementGroups[groupIndex];
            elementGroup.strictPosition = elementGroup.strictPosition !== false;
            elementGroup.elements = [];

            let index = 0;
            const matchedElements = document.querySelectorAll(elementGroup.selector);

            for (const element of matchedElements) {
                if (!isElementVisible(element))
                    continue;


                const texts = [];

                function getElementsWithDirectText(root, textIgnoreClasses) {
                    const results = [];
                    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
                        acceptNode: node =>
                            node.nodeValue.trim()
                                ? NodeFilter.FILTER_ACCEPT
                                : NodeFilter.FILTER_REJECT
                    });

                    while (walker.nextNode()) {
                        if (walker.currentNode.parentElement.classList.contains('screen-reader-text'))
                            continue;

                        if (textIgnoreClasses) {
                            let ignored = false;
                            console.log(textIgnoreClasses);
                            let parent = walker.currentNode.parentElement;
                            while (parent != null && !ignored) {
                                for (const className of parent.classList) {
                                    if (textIgnoreClasses.includes(className)) {
                                        ignored = true;
                                        break;
                                    }
                                }
                                parent = parent.parentElement;
                            }
                            if (ignored)
                                continue;
                        }

                        if (['select', 'option', 'input'].includes(walker.currentNode.parentElement.tagName))
                            continue;

                        if (!results.includes(walker.currentNode)) results.push(walker.currentNode);
                    }

                    return results;
                }

                if (elementGroup.type === 'text') {

                    const descendantArray = getElementsWithDirectText(element, elementGroup.textIgnoreClasses)

                    for (const descendant of descendantArray) {
                        if (!isElementVisible(descendant.parentElement))
                            continue;

                        const text = descendant.textContent.trim().replaceAll(/\s+/g, ' ')
                        if (text.length === 0)
                            continue;

                        const isNested = descendantArray.some(other =>
                            other !== descendant && other.contains(descendant)
                        );

                        if (isNested)
                            continue;

                        texts.push({
                            text: text,
                            boundingRect: getTextNodeBoundingBox(descendant)
                        });
                    }
                }

                const elementData = {
                    index: index,
                    boundingRect: createBoundingRect(element),
                    texts: texts,
                    type: elementGroup.type
                };

                if (elementGroup.type === 'image') {
                    const elementId = `fsnap-g${groupIndex}-e${index}`;
                    element.setAttribute(elementIdAttribute, elementId);
                    elementData.elementId = elementId;
                }

                elementGroup.elements.push(elementData);
                index += 1;
            }
        }

        return elementGroups;
    }, {elementGroups, elementIdAttribute: FLEXYSNAP_ELEMENT_ID_ATTRIBUTE});

    const scrollPosition = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
    }));

    for (const elementGroup of wireframeData) {
        for (const element of elementGroup.elements) {
            if (element.type === 'image' && element.elementId) {
                const locator = page.locator(`[${FLEXYSNAP_ELEMENT_ID_ATTRIBUTE}="${element.elementId}"]`);
                await locator.waitFor({state: 'visible'});

                try {

                    await page.waitForFunction((el) => {
                        const images = Array.from(el.querySelectorAll('img'));
                        if (images.length === 0) return true;
                        return images.every(img => img.complete && img.naturalWidth > 0);
                    }, await locator.elementHandle(), {timeout: 3000});
                } catch {
                    logTimestamp('could not load images for ' + elementGroup.selector)
                }
                try {
                    const screenshot = await locator.screenshot({timeout: 3000});
                    element.histogram = await getRGBHistogramFromBuffer(screenshot);
                } catch {
                    element.type = 'box'
                }

                delete element.elementId;
            }
        }
    }

    await page.evaluate(({scrollPosition, elementIdAttribute}) => {
        for (const el of document.querySelectorAll(`[${elementIdAttribute}]`)) {
            el.removeAttribute(elementIdAttribute);
        }
        window.scrollTo({top: scrollPosition.y, left: scrollPosition.x, behavior: 'instant'});
    }, {scrollPosition, elementIdAttribute: FLEXYSNAP_ELEMENT_ID_ATTRIBUTE});

    try {
        await page.waitForFunction((expectedScrollPosition) => {
            return window.scrollX === expectedScrollPosition.x && window.scrollY === expectedScrollPosition.y;
        }, scrollPosition, {timeout: 2000});
    } catch {
        logTimestamp('Scroll position did not settle back to the extraction position.');
    }

    return {wireframeData, scrollPosition};
}

function cloneElementGroups(elementGroups) {
    return elementGroups.map(elementGroup => ({...elementGroup, elements: undefined}));
}

async function extractStableWireframe(page, elementGroups, retryDelay, maxRetryCount) {
    let previousWireframeData = null;
    let currentWireframeData = null;
    let currentScrollPosition = null;

    for (let attempt = 0; attempt < maxRetryCount; attempt++) {
        const extractionStartTime = Date.now();
        const extractionResult = await extractWireframe(page, cloneElementGroups(elementGroups));
        currentWireframeData = extractionResult.wireframeData;
        currentScrollPosition = extractionResult.scrollPosition;
        const extractionDuration = Date.now() - extractionStartTime;
        logTimestamp(`Wireframe candidate captured after ${extractionDuration/1000} seconds.`)

        if (previousWireframeData !== null &&
            areWireframesStable(previousWireframeData, currentWireframeData)) {
            logTimestamp(`Wireframe stabilized after ${attempt + 1} extraction(s)`);
            return {wireframeData: currentWireframeData, scrollPosition: currentScrollPosition};
        }

        previousWireframeData = currentWireframeData;

        if (attempt < maxRetryCount - 1) {
            const remainingDelay = Math.max(0, retryDelay - extractionDuration);
            if (remainingDelay > 0)
                await delay(remainingDelay);
        }
    }

    logTimestamp(`Wireframe did not stabilize within ${maxRetryCount} extraction(s)`);
    return {wireframeData: currentWireframeData, scrollPosition: currentScrollPosition};
}

async function expectWireframe(page, elementGroups, outputDir, outputFile, outputName, options = {}) {
    const { retryDelay = 1000, maxRetryCount = 10, metadata = {} } = options;

    logTimestamp(`Starting wireframe capture for: ${outputFile}`);
    const { wireframeData, scrollPosition } = await extractStableWireframe(page, elementGroups, retryDelay, maxRetryCount);

    const screenshotScrollPosition = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
    }));

    const wireframeOutput = {
        name: outputName,
        timestamp: new Date().toISOString(),
        scrollPosition,
        screenshotScrollPosition,
        elementGroups: wireframeData,
        ...metadata
    };

    const resolvedDir = resolveWireframeOutputDir(outputDir);
    fs.mkdirSync(resolvedDir, {recursive: true});

    const fileName = `${outputFile}.json`;
    const filePath = path.join(resolvedDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(wireframeOutput, null, 2));
    logTimestamp(`Wireframe captured and saved to: ${fileName}`);

    const screenshotPath = path.join(resolvedDir, `${outputFile}.png`);
    await page.screenshot({ path: screenshotPath });
    logTimestamp(`Wireframe screenshot saved to: ${screenshotPath}`);

    return {wireframeOutput, screenshotPath, outputDir: resolvedDir};
}

export { expectWireframe, getRGBHistogramFromBuffer };