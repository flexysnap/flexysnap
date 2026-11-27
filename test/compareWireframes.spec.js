import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compareWireframes } from '../src/wireframeComparison.js';

// The Black Friday campaign copy and loyalty points line are accepted as differences
// from the baseline until the baseline is regenerated.
const ACCEPTED_DIFFERENCES = [
    'section.custom-product-page element 0 text "-20% BLACK FRIDAY AKCIÓ!": extra_text (note)',
    'section.custom-product-page element 0 text "🎉 BLACK FRIDAY AKCIÓ -20% 🎉": extra_text (note)',
    'section.custom-product-page element 0 text "2 392": extra_text (note)',
    'section.custom-product-page element 0 text "Ft": extra_text (note)',
    'section.custom-product-page element 0 text "Rendelés után járó levásárolható hűségpontok:": missing_text (note)',
    'section.custom-product-page element 0 text "598": missing_text (note)',
    'section.custom-product-page element 0 text "Ft": missing_text (note)',
];

function readWireframeFile(fileName) {
    const filePath = fileURLToPath(new URL(fileName, import.meta.url));
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function collectTextDifferenceLines(location, texts) {
    const lines = [];
    for (const text of texts) {
        for (const difference of text.differences ?? []) {
            lines.push(`${location} text "${text.text}": ${difference.type} (${difference.kind})`);
        }
    }
    return lines;
}

function collectElementDifferenceLines(selector, elements) {
    const lines = [];
    for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
        const element = elements[elementIndex];
        const location = `${selector} element ${elementIndex}`;
        for (const difference of element.differences ?? []) {
            lines.push(`${location}: ${difference.type} (${difference.kind})`);
        }
        lines.push(...collectTextDifferenceLines(location, element.texts ?? []));
    }
    return lines;
}

function collectDifferences(comparedWireframe) {
    const lines = [];
    for (const elementGroup of comparedWireframe.elementGroups) {
        lines.push(...collectElementDifferenceLines(elementGroup.selector, elementGroup.elements));
    }
    return lines;
}

test('accessories product wireframe matches its baseline', () => {
    const baselineWireframe = readWireframeFile('accessories_product_baseline.json');
    const currentWireframe = readWireframeFile('accessories_product_test.json');

    const comparedWireframe = compareWireframes(baselineWireframe, currentWireframe);

    expect(collectDifferences(comparedWireframe)).toEqual(ACCEPTED_DIFFERENCES);
});