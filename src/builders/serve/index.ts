import {
    BuilderContext,
    BuilderOutput,
    BuilderProgressState,
    createBuilder,
    targetFromTargetString,
    BuilderRun,
} from '@angular-devkit/architect';
import { Observable, combineLatest, defer, of, merge, EMPTY } from 'rxjs';
import { catchError, distinctUntilChanged, map, scan, switchMap, tap } from 'rxjs/operators';
import { setupBuildOutputPath } from '../utils/setup-build-output-path';
import { BuildOptions, mergeBuildOptions, normalizeBuildOptions } from '../build/options';
import { electronRunner } from '../utils/electron-runner';
import { PrefixLogger } from '../utils/prefix-logger';
import { getTargetRef } from '../utils/target-ref';
import { dim } from 'ansi-colors';
import { scheduleTarget$ } from '../utils/schedule-target';
import { BuildTargetOptions, normalizeBuildTargetOptions } from '../utils/build-target-options';
import { existsSync } from 'fs-extra';

/**
 * Options for the "serve" builder.
 */
export interface ServeOptions extends BuildTargetOptions {}

/**
 * Represents a target that was scheduled.
 */
interface TargetRun {
    type: 'main' | 'renderer';
    target: string;
    run: BuilderRun;
}

/**
 * The current running state of main and renderer targets.
 */
interface TargetRunningState {
    main: boolean;
    renderer: boolean;
}

/**
 * Aggregated result of multiple target runs.
 */
interface TargetsResult {
    /**
     * Whether main target was running, i.e. main code was rebuilt and a hot reload is required once all target are done.
     */
    mainWasRunning: boolean;
    /**
     * Whether a renderer target was running, i.e. renderer code was rebuilt and a soft reload is required once all target are done.
     */
    rendererWasRunning: boolean;
    /**
     * Whether there is any target currently running (main or renderer).
     */
    curAnyRunning: boolean;
    /**
     * If the serve builder should emit a BuilderOutput once all targets are done, "output" is set to the final aggregated value.
     */
    output?: BuilderOutput;
    /**
     * If a reload should be performed, "reload" is set to either "hot" or "soft".
     * "hot" means the electron process is (re-)spawned.
     * "soft" means the electron windows are reloaded.
     */
    reload?: 'hot' | 'soft';
    /**
     * Whether to reset the current aggregated output.
     */
    resetOutput?: boolean;
}

/**
 * Schedule targets that build the code that will run in electron's main and renderer threads.
 * These targets should put the code beneath the outputPath.
 * The targets should run in watch-mode such that code is rebuilt once a code change is detected.
 * Moreover, create a package.json in the outputPath which can then be used by electron.
 * Finally, electron is run in the outputPath.
 * Each time all targets have finished (rebuilt code), electron is (re-)spawned or reloaded.
 */
