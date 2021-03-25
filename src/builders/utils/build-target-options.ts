import { JsonObject } from '@angular-devkit/core';
import { mergeBuildOptions, normalizeBuildOptions, PartialBuildOptions } from '../build/options';
import { getTargetRef } from './target-ref';

/**
 * Base options for the "serve" and "package" builder which reference a "build" target.
 */
export interface BuildTargetOptions extends JsonObject {
    buildTarget:
        | string
        | {
              target: string;
              options?: PartialBuildOptions;
          };
    buildTargetOverrides?:
        | string
        | {
              target?: string;
              options?: PartialBuildOptions;
          };
}

/**
 * Normalize BuildTargetOptions, i.e. merge buildTargetOverrides into buildTarget.
 */
 export function normalizeBuildTargetOptions<T extends BuildTargetOptions>(options: T) {
    const buildTargetRef = getTargetRef(options.buildTarget);
    if (buildTargetRef.options) {
        buildTargetRef.options = normalizeBuildOptions(buildTargetRef.options);
    }
    if (options.buildTargetOverrides) {
        const buildTargetRefOverrides = getTargetRef(options.buildTargetOverrides);
        buildTargetRef.target = buildTargetRefOverrides.target ?? buildTargetRef.target;
        if (buildTargetRefOverrides.options) {
            buildTargetRefOverrides.options = normalizeBuildOptions(buildTargetRefOverrides.options);
            buildTargetRef.options = mergeBuildOptions(buildTargetRef.options, buildTargetRefOverrides.options);
        }
    }
    options.buildTarget = buildTargetRef;
    delete options.buildTargetOverrides;
    return options;
}
