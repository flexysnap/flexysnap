//src/wireframeComparison.js
import { expect } from '@playwright/test';
import { findAlternativeIndices } from './wireframeTextAlternatives.js';

function histogramDiff(a, b) {
    return a.reduce((sum, val, i) => sum + Math.abs(val - b[i]), 0);
}

function calculateBoundingBoxDistance(rect1, rect2) {
    return Math.max(Math.abs(rect1.left - rect2.left),
        Math.abs(rect1.right - rect2.right),
        Math.abs(rect1.top - rect2.top),
        Math.abs(rect1.bottom - rect2.bottom));
}

function indicesOf(items) {
    return items.map((_, index) => index);
}

function filterUnusedIndices(indices, usedIndices) {
    return indices.filter(index => !usedIndices.has(index));
}

function clearEmptyDifferences(entry) {
    if (entry.differences?.length === 0) {
        entry.differences = undefined;
    }
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

    return {
        matchedPairs,
        unmatchedCurrent: filterUnusedIndices(currentIndices, usedCurrentIndices),
        unmatchedBaseline: filterUnusedIndices(baselineIndices, usedBaselineIndices)
    };
}

function createPairings(currentElements, baselineElements) {
    return pairByBoundingBox(indicesOf(currentElements), indicesOf(baselineElements), currentElements, baselineElements);
}

function markAlternativesUsed(texts, index, usedIndices) {
    for (const alternativeIndex of findAlternativeIndices(texts, index)) {
        usedIndices.add(alternativeIndex);
    }
}

function buildTextIndexMap(texts) {
    const map = new Map();
    texts.forEach((_, index) => {
        for (const alternativeIndex of findAlternativeIndices(texts, index)) {
            const key = texts[alternativeIndex].text;
            if (!map.has(key)) {
                map.set(key, []);
            }
            const indices = map.get(key);
            if (!indices.includes(index)) {
                indices.push(index);
            }
        }
    });
    return map;
}

