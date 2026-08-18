
import { logTimestamp } from './testUtils.js';

function collectTexts(wireframeData) {
    const texts = [];
    for (const elementGroup of wireframeData) {
        for (const element of elementGroup.elements || []) {
            for (const textEntry of element.texts || []) {
                texts.push(textEntry.text);
            }
        }
    }
    return texts;
}

function countTextDifferences(previousWireframeData, currentWireframeData) {
    const previousTexts = collectTexts(previousWireframeData);
    const currentTexts = collectTexts(currentWireframeData);

    const previousCounts = new Map();
    for (const text of previousTexts) {
        previousCounts.set(text, (previousCounts.get(text) || 0) + 1);
    }

    const currentCounts = new Map();
    for (const text of currentTexts) {
        currentCounts.set(text, (currentCounts.get(text) || 0) + 1);
    }

    const allTexts = new Set([...previousCounts.keys(), ...currentCounts.keys()]);

    let differenceCount = 0;
    for (const text of allTexts) {
        const previousCount = previousCounts.get(text) || 0;
        const currentCount = currentCounts.get(text) || 0;
        differenceCount += Math.abs(previousCount - currentCount);
    }

    return differenceCount;
}

function findGroupsWithDifferentElementCount(previousWireframeData, currentWireframeData) {
    const groupsWithDifference = [];

    const groupCount = Math.max(previousWireframeData.length, currentWireframeData.length);
    for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
        const previousGroup = previousWireframeData[groupIndex];
        const currentGroup = currentWireframeData[groupIndex];

        const previousElementCount = (previousGroup && previousGroup.elements) ? previousGroup.elements.length : 0;
        const currentElementCount = (currentGroup && currentGroup.elements) ? currentGroup.elements.length : 0;

        if (previousElementCount !== currentElementCount) {
            const groupSelector = (currentGroup && currentGroup.selector) ||
                (previousGroup && previousGroup.selector) ||
                `index ${groupIndex}`;
            groupsWithDifference.push({
                groupIndex: groupIndex,
                selector: groupSelector,
                previousElementCount: previousElementCount,
                currentElementCount: currentElementCount
            });
        }
    }

    return groupsWithDifference;
}

function findEmptyGroups(wireframeData) {
    const emptyGroups = [];

    for (let groupIndex = 0; groupIndex < wireframeData.length; groupIndex++) {
        const group = wireframeData[groupIndex];
        const elementCount = (group && group.elements) ? group.elements.length : 0;

        if (elementCount < 1) {
            const groupSelector = (group && group.selector) || `index ${groupIndex}`;
            emptyGroups.push({
                groupIndex: groupIndex,
                selector: groupSelector
            });
        }
    }

    return emptyGroups;
}

function getBoundingRectSize(boundingRect) {
    const width = boundingRect.right - boundingRect.left;
    const height = boundingRect.bottom - boundingRect.top;
    return width * height;
}

function sumBoundingBoxSizeDifference(previousWireframeData, currentWireframeData) {
    let totalSizeDifference = 0;

    for (let groupIndex = 0; groupIndex < previousWireframeData.length; groupIndex++) {
        const previousElements = previousWireframeData[groupIndex].elements || [];
        const currentElements = currentWireframeData[groupIndex].elements || [];

        for (let elementIndex = 0; elementIndex < previousElements.length; elementIndex++) {
            const previousSize = getBoundingRectSize(previousElements[elementIndex].boundingRect);
            const currentSize = getBoundingRectSize(currentElements[elementIndex].boundingRect);
            totalSizeDifference += Math.abs(previousSize - currentSize);
        }
    }

    return totalSizeDifference;
}

function sumBoundingBoxSize(wireframeData) {
    let totalSize = 0;

    for (const elementGroup of wireframeData) {
        for (const element of elementGroup.elements || []) {
            totalSize += getBoundingRectSize(element.boundingRect);
        }
    }

    return totalSize;
}

function areWireframesStable(previousWireframeData, currentWireframeData) {
    const emptyGroups = findEmptyGroups(currentWireframeData);

    if (emptyGroups.length > 0) {
        for (const group of emptyGroups) {
            logTimestamp(`Wireframe group '${group.selector}' has no elements.`);
        }
        return false;
    }

    const groupsWithDifferentElementCount = findGroupsWithDifferentElementCount(previousWireframeData, currentWireframeData);

    if (groupsWithDifferentElementCount.length > 0) {
        for (const group of groupsWithDifferentElementCount) {
            logTimestamp(`Wireframe element count mismatch in group '${group.selector}' - previous: ${group.previousElementCount} current: ${group.currentElementCount}.`);
        }
        return false;
    }

    const textDifferences = countTextDifferences(previousWireframeData, currentWireframeData);

    if (textDifferences !== 0) {
        logTimestamp(`Wireframe text differences: ${textDifferences}`)
        return false;
    }

    const sizeDifference = sumBoundingBoxSizeDifference(previousWireframeData, currentWireframeData);
    const previousTotalSize = sumBoundingBoxSize(previousWireframeData);
    const allowedSizeDifference = previousTotalSize * 0.03;

    logTimestamp(`Wireframe bounding box size difference: ${sizeDifference} (allowed: ${allowedSizeDifference}).`)
    return sizeDifference <= allowedSizeDifference;
}

export { areWireframesStable };