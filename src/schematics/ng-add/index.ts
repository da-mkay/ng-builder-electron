import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';
import { NodePackageInstallTask, RunSchematicTask } from '@angular-devkit/schematics/tasks';
import { addPackageJsonDependency, getPackageJsonDependency, NodeDependencyType } from '@schematics/angular/utility/dependencies';
import * as inquirer from 'inquirer';
import * as semver from 'semver';

export default function (): Rule {
    return async (tree: Tree, context: SchematicContext) => {
        const dep = getPackageJsonDependency(tree, 'electron');
        if (dep) {
            context.addTask(new RunSchematicTask('ng-add-post-deps', null));
            return; // electron already in package.json
        }
        if (context.interactive) {
            const answerInstall = await inquirer.prompt<{ install: boolean }>([
                {
                    name: 'install',
                    message: 'Your package.json contains no electron dependency. Do you want to add electron as dev dependency now?',
                    type: 'confirm',
                },
            ]);
            if (!answerInstall.install) {
                context.logger.warn('NOTE: When installing electron in the future make sure that you install also the correct @types/node version!');
                return;
            }
            const answerVersion = await inquirer.prompt<{ version: string }>([
                {
                    name: 'version',
                    message: 'Which electron version do you want to install (enter semver >= 7.1.0 or "latest")?',
                    type: 'input',
                    default: 'latest',
                    validate: (input) =>
                        !!input && (input === 'latest' || (semver.validRange(input) && semver.intersects(input, '>=7.1.0'))),
                },
            ]);
            addPackageJsonDependency(tree, {
                name: 'electron',
                type: NodeDependencyType.Dev,
                version: answerVersion.version,
            });
        } else {
            addPackageJsonDependency(tree, {
                name: 'electron',
                type: NodeDependencyType.Dev,
                version: 'latest',
            });
        }
        const installTaskID = context.addTask(new NodePackageInstallTask());
        context.addTask(new RunSchematicTask('ng-add-post-deps', null), [installTaskID]);
    };
}
