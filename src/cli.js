#!/usr/bin/env node

import { runAnnotate } from './annotateWireframe.js';

const [, , command, ...args] = process.argv;

function printUsage() {
    console.log('flexysnap');
    console.log('');
    console.log('Usage:');
    console.log('  flexysnap update                              Regenerate baseline snapshots');
    console.log('  flexysnap annotate <wireframe.json> <screenshot.png>   Annotate a screenshot with wireframe data');
    console.log('  flexysnap annotate <folder>                   Annotate all matching files in a folder');
}

async function main() {
    switch (command) {
        case 'update':
            console.log('flexysnap: baseline update not implemented yet.');
            break;
        case 'annotate':
            await runAnnotate(args);
            break;
        default:
            printUsage();
            break;
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});