export const execute = (options: ServeOptions, context: BuilderContext): Observable<BuilderOutput> => {
    options = normalizeBuildTargetOptions(options);
    const parentLogger = context.logger.createChild('');
    const logger = new PrefixLogger('Serve', parentLogger, null, true);
    return defer(async () => {
        const buildTargetRef = getTargetRef(options.buildTarget);
        const buildTarget = targetFromTargetString(buildTargetRef.target);
        const originalBuildOptions = normalizeBuildOptions((await context.getTargetOptions(buildTarget)) as BuildOptions);
        const buildOptions = mergeBuildOptions(originalBuildOptions, buildTargetRef.options);
        const builderName = await context.getBuilderNameForTarget(buildTarget);
        // Validate options because we can end up with a mainTarget or rendererTarget without target name.
        await context.validateOptions(buildOptions, builderName);

        // Clean outputPath, write package.json
        const paths = setupBuildOutputPath(buildOptions, context, {
            main: 'main_replaced.js', // TODO: make configurable?
            content: (relativeOriginalMainPath) => {
                relativeOriginalMainPath = relativeOriginalMainPath.replace(/\\/g, '/'); // for win paths
                return `const electron = require('electron'); process.on('message', (m) => { if (m === '@da-mkay/ng-builder-electron:reload') { for (const window of electron.BrowserWindow.getAllWindows()) { window.reload(); } }}); require('./${relativeOriginalMainPath}');`;
            },
        });
        return { buildOptions, paths };
    }).pipe(
        switchMap(({ buildOptions, paths }) => {
            // rendererRuns$ will schedule renderer targets once subscribed
            const rendererRuns$: Observable<TargetRun>[] = buildOptions.rendererTargets.map((rendererTarget, i) => {
                const targetRef = getTargetRef(rendererTarget);
                const rendererLoggerName = 'Renderer' + (buildOptions.rendererTargets.length > 1 ? ` ${i + 1}` : '');
                const rendererLogger = new PrefixLogger(rendererLoggerName, parentLogger, null, true);

                return scheduleTarget$(context, targetFromTargetString(targetRef.target), targetRef.options, {
                    logger: rendererLogger,
                }).pipe(
                    tap(() => {
                        logger.info(`Scheduled renderer target "${targetRef.target}" as "${rendererLoggerName}"`);
                    }),
                    map((run) => ({
                        type: 'renderer',
                        target: targetRef.target,
                        run,
                    }))
                );
            });

            // mainRun$ will schedule main target once subscribed
            const mainTargetRef = getTargetRef(buildOptions.mainTarget);
            const mainLogger = new PrefixLogger('Main', parentLogger, null, true);
            const mainRun$: Observable<TargetRun> = scheduleTarget$(
                context,
                targetFromTargetString(mainTargetRef.target),
                mainTargetRef.options,
                { logger: mainLogger }
            ).pipe(
                tap(() => {
                    logger.info(`Scheduled main target "${mainTargetRef.target}" as "Main"`);
                }),
                map((run) => ({ type: 'main', target: mainTargetRef.target, run }))
            );

            const runs$ = [...rendererRuns$, mainRun$];
            return combineLatest([
                of(paths.originalMainPath),
                electronRunner(paths.outputPath, new PrefixLogger('Electron', parentLogger, dim, true)),
                combineLatest(runs$),
            ]);
        }),
        switchMap(([mainPath, electron, runs]) => {
            // runningState$ emits which targets are running (main and/or renderer)
            const runningState$ = combineLatest(
                runs.map(({ type, run }) => run.progress.pipe(map((progress) => ({ type, progress }))))
            ).pipe(
                map((progresses) => {
                    const running = progresses.filter((p) => p.progress.state === BuilderProgressState.Running);
                    return {
                        main: running.some((p) => p.type === 'main'),
                        renderer: running.some((p) => p.type === 'renderer'),
                    };
                }),
                distinctUntilChanged((a, b) => a.main === b.main && a.renderer === b.renderer),
                tap((runningState) => {
                    if (runningState.main || runningState.renderer) {
                        context.reportRunning();
                    }
                })
            );

            const outputs$ = combineLatest(
                runs.map(({ run, type, target }) =>
                    run.output.pipe(
                        tap({
                            complete: () => {
                                logger.warn(
                                    `Target "${target}" (${type}) completed, but expected to run in watch mode! File changes will not lead to recompile!`
                                );
                            },
                        })
                    )
                )
            );

            // Any time a target's running state changes or we get a new target result, scan will create a new TargetsResult
            // that defines what happens next (emit aggregated BuilderOutput, reload electron).
            return merge(runningState$, outputs$).pipe(
                scan<TargetRunningState | BuilderOutput[], TargetsResult>(
                    (result, runningStateOrOutputs) => {
                        if (result.resetOutput) {
                            result.resetOutput = false;
                            result.output = null;
                        }
                        result.reload = null;
                        if (Array.isArray(runningStateOrOutputs)) {
                            result.output = { success: runningStateOrOutputs.every((o) => o.success) };
                        } else {
                            result.mainWasRunning = result.mainWasRunning || runningStateOrOutputs.main;
                            result.rendererWasRunning = result.rendererWasRunning || runningStateOrOutputs.renderer;
                            result.curAnyRunning = runningStateOrOutputs.main || runningStateOrOutputs.renderer;
                        }
                        if (!result.curAnyRunning && result.output) {
                            if (result.output.success) {
                                if (existsSync(mainPath)) {
                                    result.reload = result.mainWasRunning ? 'hot' : 'soft';
                                } else {
                                    result.output = { success: false };
                                    logger.error(`All targets finished, but main file ${mainPath} does not exist. Wrong configuration?`);
                                }
                            }
                            result.resetOutput = true;
                            result.mainWasRunning = false;
                            result.rendererWasRunning = false;
                        }
                        return result;
                    },
                    {
                        curAnyRunning: false,
                        mainWasRunning: false,
                        rendererWasRunning: false,
                    }
                ),
                tap((result) => {
                    if (!result.reload) {
                        return;
                    }
                    logger.info(`Perform electron ${result.reload} reload`);
                    if (result.reload === 'hot') {
                        try {
                            electron.open();
                        } catch (e) {
                            logger.error(e.message);
                        }
                    } else if (result.reload === 'soft') {
                        electron.reload();
                    }
                }),
                switchMap((result) => {
                    if (!result.resetOutput) {
                        return EMPTY;
                    }
                    return of(result.output);
                })
            );
        }),
        catchError((err) => {
            logger.error(err.message || err + '');
            return of({ success: false });
        })
    );
};

export default createBuilder<ServeOptions, BuilderOutput>(execute);
