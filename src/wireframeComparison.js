import { expect } from '@playwright/test';

function histogramDiff(a, b) {
    return a.reduce((sum, val, i) => sum + Math.abs(val - b[i]), 0);
}

function calculateBoundingBoxDistance(rect1, rect2) {
    return Math.max(Math.abs(rect1.left - rect2.left),
        Math.abs(rect1.right - rect2.right),
        Math.abs(rect1.top - rect2.top),
        Math.abs(rect1.bottom - rect2.bottom));
}

function pairByBoundingBox(currentIndices, baselineIndices, currentElements, baselineElements) {
    const pairings = [];

    for (const currentIndex of currentIndices) {
        for (const baselineIndex of baselineIndices) {
            const distance = calculateBoundingBoxDistance(
                currentElements[currentIndex].boundingRect,
                baselineElements[baselineIndex].boundingRect
            );

            pairings.push({
                currentIndex,
                baselineIndex,
                distance
            });
        }
    }

    pairings.sort((a, b) => a.distance - b.distance);

    const usedCurrentIndices = new Set();
    const usedBaselineIndices = new Set();
    const matchedPairs = [];

    for (const pairing of pairings) {
        if (!usedCurrentIndices.has(pairing.currentIndex) && !usedBaselineIndices.has(pairing.baselineIndex)) {
            usedCurrentIndices.add(pairing.currentIndex);
            usedBaselineIndices.add(pairing.baselineIndex);
            matchedPairs.push(pairing);
        }
    }

    const unmatchedCurrent = [];
    for (const currentIndex of currentIndices) {
        if (!usedCurrentIndices.has(currentIndex)) {
            unmatchedCurrent.push(currentIndex);
        }
    }

    const unmatchedBaseline = [];
    for (const baselineIndex of baselineIndices) {
        if (!usedBaselineIndices.has(baselineIndex)) {
            unmatchedBaseline.push(baselineIndex);
        }
    }

    return {
        matchedPairs,
        unmatchedCurrent,
        unmatchedBaseline
    };
}

function createPairings(currentElements, baselineElements) {
    const currentIndices = currentElements.map((_, index) => index);
    const baselineIndices = baselineElements.map((_, index) => index);

    return pairByBoundingBox(currentIndices, baselineIndices, currentElements, baselineElements);
}

function buildTextIndexMap(texts) {
    const map = new Map();
    texts.forEach((textElement, index) => {
        const key = textElement.text;
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(index);
    });
    return map;
}

function createTextPairings(currentTexts, baselineTexts) {
    const currentTextMap = buildTextIndexMap(currentTexts);
    const baselineTextMap = buildTextIndexMap(baselineTexts);

    const usedCurrentIndices = new Set();
    const usedBaselineIndices = new Set();
    const matchedPairs = [];

    for (const [text, currentIndices] of currentTextMap) {
        const baselineIndices = baselineTextMap.get(text);
        if (currentIndices.length === 1 && baselineIndices && baselineIndices.length === 1) {
            const currentIndex = currentIndices[0];
            const baselineIndex = baselineIndices[0];
            matchedPairs.push({
                currentIndex,
                baselineIndex,
                distance: 0
            });
            usedCurrentIndices.add(currentIndex);
            usedBaselineIndices.add(baselineIndex);
        }
    }

    for (const [text, currentIndices] of currentTextMap) {
        const baselineIndices = baselineTextMap.get(text) || [];
        const remainingCurrentIndices = currentIndices.filter(index => !usedCurrentIndices.has(index));
        const remainingBaselineIndices = baselineIndices.filter(index => !usedBaselineIndices.has(index));

        if (remainingCurrentIndices.length > 0 && remainingBaselineIndices.length > 0) {
            const result = pairByBoundingBox(
                remainingCurrentIndices,
                remainingBaselineIndices,
                currentTexts,
                baselineTexts
            );

            for (const pairing of result.matchedPairs) {
                matchedPairs.push(pairing);
                usedCurrentIndices.add(pairing.currentIndex);
                usedBaselineIndices.add(pairing.baselineIndex);
            }
        }
    }

    const remainingCurrentIndices = [];
    for (let i = 0; i < currentTexts.length; i++) {
        if (!usedCurrentIndices.has(i)) {
            remainingCurrentIndices.push(i);
        }
    }

    const remainingBaselineIndices = [];
    for (let i = 0; i < baselineTexts.length; i++) {
        if (!usedBaselineIndices.has(i)) {
            remainingBaselineIndices.push(i);
        }
    }

    if (remainingCurrentIndices.length > 0 && remainingBaselineIndices.length > 0) {
        const result = pairByBoundingBox(
            remainingCurrentIndices,
            remainingBaselineIndices,
            currentTexts,
            baselineTexts
        );

        for (const pairing of result.matchedPairs) {
            matchedPairs.push(pairing);
            usedCurrentIndices.add(pairing.currentIndex);
            usedBaselineIndices.add(pairing.baselineIndex);
        }
    }

    const unmatchedCurrent = [];
    for (let i = 0; i < currentTexts.length; i++) {
        if (!usedCurrentIndices.has(i)) {
            unmatchedCurrent.push(i);
        }
    }

    const unmatchedBaseline = [];
    for (let i = 0; i < baselineTexts.length; i++) {
        if (!usedBaselineIndices.has(i)) {
            unmatchedBaseline.push(i);
        }
    }

    return {
        matchedPairs,
        unmatchedCurrent,
        unmatchedBaseline
    };
}

