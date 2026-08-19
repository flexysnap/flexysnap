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

    const colors = {
        box: { fill: 'rgba(220, 160, 40, 0.4)', stroke: '#E6A500' },
        image: { fill: 'rgba(70, 180, 120, 0.4)', stroke: '#2EBC6F' },
        text: { fill: 'rgba(50, 130, 190, 0.4)', stroke: '#0066CC' },
        error: { fill: 'rgba(211, 47, 47, 0.4)', stroke: '#D32F2F' }
    };

    function hasErrors(obj) {
        return obj.differences && Array.isArray(obj.differences) && obj.differences.length > 0;
    }

    function drawBoundingBox(rect, colorKey, dashed = false) {
        const boxWidth = rect.right - rect.left;
        const boxHeight = rect.bottom - rect.top;
        const color = colors[colorKey];

        ctx.fillStyle = color.fill;
        ctx.fillRect(rect.left, rect.top, boxWidth, boxHeight);
        ctx.strokeStyle = color.stroke;
        ctx.lineWidth = 2;
        ctx.setLineDash(dashed ? [6, 4] : []);
        ctx.strokeRect(rect.left, rect.top, boxWidth, boxHeight);
        ctx.setLineDash([]);
    }

    for (const elementGroup of wireframe.elementGroups) {
        const dashed = elementGroup.strictPosition === false;

        for (const element of elementGroup.elements) {
            const rect = element.boundingRect;

            if (element.type === 'box') {
                const colorKey = hasErrors(element) ? 'error' : 'box';
                drawBoundingBox(rect, colorKey, dashed);
            } else if (element.type === 'image') {
                const colorKey = hasErrors(element) ? 'error' : 'image';
                drawBoundingBox(rect, colorKey, dashed);
            } else if (element.type === 'text' && element.texts && element.texts.length > 0) {
                for (const text of element.texts) {
                    const colorKey = hasErrors(text) ? 'error' : 'text';
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