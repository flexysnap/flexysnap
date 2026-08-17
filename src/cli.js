#!/usr/bin/env node

/**
 * flexysnap CLI — placeholder implementation.
 *
 * Usage:
 *   npx flexysnap update   Regenerate baseline snapshots
 */

const [, , command] = process.argv;

switch (command) {
    case 'update':
        console.log('flexysnap: baseline update not implemented yet.');
        break;
    default:
        console.log('flexysnap');
        console.log('');
        console.log('Usage:');
        console.log('  flexysnap update   Regenerate baseline snapshots');
        break;
}