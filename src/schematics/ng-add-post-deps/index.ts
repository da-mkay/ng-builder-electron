import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';
import { addPackageJsonDependency, getPackageJsonDependency, NodeDependencyType } from '@schematics/angular/utility/dependencies';
import * as inquirer from 'inquirer';
import * as semver from 'semver';

export default function (): Rule {
    return async (tree: Tree, context: SchematicContext) => {
        // Each electron version contains a specific Node.js version. Thus, ensure that the
        // appropriate @types/node package is installed.
        const electronPkgJsonFile = tree.get('/node_modules/electron/package.json');
        if (!electronPkgJsonFile) {
            return;
        }
        const pkgJson = JSON.parse(electronPkgJsonFile.content.toString('utf8'));
        const electronNodeVersion = pkgJson.devDependencies?.['@types/node'] || pkgJson.dependencies?.['@types/node'];
        if (!electronNodeVersion) {
            return;
        }
        const curNodeDep = getPackageJsonDependency(tree, '@types/node');
        if (curNodeDep) {
            if (semver.intersects(pkgJson.dependencies['@types/node'], curNodeDep.version)) {
                return; // @types/node version in our package.json fits the one of electron
            }
            if (context.interactive) {
                const answerInstall = await inquirer.prompt<{ install: boolean }>([
                    {
                        name: 'install',
                        message: `Electron uses @types/node version "${electronNodeVersion}", but package.json contains version "${curNodeDep.version}". Do you want to adjust package.json and install version "${electronNodeVersion}" instead?`,
                        type: 'confirm',
                    },
                ]);
                if (!answerInstall.install) {
                    return;
                }
            } else {
                context.logger.warn(
                    `Electron uses @types/node version "${electronNodeVersion}", but package.json contains version "${curNodeDep.version}". package.json will be updated!`
                );
            }
        }
        addPackageJsonDependency(tree, {
            name: '@types/node',
            type: NodeDependencyType.Dev,
            version: electronNodeVersion,
            overwrite: true
        });
        context.addTask(new NodePackageInstallTask());
    };
}
