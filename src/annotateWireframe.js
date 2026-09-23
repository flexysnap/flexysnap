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
        error: { fill: 'rgba(211, 47, 47, 0.4)', stroke: '#D32F2F' }
    };

    function determineColorKey(obj, defaultKey) {
        if (!obj.differences || !Array.isArray(obj.differences) || obj.differences.length === 0) {
            return defaultKey;
        }

        const hasError = obj.differences.some(difference => difference.kind === 'error');

        return hasError ? 'error' : defaultKey;
    }

    function hasDifferenceType(differences, types) {
        if (!differences || !Array.isArray(differences) || differences.length === 0) {
            return false;
        }

        return differences.some(difference => types.includes(difference.type));
    }

    function getLineDash(differences) {
        const hasLayoutShift = hasDifferenceType(differences, ['layout_shift']);
        const hasSizeMismatch = hasDifferenceType(differences, ['size_mismatch']);

        if (hasLayoutShift && hasSizeMismatch) {
            return [6, 2, 1, 2];
        }

        if (hasLayoutShift) {
            return [6, 4];
        }

        if (hasSizeMismatch) {
            return [2, 2];
        }

        return [];
    }

    function drawHatchedFill(rect, width, height, fillColor) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.left, rect.top, width, height);
        ctx.clip();

        ctx.strokeStyle = fillColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        const spacing = 6;
        const diagonalReach = width + height;

        for (let offset = -height; offset < diagonalReach; offset += spacing) {
            ctx.beginPath();
            ctx.moveTo(rect.left + offset, rect.top);
            ctx.lineTo(rect.left + offset + height, rect.top + height);
            ctx.stroke();
        }

        ctx.restore();
    }

    function drawDiagonalCross(rect, strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(rect.left, rect.top);
        ctx.lineTo(rect.right, rect.bottom);
        ctx.moveTo(rect.right, rect.top);
        ctx.lineTo(rect.left, rect.bottom);
        ctx.stroke();
    }

    function drawUprightCross(rect, strokeColor) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);

        const midX = (rect.left + rect.right) / 2;
        const midY = (rect.top + rect.bottom) / 2;

        ctx.beginPath();
        ctx.moveTo(midX, rect.top);
        ctx.lineTo(midX, rect.bottom);
        ctx.moveTo(rect.left, midY);
        ctx.lineTo(rect.right, midY);
        ctx.stroke();
    }

    function drawBoundingBox(rect, colorKey, differences) {
        const adjustedRect = {
            left: rect.left + offsetX,
            right: rect.right + offsetX,
            top: rect.top + offsetY,
            bottom: rect.bottom + offsetY
        };

        const boxWidth = adjustedRect.right - adjustedRect.left;
        const boxHeight = adjustedRect.bottom - adjustedRect.top;
        const color = colors[colorKey];

        if (hasDifferenceType(differences, ['text_mismatch', 'histogram_difference'])) {
            drawHatchedFill(adjustedRect, boxWidth, boxHeight, color.fill);
        } else {
            ctx.fillStyle = color.fill;
            ctx.fillRect(adjustedRect.left, adjustedRect.top, boxWidth, boxHeight);
        }

        ctx.strokeStyle = color.stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash(getLineDash(differences));
        ctx.strokeRect(adjustedRect.left, adjustedRect.top, boxWidth, boxHeight);
        ctx.setLineDash([]);

        if (hasDifferenceType(differences, ['missing_element', 'missing_text'])) {
            drawDiagonalCross(adjustedRect, color.stroke);
        }

        if (hasDifferenceType(differences, ['extra_element', 'extra_text'])) {
            drawUprightCross(adjustedRect, color.stroke);
        }
    }

    for (const elementGroup of wireframe.elementGroups) {
        for (const element of elementGroup.elements) {
            const rect = element.boundingRect;

            if (element.type === 'box') {
                const colorKey = determineColorKey(element, 'box');
                drawBoundingBox(rect, colorKey, element.differences);
            } else if (element.type === 'image') {
                const colorKey = determineColorKey(element, 'image');
                drawBoundingBox(rect, colorKey, element.differences);
            } else if (element.type === 'text' && element.texts && element.texts.length > 0) {
                for (const text of element.texts) {
                    const colorKey = determineColorKey(text, 'text');
                    drawBoundingBox(text.boundingRect, colorKey, text.differences);
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