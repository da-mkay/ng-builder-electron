import { BuilderContext, BuilderOutput, createBuilder, targetFromTargetString } from '@angular-devkit/architect';
import { from, Observable, combineLatest, defer, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { BuildOptions } from './options';
import { setupBuildOutputPath } from '../utils/setup-build-output-path';
import { PrefixLogger } from '../utils/prefix-logger';
import { getTargetRef } from '../utils/target-ref';
import { existsSync, readJSONSync, writeJSONSync } from 'fs-extra';
import * as depcheck from 'depcheck';
import * as path from 'path';

/**
 * Schedule targets that build the code that will run in electron's main and renderer threads.
 * These targets should put the code beneath the outputPath.
 * Moreover, create a package.json in the outputPath which can then be used by electron.
 */
export const execute = (options: BuildOptions, context: BuilderContext): Observable<BuilderOutput> => {
    const parentLogger = context.logger.createChild('');
    const logger = new PrefixLogger('Build', parentLogger, null, true);
    return defer(async () => {
        // Clean outputPath, write package.json
        const { mainPath, packageJsonPath, outputPath } = setupBuildOutputPath(options, context);

        // schedule renderer targets
        const rendererRuns = options.rendererTargets.map((rendererTarget, i) => {
            const targetRef = getTargetRef(rendererTarget);
            const rendererLoggerName = 'Renderer' + (options.rendererTargets.length > 1 ? ` ${i + 1}` : '');
            const rendererLogger = new PrefixLogger(rendererLoggerName, parentLogger, null, true);
            return from(
                context.scheduleTarget(targetFromTargetString(targetRef.target), targetRef.options, { logger: rendererLogger })
            ).pipe(
                tap(() => {
                    logger.info(`Scheduled renderer target "${targetRef.target}" as "${rendererLoggerName}"`);
                }),
                map((run) => ({ type: 'renderer', target: targetRef.target, run }))
            );
        });

        // schedule main target
        const mainTargetRef = getTargetRef(options.mainTarget);
        const mainLogger = new PrefixLogger('Main', parentLogger, null, true);
        const mainRun = from(
            context.scheduleTarget(targetFromTargetString(mainTargetRef.target), mainTargetRef.options, { logger: mainLogger })
        ).pipe(
            tap(() => {
                logger.info(`Scheduled main target "${mainTargetRef.target}" as "Main"`);
            }),
            map((run) => ({ type: 'main', target: mainTargetRef.target, run }))
        );

        const runResults = [...rendererRuns, mainRun].map((run$) =>
            run$.pipe(switchMap(({ type, target, run }) => from(run.result).pipe(map((output) => ({ type, target, output })))))
        );
        return { runResults, mainPath, packageJsonPath, outputPath };
    }).pipe(
        switchMap(({ runResults, mainPath, packageJsonPath, outputPath }) => {
            // Wait until all targets have completed
            return combineLatest(runResults).pipe(
                switchMap((results) => {
                    const failedTargets = results.filter((result) => !result.output.success);
                    if (failedTargets.length !== 0) {
                        const targets = failedTargets.map((t) => `${t.target} (${t.type})`).join(', ');
                        logger.error(`The following targets failed to build: ${targets}`);
                        return of(false);
                    } else if (!existsSync(mainPath)) {
                        logger.error(`All targets finished, but main file ${mainPath} does not exist. Wrong configuration?`);
                        return of(false);
                    }
                    if (!options.depcheck) {
                        return of(true);
                    }
                    logger.info(`Running depcheck to find used dependencies missing in final package.json.`);
                    const depcheckOpts = { ignoreMatches: ['electron'], ...options.depcheckOptions };
                    return from(depcheck(outputPath, depcheckOpts)).pipe(
                        map((result) => {
                            const missingDeps = Object.keys(result.missing);
                            const failedFiles = Object.keys(result.invalidFiles);
                            if (failedFiles.length > 0) {
                                logger.warn(`depcheck failed on the following files:`);
                                for (const failedFile of failedFiles) {
                                    logger.warn(`- ${failedFile}: ${result.invalidFiles[failedFile]}`);
                                }
                            }
                            const failedDirs = Object.keys(result.invalidDirs);
                            if (failedDirs.length > 0) {
                                logger.warn(`depcheck failed on the following directories:`);
                                for (const failedDir of failedDirs) {
                                    logger.warn(`- ${failedDir}: ${result.invalidDirs[failedDir]}`);
                                }
                            }
                            if (missingDeps.length > 0) {
                                const packageJson = readJSONSync(path.join(context.workspaceRoot, 'package.json'), { encoding: 'utf8' });
                                const deps = missingDeps.map((name) => ({ name, version: packageJson.dependencies[name] }));
                                const addDeps = deps.filter((dep) => dep.version !== undefined);
                                if (addDeps.length > 0) {
                                    logger.info(
                                        `Found ${addDeps.length} used ${
                                            addDeps.length === 1 ? 'dependency' : 'dependencies'
                                        } that will be added to final package.json:`
                                    );
                                    logger.info(addDeps.map((dep) => `- ${dep.name}: ${dep.version}`).join('\n'));
                                    const finPackageJson = readJSONSync(packageJsonPath, { encoding: 'utf8' });
                                    finPackageJson.dependencies = addDeps.reduce((deps, dep) => {
                                        deps[dep.name] = dep.version;
                                        return deps;
                                    }, finPackageJson.dependencies || {});
                                    writeJSONSync(packageJsonPath, finPackageJson, { encoding: 'utf8' });
                                }
                                const missingVersion = deps.filter((dep) => dep.version === undefined);
                                if (missingVersion.length > 0) {
                                    logger.warn(
                                        `Found ${missingVersion.length} used ${
                                            addDeps.length === 1 ? 'dependency' : 'dependencies'
                                        } that were not found in root package.json:`
                                    );
                                    logger.warn(missingVersion.map((dep) => `- ${dep.name}`).join('\n'));
                                }
                            }
                            return true;
                        })
                    );
                })
            );
        }),
        map((success) => ({ success })),
        catchError((err) => {
            logger.error(err.message || err + '');
            return of({ success: false });
        })
    );
};

export default createBuilder<BuildOptions, BuilderOutput>(execute);
