import { BuilderContext } from '@angular-devkit/architect';
import * as path from 'path';
import { BuildOptions } from '../build/options';
import { ensureDirSync, existsSync, readJSONSync, removeSync, writeFileSync, writeJSONSync } from 'fs-extra';

/**
 * The common setup for the various electron builders like "build" and "serve".
 */
export function setupBuildOutputPath(
    options: BuildOptions,
    context: BuilderContext,
    replaceMain?: { main: string; content: (relativeOriginalMainPath: string) => string }
) {
    const inPackageJsonPath = path.resolve(context.workspaceRoot, options.packageJsonPath);
    if (!existsSync(inPackageJsonPath)) {
        throw new Error(`package.json file could not be found: ${inPackageJsonPath}`);
    }
    const packageJsonPath = path.resolve(context.workspaceRoot, options.outputPath, 'package.json');
    const outputPath = path.resolve(context.workspaceRoot, options.outputPath);
    const originalMainPath = path.resolve(outputPath, options.main); // for the case the used used an absolute path
    let mainPath = originalMainPath;
    if (options.cleanOutputPath) {
        removeSync(outputPath);
    }
    ensureDirSync(outputPath);

    // The serve builder may provide a replacement for the main file to inject code.
    if (replaceMain) {
        const pathReplaceMain = path.resolve(outputPath, replaceMain.main);
        const pathReplaceMainFolder = path.dirname(pathReplaceMain);
        ensureDirSync(pathReplaceMainFolder);
        writeFileSync(pathReplaceMain, replaceMain.content(path.relative(pathReplaceMainFolder, mainPath)), { encoding: 'utf8' });
        mainPath = pathReplaceMain;
    }

    // create package.json in outputPath
    const packageJson = readJSONSync(inPackageJsonPath, { encoding: 'utf8' });
    packageJson.main = path.relative(outputPath, mainPath);
    writeJSONSync(packageJsonPath, packageJson, {
        encoding: 'utf8',
    });
    return { outputPath, mainPath, originalMainPath, packageJsonPath };
}
