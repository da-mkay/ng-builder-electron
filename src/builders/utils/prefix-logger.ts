import { logging } from '@angular-devkit/core';
import { map } from 'rxjs/operators';
import { StyleFunction } from 'ansi-colors';

/**
 * Targets often run other targets and it is hard to distinguish what output belongs to which target.
 * PrefixLogger will add a prefix to each log message. When assigning each target its own PrefixLogger
 * its easy to see what output belongs to which target.
 */
export class PrefixLogger extends logging.TransformLogger {
    /**
     * Create new PrefixLogger.
     *
     * @param prefix Used as logger name and as the prefix for log messages.
     * @param parent The parent logger or null.
     * @param style An optional style to apply to the log message.
     * @param logPrefix Whether to prefix log messages or not. The default is false, because
     *                  logging.Loggers createChild() method will invoke the constructor and
     *                  scheduleByName() will always create a child. That can lead to unwanted
     *                  prefixes being logged.
     */
    constructor(prefix: string, parent: logging.Logger | null = null, style?: StyleFunction, logPrefix = false) {
        super(
            prefix,
            (obs) => {
                if (!logPrefix) {
                    return obs;
                }
                return obs.pipe(
                    map(({ message, ...rest }) => ({
                        message: (style ? style : (x) => x)(`[${prefix}] ${message.replace(/\n/g, `\n[${prefix}] `)}`),
                        ...rest,
                        path: [], // Remove path, because any parent may be an IndentLogger that prints indents as prefix
                    }))
                );
            },
            parent
        );
    }
}
