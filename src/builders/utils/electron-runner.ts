import { logging } from '@angular-devkit/core';
import { ChildProcess, spawn } from 'child_process';
import { Observable } from 'rxjs';
import { StringDecoder } from 'string_decoder';

/**
 * ElectronRunner can be used to start electron, to kill the electron process and to
 * send a reload-message to the processes using IPC.
 */
export class ElectronRunner {
    private electronPath: string;
    private proc: ChildProcess;

    /**
     * Create a new ElectronRunner
     * @param appPath The path to run electron in.
     * @param logger The logger to use for the output of electron's process.
     */
    constructor(private appPath: string, private logger: logging.Logger) {}

    /**
     * Create a new electron process, killing any previously created and currently running electron process.
     */
    open() {
        if (this.proc) {
            this.kill();
        }
        if (!this.electronPath) {
            try {
                this.electronPath = require('electron');
            } catch (e) {
                throw new Error('Could not find electron. Is it installed?');
            }
        }
        const proc = spawn(this.electronPath, [this.appPath], {
            stdio: [0, 'pipe', 'pipe', 'ipc'],
        });
        this.proc = proc;
        const decOut = new StringDecoder('utf8');
        const decErr = new StringDecoder('utf8');
        let fullOut = '';
        let fullErr = '';
        const log = (s: string) => {
            this.logger.info(s);
        };
        this.proc.stdout.on('data', (data) => {
            fullOut += decOut.write(data);
            const i = fullOut.lastIndexOf('\n');
            if (i >= 0) {
                log(fullOut.substring(0, i));
                fullOut = fullOut.substr(i + 1);
            }
        });
        this.proc.stderr.on('data', (data) => {
            fullErr += decErr.write(data);
            const i = fullErr.lastIndexOf('\n');
            if (i >= 0) {
                log(fullErr.substring(0, i));
                fullErr = fullErr.substr(i + 1);
            }
        });
        this.proc.on('exit', () => {
            fullOut += decOut.end();
            fullErr += decErr.end();
            if (fullOut) {
                log(fullOut);
            }
            if (fullErr) {
                log(fullErr);
            }
            if (this.proc === proc) {
                this.proc = null;
            }
        });
    }

    /**
     * Kill the currently running electron process. If there is none, nothing happens.
     */
    kill() {
        if (!this.proc) {
            return;
        }
        this.proc.kill();
        this.proc = null;
    }

    /**
     * Send an IPC message to the electron-process to inform that windows should be reloaded.
     * If there is not electron process running, start one.
     */
    reload() {
        if (!this.proc) {
            this.open();
            return;
        }
        this.proc.send('@da-mkay/ng-builder-electron:reload');
    }
}

/**
 * Wraps an ElectronRunner in an Observable, such that the electron process is killed during teardown.
 */
export function electronRunner(appPath: string, logger: logging.Logger) {
    return new Observable<ElectronRunner>((observer) => {
        const electron = new ElectronRunner(appPath, logger);
        observer.next(electron);
        return () => {
            electron.kill();
        };
    });
}