function compareBoundingBoxes(baselineRect, currentRect, options) {
    const differences = [];
    const strictPosition = options?.strictPosition !== false;
    const strictSize = options?.strictSize !== false;
    if (strictPosition) {
        const boundingBoxDifference = calculateBoundingBoxDistance(baselineRect, currentRect)
        if (boundingBoxDifference > 10) {
            differences.push({
                type: "layout_shift",
                difference: boundingBoxDifference
            });
        }
    } else {
        const baselineWidth = baselineRect.right - baselineRect.left;
        const baselineHeight = baselineRect.bottom - baselineRect.top;
        const currentWidth = currentRect.right - currentRect.left;
        const currentHeight = currentRect.bottom - currentRect.top;
        if (strictSize) {
            const sizeDiff = Math.max(
                Math.abs(baselineWidth - currentWidth),
                Math.abs(baselineHeight - currentHeight)
            );
            if (sizeDiff > 10) {
                differences.push({
                    type: "size_mismatch",
                    difference: sizeDiff
                });
            }
        } else {
            const diffRatio = (baselineWidth * baselineHeight) / (currentWidth * currentHeight)
            if (diffRatio > 1.1 || diffRatio < 0.9) {
                differences.push({
                    type: "size_mismatch",
                    difference: diffRatio
                });
            }

        }
    }
    
    return differences;
}

function replaceDigitsWithPlaceholder(text) {
    return text.replace(/\d+/g, '[digits]');
}

function compareTexts(baselineTexts, currentTexts, options) {
    const {matchedPairs, unmatchedCurrent, unmatchedBaseline} = createTextPairings(currentTexts, baselineTexts);

    for (const pairing of matchedPairs) {
        const baselineText = baselineTexts[pairing.baselineIndex];
        const currentText = currentTexts[pairing.currentIndex];
        currentText.differences = [];

        const maskDigits = options?.maskDigits === true;
        let textsEqual = false
        if (maskDigits) {
            textsEqual = replaceDigitsWithPlaceholder(baselineText.text) !== replaceDigitsWithPlaceholder(currentText.text);
        } else {
            textsEqual = baselineText.text !== currentText.text;
        }

        if (textsEqual) {
            currentText.differences.push({
                type: 'text_mismatch',
                baseline: baselineText.text,
                current: currentText.text,
            });
        } else {
            const boundingBoxDifferences = compareBoundingBoxes(
                baselineText.boundingRect,
                currentText.boundingRect,
                options
            );
            currentText.differences = currentText.differences.concat(boundingBoxDifferences);
        }
    }

    if (options?.allowExtra !== true)
        for (const currentIndex of unmatchedCurrent) {
            const currentText = currentTexts[currentIndex];
            currentText.differences = [{
                type: 'extra_text',
            }];
        }

    if (options.allowMissing !== true)
        for (const baselineIndex of unmatchedBaseline) {
            const baselineText = baselineTexts[baselineIndex];
            currentTexts.push(baselineText);
            baselineText.differences = [{
                type: 'missing_text',
            }];
        }

    for (const currentText of currentTexts) {
        if (currentText.differences?.length === 0) {
            currentText.differences = undefined
        }
    }
}

function compareElements(baselineElement, currentElement, options) {
    if (baselineElement.histogram && currentElement.histogram) {
        const dh = histogramDiff(baselineElement.histogram, currentElement.histogram);
        if (dh > 15) {
            currentElement.differences.push({
                type: 'histogram_difference',
            });
        }
    }
    
    if (baselineElement.texts.length > 0 || currentElement.texts.length > 0) {
        compareTexts(baselineElement.texts, currentElement.texts, options);
    } else {
        currentElement.differences = compareBoundingBoxes(
            baselineElement.boundingRect,
            currentElement.boundingRect,
            options
        );
    }
}

function compareWireframes(baselineWireframe, currentWireframe) {
    const maxSelectorCount = Math.max(
        baselineWireframe.elementGroups.length,
        currentWireframe.elementGroups.length
    );
    expect(currentWireframe.elementGroups.length, 'Number of element groups in the layout should be the same.').toEqual(baselineWireframe.elementGroups.length);
    
    for (let i = 0; i < maxSelectorCount; i++) {
        const baselineElementGroup = baselineWireframe.elementGroups[i];
        const currentElementGroup = currentWireframe.elementGroups[i];

        expect(baselineElementGroup.selector).toEqual(currentElementGroup.selector);

        const {matchedPairs, unmatchedCurrent, unmatchedBaseline} = createPairings(
            currentElementGroup.elements,
            baselineElementGroup.elements
        );

        for (const pairing of matchedPairs) {
            const baselineElement = baselineElementGroup.elements[pairing.baselineIndex];
            const currentElement = currentElementGroup.elements[pairing.currentIndex];
            compareElements(baselineElement, currentElement, currentElementGroup.options);
            if (currentElement.differences?.length === 0) {
                currentElement.differences = undefined
            }
        }

        if (currentElementGroup.options?.allowExtra !== true)
            for (const currentIndex of unmatchedCurrent) {
                const currentElement = currentElementGroup.elements[currentIndex];
                currentElement.differences = [{
                    type: 'extra_element',
                }];
            }

        if (currentElementGroup.options?.allowMissing !== true)
            for (const baselineIndex of unmatchedBaseline) {
                const baselineElement = baselineElementGroup.elements[baselineIndex];
                currentElementGroup.elements.push(baselineElement);
                baselineElement.differences = [{
                    type: 'missing_element',
                }];
            }
    }

    return currentWireframe;
}

export { compareWireframes };