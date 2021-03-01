import { JsonObject } from '@angular-devkit/core';

/**
 * A builder option type used to reference another target.
 */
export interface TargetRef<Opts extends JsonObject = JsonObject> extends JsonObject {
    target: string;
    options?: Opts;
}

/**
 * A helper function to ensure a TargetRef object is used.
 * When called with a target string, return that target string wrapped in a TargetRef object.
 * When called with a TargetRef, simply return it.
 */
export function getTargetRef<T extends JsonObject>(target: string | TargetRef<T>): TargetRef<T>;
export function getTargetRef<T extends JsonObject>(target: string | Partial<TargetRef<T>>): Partial<TargetRef<T>>;
export function getTargetRef<T extends JsonObject>(target: string | Partial<TargetRef<T>>) {
    const targetRef: Partial<TargetRef> = typeof target === 'string' ? { target } : target;
    return targetRef;
}
