import { BuilderContext, BuilderRun, ScheduleOptions, Target } from '@angular-devkit/architect';
import { JsonObject } from '@angular-devkit/core';
import { from, Observable } from 'rxjs';

/**
 * Like Angular's scheduleTargetAndForget, but returns an Observable that emits the BuilderRun
 * instead the BuilderOutput.
 * So why not use scheduleTarget? Because it returns a Promise and we often need an Observable
 * that stops the builder during teardown. That's what scheduleTargetAndForget does, but it
 * does not provide access to the BuilderRun, just its output.
 * @param context
 * @param target
 * @param overrides
 * @param scheduleOptions
 */
export function scheduleTarget$(
    context: BuilderContext,
    target: Target,
    overrides?: JsonObject,
    scheduleOptions?: ScheduleOptions
): Observable<BuilderRun> {
    return new Observable<BuilderRun>((observer) => {
        // NOTE: resolve-logic taken form scheduleTargetAndForget
        let resolve: (() => void) | null = null;
        const promise = new Promise<void>((r) => (resolve = r));
        context.addTeardown(() => promise);

        const p = context.scheduleTarget(target, overrides, scheduleOptions);
        // NOTE: We do not use .subscribe(observer) here, because observer would be completed immediately
        //       followed by stopping the run (see teardown below).
        const s = from(p).subscribe((d) => observer.next(d));

        return () => {
            s.unsubscribe();
            p.then((run) => run.stop()).then(resolve); // context teardown will wait for stop
        };
    });
}
