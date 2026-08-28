import path from 'path';

let outputRoot = process.cwd();

function setWireframeOutputRoot(rootPath) {
    outputRoot = rootPath || process.cwd();
}

function getWireframeOutputRoot() {
    return outputRoot;
}

function resolveWireframeOutputDir(outputDir) {
    if (!outputDir || typeof outputDir !== 'string') {
        throw new Error('resolveWireframeOutputDir requires a non-empty string outputDir.');
    }

    if (path.isAbsolute(outputDir)) {
        return outputDir;
    }

    return path.join(outputRoot, outputDir);
}

export {
    setWireframeOutputRoot,
    getWireframeOutputRoot,
    resolveWireframeOutputDir
};