function createTextPairings(currentTexts, baselineTexts) {
    const currentTextMap = buildTextIndexMap(currentTexts);
    const baselineTextMap = buildTextIndexMap(baselineTexts);

    const usedCurrentIndices = new Set();
    const usedBaselineIndices = new Set();
    const matchedPairs = [];

    function pairUnusedTexts(currentIndices, baselineIndices) {
        const result = pairByBoundingBox(currentIndices, baselineIndices, currentTexts, baselineTexts);

        for (const pairing of result.matchedPairs) {
            matchedPairs.push(pairing);
            markAlternativesUsed(currentTexts, pairing.currentIndex, usedCurrentIndices);
            markAlternativesUsed(baselineTexts, pairing.baselineIndex, usedBaselineIndices);
        }
    }

    for (const [text, currentIndices] of currentTextMap) {
        const baselineIndices = baselineTextMap.get(text);
        if (currentIndices.length === 1 && baselineIndices && baselineIndices.length === 1
            && !usedCurrentIndices.has(currentIndices[0]) && !usedBaselineIndices.has(baselineIndices[0])) {
            const currentIndex = currentIndices[0];
            const baselineIndex = baselineIndices[0];
            matchedPairs.push({
                currentIndex,
                baselineIndex,
                distance: 0
            });
            markAlternativesUsed(currentTexts, currentIndex, usedCurrentIndices);
            markAlternativesUsed(baselineTexts, baselineIndex, usedBaselineIndices);
        }
    }

    for (const [text, currentIndices] of currentTextMap) {
        const baselineIndices = baselineTextMap.get(text) || [];
        const remainingCurrentIndices = filterUnusedIndices(currentIndices, usedCurrentIndices);
        const remainingBaselineIndices = filterUnusedIndices(baselineIndices, usedBaselineIndices);

        pairUnusedTexts(remainingCurrentIndices, remainingBaselineIndices);
    }

    pairUnusedTexts(
        filterUnusedIndices(indicesOf(currentTexts), usedCurrentIndices),
        filterUnusedIndices(indicesOf(baselineTexts), usedBaselineIndices)
    );

    return {
        matchedPairs,
        unmatchedCurrent: filterUnusedIndices(indicesOf(currentTexts), usedCurrentIndices),
        unmatchedBaseline: filterUnusedIndices(indicesOf(baselineTexts), usedBaselineIndices)
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
                kind: 'error',
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
                    kind: 'error',
                    difference: sizeDiff
                });
            }
        } else {
            const diffRatio = (baselineWidth * baselineHeight) / (currentWidth * currentHeight)
            if (diffRatio > 1.1 || diffRatio < 0.9) {
                differences.push({
                    type: "size_mismatch",
                    kind: 'note',
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

function isTextInsideViewport(boundingRect, viewport) {
    if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) {
        return true;
    }

    return boundingRect.left >= 0 &&
        boundingRect.right <= viewport.width &&
        boundingRect.top >= 0 &&
        boundingRect.bottom <= viewport.height;
}

function matchesAnyAlternativeText(baselineTexts, baselineIndex, currentText, maskDigits) {
    const normalize = (text) => maskDigits ? replaceDigitsWithPlaceholder(text) : text;
    const normalizedCurrentText = normalize(currentText);

    return findAlternativeIndices(baselineTexts, baselineIndex).some(
        index => normalize(baselineTexts[index].text) === normalizedCurrentText
    );
}

function compareTexts(baselineTexts, currentTexts, options, baselineViewport, currentViewport) {
    const {matchedPairs, unmatchedCurrent, unmatchedBaseline} = createTextPairings(currentTexts, baselineTexts);

    for (const pairing of matchedPairs) {
        const baselineText = baselineTexts[pairing.baselineIndex];
        const currentText = currentTexts[pairing.currentIndex];
        currentText.differences = [];

        const maskDigits = options?.maskDigits === true;
        // Alternatives are interchangeable, so one matching alternative is enough.
        const textsDiffer = !matchesAnyAlternativeText(baselineTexts, pairing.baselineIndex, currentText.text, maskDigits);

        if (textsDiffer) {
            currentText.differences.push({
                type: 'text_mismatch',
                kind: 'error',
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

    const allowExtraText = options?.extraAllowed === true;
    for (const currentIndex of unmatchedCurrent) {
        const currentText = currentTexts[currentIndex];
        const isOutsideViewport = !isTextInsideViewport(currentText.boundingRect, currentViewport);
        currentText.differences = [{
            type: 'extra_text',
            kind: allowExtraText || isOutsideViewport ? 'note' : 'error',
        }];
    }

    const allowMissingText = options?.missingAllowed === true;
    for (const baselineIndex of unmatchedBaseline) {
        const baselineText = baselineTexts[baselineIndex];
        const isOutsideViewport = !isTextInsideViewport(baselineText.boundingRect, baselineViewport);
        currentTexts.push(baselineText);
        baselineText.differences = [{
            type: 'missing_text',
            kind: allowMissingText || isOutsideViewport ? 'note' : 'error',
        }];
    }

    for (const currentText of currentTexts) {
        clearEmptyDifferences(currentText);
    }
}

function compareElements(baselineElement, currentElement, options, baselineViewport, currentViewport) {
    currentElement.differences = currentElement.differences || [];

    if (baselineElement.histogram && currentElement.histogram) {
        const dh = histogramDiff(baselineElement.histogram, currentElement.histogram);
        if (dh > 15) {
            currentElement.differences.push({
                type: 'histogram_difference',
                kind: 'error',
            });
        }
    }
    
    if (baselineElement.texts.length > 0 || currentElement.texts.length > 0) {
        compareTexts(baselineElement.texts, currentElement.texts, options, baselineViewport, currentViewport);
    } else {
        currentElement.differences = currentElement.differences.concat(compareBoundingBoxes(
            baselineElement.boundingRect,
            currentElement.boundingRect,
            options
        ));
    }
}

function compareWireframes(baselineWireframe, currentWireframe) {
    const maxSelectorCount = Math.max(
        baselineWireframe.elementGroups.length,
        currentWireframe.elementGroups.length
    );
    expect(currentWireframe.elementGroups.length, 'Number of element groups in the layout should be the same.').toEqual(baselineWireframe.elementGroups.length);

    const baselineViewport = baselineWireframe.viewport || currentWireframe.viewport;
    const currentViewport = currentWireframe.viewport || baselineWireframe.viewport;
    
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
            compareElements(
                baselineElement,
                currentElement,
                currentElementGroup.options,
                baselineViewport,
                currentViewport
            );
            clearEmptyDifferences(currentElement);
        }

        const allowExtraElements = currentElementGroup.options?.extraAllowed === true;
        for (const currentIndex of unmatchedCurrent) {
            const currentElement = currentElementGroup.elements[currentIndex];
            currentElement.differences = [{
                type: 'extra_element',
                kind: allowExtraElements ? 'note' : 'error',
            }];
        }

        const allowMissingElements = currentElementGroup.options?.missingAllowed === true;
        for (const baselineIndex of unmatchedBaseline) {
            const baselineElement = baselineElementGroup.elements[baselineIndex];
            currentElementGroup.elements.push(baselineElement);
            baselineElement.differences = [{
                type: 'missing_element',
                kind: allowMissingElements ? 'note' : 'error',
            }];
        }
    }

    return currentWireframe;
}

export { compareWireframes };