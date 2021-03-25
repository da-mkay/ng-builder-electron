import { BuilderContext, BuilderOutput, createBuilder, targetFromTargetString } from '@angular-devkit/architect';
import { from, Observable, defer, of } from 'rxjs';
import { JsonObject } from '@angular-devkit/core';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { BuildOptions, mergeBuildOptions } from '../build/options';
import * as electronBuilder from 'electron-builder';
import { getTargetRef } from '../utils/target-ref';
import { PrefixLogger } from '../utils/prefix-logger';
import { BuildTargetOptions, normalizeBuildTargetOptions } from '../utils/build-target-options';

/**
 * Options for the "package" builder.
 */
export interface PackageOptions extends BuildTargetOptions {
    electronBuilderConfig: JsonObject;
}

/**
 * Run the electron-build target, then use electron-builder to build the final electron package.
 */
export const execute = (options: PackageOptions, context: BuilderContext): Observable<BuilderOutput> => {
    options = normalizeBuildTargetOptions(options);
    const parentLogger = context.logger.createChild('');
    const logger = new PrefixLogger('Package', parentLogger, null, true);
    return defer(async () => {
        const buildTargetRef = getTargetRef(options.buildTarget);
        const buildTarget = targetFromTargetString(buildTargetRef.target);
        const originalBuildOptions = (await context.getTargetOptions(buildTarget)) as BuildOptions;
        const buildOptions = mergeBuildOptions(originalBuildOptions, buildTargetRef.options);

        return {
            buildTarget,
            buildOptions,
            electronBuilderConfig: options.electronBuilderConfig,
        };
    }).pipe(
        switchMap(({ buildTarget, buildOptions, electronBuilderConfig }) => {
            return from(context.scheduleTarget(buildTarget, buildOptions)).pipe(
                switchMap((run) => run.result),
                tap((result) => {
                    if (result.success) {
                        logger.info('Electron app build!');
                    } else {
                        logger.error('Failed to build electron app!');
                    }
                }),
                switchMap((result) => {
                    if (!result.success) {
                        return of({ success: false });
                    }
                    logger.info('Running electron-builder.');
                    return from(electronBuilder.build(electronBuilderConfig)).pipe(
                        switchMap((result) => {
                            if (result === null) {
                                // TODO: correct? null == error?
                                logger.error('electron-builder failed!');
                                return of({ success: false });
                            }
                            return of({ success: true });
                        })
                    );
                })
            );
        }),
        catchError((err) => {
            logger.error(err.message || err + '');
            return of({ success: false });
        })
    );
};

export default createBuilder<PackageOptions, BuilderOutput>(execute);
