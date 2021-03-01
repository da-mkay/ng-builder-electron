import { JsonObject } from '@angular-devkit/core';

/**
 * Angular automatically sets options to undefined or an empty array in case they are not provided but listed
 * in a builder's schema.
 * This function merges option-objects and ignores undefined values and empty arrays.
 *
 * @param a
 * @param b
 */
export function mergeOptions(a: JsonObject, b: JsonObject) {
    const options: JsonObject = { ...a };
    if (b) {
        const props = Object.keys(b);
        for (const prop of props) {
            const val = b[prop];
            if (val === undefined || (Array.isArray(val) && val.length === 0)) {
                continue;
            }
            options[prop] = val;
        }
    }
    return options;
}
