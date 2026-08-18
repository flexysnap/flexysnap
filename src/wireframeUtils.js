import fs from 'fs';
import path from 'path';
import { logTimestamp } from './testUtils.js';
import sharp from 'sharp';
import { areWireframesStable } from "./wireframeStability";

async function getRGBHistogramFromBuffer(buffer) {
    const {data, info} = await sharp(buffer)
        .raw()
        .toBuffer({resolveWithObject: true});

    const histogram = new Array(48).fill(0);
    const pixelCount = info.width * info.height;

    for (let i = 0; i < data.length; i += info.channels) {
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
    const wireframeData = await page.evaluate(async ({elementGroups}) => {

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


        for (const elementGroup of elementGroups) {
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

                elementGroup.elements.push({
                    index: index,
                    boundingRect: createBoundingRect(element),
                    texts: texts,
                    type: elementGroup.type
                });
                index += 1;
            }
        }

        return elementGroups;
    }, {elementGroups});

    const scrollPosition = await page.evaluate(() => ({
        x: window.scrollX,
        y: window.scrollY
    }));

    for (const elementGroup of wireframeData) {
        for (const element of elementGroup.elements) {
            if (element.type === 'image') {
                const locator = page.locator(elementGroup.selector).nth(element.index);
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
            }
        }
    }

    await page.evaluate(({scrollPosition}) => {
        window.scrollTo(scrollPosition.x, scrollPosition.y);
    }, {scrollPosition});
    return wireframeData;
}

function cloneElementGroups(elementGroups) {
    return elementGroups.map(elementGroup => ({...elementGroup, elements: undefined}));
}

async function extractStableWireframe(page, elementGroups, retryDelay, maxRetryCount) {
    let previousWireframeData = null;
    let currentWireframeData = null;

    for (let attempt = 0; attempt < maxRetryCount; attempt++) {
        const extractionStartTime = Date.now();
        currentWireframeData = await extractWireframe(page, cloneElementGroups(elementGroups));
        const extractionDuration = Date.now() - extractionStartTime;
        logTimestamp(`Wireframe candidate captured after ${extractionDuration/1000} seconds.`)

        if (previousWireframeData !== null &&
            areWireframesStable(previousWireframeData, currentWireframeData)) {
            logTimestamp(`Wireframe stabilized after ${attempt + 1} extraction(s)`);
            return currentWireframeData;
        }

        previousWireframeData = currentWireframeData;

        if (attempt < maxRetryCount - 1) {
            const remainingDelay = Math.max(0, retryDelay - extractionDuration);
            if (remainingDelay > 0)
                await delay(remainingDelay);
        }
    }

    logTimestamp(`Wireframe did not stabilize within ${maxRetryCount} extraction(s)`);
    return currentWireframeData;
}

async function expectWireframe(page, elementGroups, configName, outputFile, outputName, retryDelay = 1000, maxRetryCount = 10) {
        logTimestamp(`Starting wireframe capture for: ${outputFile}`);
    const wireframeData = await extractStableWireframe(page, elementGroups, retryDelay, maxRetryCount);

    const userType = process.env.USER_TYPE;
    const deviceType = process.env.DEVICE_TYPE;
    const testType = process.env.TEST_TYPE;

    const wireframeOutput = {
        name: outputName,
        timestamp: new Date().toISOString(),
        deviceType: process.env.DEVICE_TYPE,
        userType: process.env.USER_TYPE,
        elementGroups: wireframeData
    };

    const fileName = `${outputFile}.json`;
    const filePath = path.join(process.cwd(), 'wireframes', 'test', testType, configName, deviceType, userType, fileName);
    const fileDir = path.dirname(filePath);
    fs.mkdirSync(fileDir, {recursive: true});
    fs.writeFileSync(filePath, JSON.stringify(wireframeOutput, null, 2));
    logTimestamp(`Wireframe captured and saved to: ${fileName}`);

    const screenshotPath = path.join(fileDir, `${outputFile}.png`);
    await page.screenshot({ path: screenshotPath });
    logTimestamp(`Wireframe screenshot saved to: ${screenshotPath}`);

    return {wireframeOutput, screenshotPath};
}

export { expectWireframe, getRGBHistogramFromBuffer };