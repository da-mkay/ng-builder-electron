import { JsonObject } from '@angular-devkit/core';
import { mergeOptions } from '../utils/merge-options';
import { getTargetRef, TargetRef } from '../utils/target-ref';

/**
 * Options for the "build" builder.
 */
export interface BuildOptions extends JsonObject {
    outputPath: string;
    cleanOutputPath: boolean;
    main: string;
    packageJsonPath: string;
    rendererTargets: (string | TargetRef)[];
    mainTarget: string | TargetRef;
    depcheck: boolean;
    depcheckOptions?: JsonObject;
}

/**
 * A part of the "build" options. Can be used as overrides by other builders that call "build" builder.
 * The calling builder should intelligently merge the original BuildOptions and the PartialBuildOptions
 * using mergeBuildOptions().
 * For example the rendererTargets and mainTarget of a PartialBuildOptions may only contain part of a
 * target config, e.g. only the options but not the target name. In that case the target name should be
 * taken from original BuildOptions and it's target options should be merged with the provided options.
 */
export interface PartialBuildOptions extends Partial<Omit<BuildOptions, 'rendererTargets' | 'mainTarget'>> {
    rendererTargets?: (string | Partial<TargetRef>)[];
    mainTarget?: string | Partial<TargetRef>;
}

/**
 * "Intelligently" merge BuildOptions and PartialBuildOptions, i.e. options in PartialBuildOptions will not
 * just override options in BuildOptions.
 * For example, mainTarget and rendererTargets in PartialBuildOptions may contain only one: target or options.
 * The missing part is then taken from original BuildOptions.
 * @param options the base BuildOptions
 * @param additionalOptions the PartialBuildOptions options to merge with
 */
export function mergeBuildOptions(options: BuildOptions, additionalOptions: PartialBuildOptions) {
    if (!additionalOptions) {
        return options;
    }
    const props: string[] = Object.keys(additionalOptions);
    for (const prop of props) {
        if (prop === 'mainTarget') {
            const originalMainTarget = getTargetRef(options['mainTarget']);
            const mainTargetOverrides = getTargetRef(additionalOptions['mainTarget']);
            options.mainTarget = {
                target: mainTargetOverrides.target ?? originalMainTarget.target,
                options: mergeOptions(originalMainTarget.options, mainTargetOverrides.options),
            };
        } else if (prop === 'rendererTargets') {
            for (let i = 0; i < additionalOptions.rendererTargets.length; i++) {
                if (options.rendererTargets[i]) {
                    if (!additionalOptions.rendererTargets[i]) {
                        continue;
                    }
                    // Options/Overrides for existing rendererTarget
                    const oldTargetRef = getTargetRef(options.rendererTargets[i]);
                    const newTargetRef = getTargetRef(additionalOptions.rendererTargets[i]);
                    options.rendererTargets[i] = {
                        target: newTargetRef.target ?? oldTargetRef.target,
                        options: mergeOptions(oldTargetRef.options, newTargetRef.options),
                    };
                } else {
                    // additional rendererTarget
                    const targetRef = getTargetRef(additionalOptions.rendererTargets[i]);
                    options.rendererTargets.push({
                        target: targetRef.target, // may be undefined
                        options: targetRef.options,
                    });
                }
            }
        } else {
            options[prop] = additionalOptions[prop];
        }
    }
    return options;
}
