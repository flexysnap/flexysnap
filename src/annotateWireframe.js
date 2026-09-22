import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';

function applyGrayscale(ctx, width, height) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
    }

    ctx.putImageData(imageData, 0, 0);
}

function getScrollOffset(wireframe) {
    const extractionScrollPosition = wireframe.scrollPosition || { x: 0, y: 0 };
    const screenshotScrollPosition = wireframe.screenshotScrollPosition || extractionScrollPosition;

    return {
        offsetX: extractionScrollPosition.x - screenshotScrollPosition.x,
        offsetY: extractionScrollPosition.y - screenshotScrollPosition.y
    };
}

async function annotateWireframeFile(wireframeFile, screenshotFile) {
    if (!fs.existsSync(wireframeFile)) {
        console.error(`Wireframe file not found: ${wireframeFile}`);
        return;
    }

    if (!fs.existsSync(screenshotFile)) {
        console.error(`Screenshot file not found: ${screenshotFile}`);
        return;
    }

    const wireframeContent = fs.readFileSync(wireframeFile, 'utf-8');
    const wireframe = JSON.parse(wireframeContent);

    const screenshot = await loadImage(screenshotFile);
    const width = screenshot.width;
    const height = screenshot.height;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(screenshot, 0, 0);
    applyGrayscale(ctx, width, height);

    const { offsetX, offsetY } = getScrollOffset(wireframe);

    if (offsetX !== 0 || offsetY !== 0) {
        console.log(`Compensating for scroll drift between extraction and screenshot: offsetX=${offsetX}, offsetY=${offsetY}`);
    }

    const colors = {
        box: { fill: 'rgba(220, 160, 40, 0.4)', stroke: '#E6A500' },
        image: { fill: 'rgba(70, 180, 120, 0.4)', stroke: '#2EBC6F' },
        text: { fill: 'rgba(50, 130, 190, 0.4)', stroke: '#0066CC' },
        error: { fill: 'rgba(211, 47, 47, 0.4)', stroke: '#D32F2F' },
        missing: { fill: 'rgba(233, 30, 140, 0.4)', stroke: '#D32F2F' },
        extra: { fill: 'rgba(156, 39, 176, 0.4)', stroke: '#D32F2F' },
        shift: { fill: 'rgba(121, 85, 72, 0.4)', stroke: '#D32F2F' }
    };

    function determineColorKey(obj, defaultKey) {
        if (!obj.differences || !Array.isArray(obj.differences) || obj.differences.length === 0) {
            return defaultKey;
        }

        const differenceTypes = obj.differences.map(difference => difference.type);

        if (differenceTypes.includes('missing_text') || differenceTypes.includes('missing_element')) {
            return 'missing';
        }

        if (differenceTypes.includes('extra_text') || differenceTypes.includes('extra_element')) {
            return 'extra';
        }

        if (differenceTypes.includes('layout_shift') || differenceTypes.includes('size_mismatch')) {
            return 'shift';
        }

        return 'error';
    }

    function drawBoundingBox(rect, colorKey, dashed = false) {
        const adjustedRect = {
            left: rect.left + offsetX,
            right: rect.right + offsetX,
            top: rect.top + offsetY,
            bottom: rect.bottom + offsetY
        };

        const boxWidth = adjustedRect.right - adjustedRect.left;
        const boxHeight = adjustedRect.bottom - adjustedRect.top;
        const color = colors[colorKey];

        ctx.fillStyle = color.fill;
        ctx.fillRect(adjustedRect.left, adjustedRect.top, boxWidth, boxHeight);
        ctx.strokeStyle = color.stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.strokeRect(adjustedRect.left, adjustedRect.top, boxWidth, boxHeight);
        ctx.setLineDash([]);
    }

    for (const elementGroup of wireframe.elementGroups) {
        const dashed = elementGroup.options?.strictPosition === false;

        for (const element of elementGroup.elements) {
            const rect = element.boundingRect;

            if (element.type === 'box') {
                const colorKey = determineColorKey(element, 'box');
                drawBoundingBox(rect, colorKey, dashed);
            } else if (element.type === 'image') {
                const colorKey = determineColorKey(element, 'image');
                drawBoundingBox(rect, colorKey, dashed);
            } else if (element.type === 'text' && element.texts && element.texts.length > 0) {
                for (const text of element.texts) {
                    const colorKey = determineColorKey(text, 'text');
                    drawBoundingBox(text.boundingRect, colorKey, dashed);
                }
            }
        }
    }

    const outputDir = path.dirname(screenshotFile);
    const basename = path.basename(screenshotFile, '.png');
    const outputPath = path.join(outputDir, `${basename}_wireframe.png`);

    fs.writeFileSync(outputPath, canvas.toBuffer('image/png'));

    console.log(`Annotated wireframe saved to: ${outputPath}`);
}

async function processFolder(folderPath) {
    if (!fs.existsSync(folderPath)) {
        console.error(`Folder not found: ${folderPath}`);
        process.exit(1);
    }

    const stats = fs.statSync(folderPath);
    if (!stats.isDirectory()) {
        console.error(`Path is not a directory: ${folderPath}`);
        process.exit(1);
    }

    const files = fs.readdirSync(folderPath);
    const basenames = new Set();

    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (ext === '.json' || ext === '.png') {
            const basename = path.basename(file, ext);
            basenames.add(basename);
        }
    }

    for (const basename of basenames) {
        const jsonFile = path.join(folderPath, `${basename}.json`);
        const pngFile = path.join(folderPath, `${basename}.png`);

        if (fs.existsSync(jsonFile) && fs.existsSync(pngFile)) {
            await annotateWireframeFile(jsonFile, pngFile);
        }
    }
}

export async function runAnnotate(args) {
    if (args.length === 0) {
        console.error('Usage: flexysnap annotate <wireframe.json> <screenshot.png>');
        console.error('   or: flexysnap annotate <folder>');
        process.exit(1);
    }

    if (args.length === 1) {
        await processFolder(args[0]);
    } else if (args.length >= 2) {
        const wireframeFile = args[0];
        const screenshotFile = args[1];
        await annotateWireframeFile(wireframeFile, screenshotFile);
    }
}