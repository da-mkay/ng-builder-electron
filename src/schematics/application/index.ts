import { join, normalize, strings } from '@angular-devkit/core';
import {
    apply,
    applyTemplates,
    chain,
    externalSchematic,
    mergeWith,
    move,
    noop,
    Rule,
    SchematicContext,
    SchematicsException,
    Tree,
    url,
} from '@angular-devkit/schematics';
import { validateProjectName } from '@schematics/angular/utility/validation';
import { updateWorkspace, getWorkspace } from '@schematics/angular/utility/workspace';
import { relativePathToWorkspaceRoot } from '@schematics/angular/utility/paths';
import { ProjectType } from '@schematics/angular/utility/workspace-models';
import { addPackageJsonDependency, getPackageJsonDependency, NodeDependencyType } from '@schematics/angular/utility/dependencies';
import { insertImport, findNodes } from '@schematics/angular/utility/ast-utils';
import * as inquirer from 'inquirer';
import * as ts from '@schematics/angular/third_party/github.com/Microsoft/TypeScript/lib/typescript';
import { InsertChange } from '@schematics/angular/utility/change';
import { WorkspaceDefinition } from '@angular-devkit/core/src/workspace';
import { NodePackageInstallTask } from '@angular-devkit/schematics/tasks';

const NODE_BUILD_IN_MODULES = [
    'assert',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'dns',
    'domain',
    'events',
    'fs',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'repl',
    'stream',
    'string_decoder',
    'timers',
    'tls',
    'trace_events',
    'tty',
    'url',
    'util',
    'v8',
    'vm',
    'wasi',
    'worker_threads',
    'zlib',
];

type SupportedMainBuilder = '@da-mkay/ng-builder-typescript' | '@richapps/ngnode';

interface ApplicationOptions {
    name: string;
    singleProject: boolean;
    rendererProject?: string;
    mainBuilder?: SupportedMainBuilder;
    enableNodeIntegration?: boolean;
}

export default function (options: ApplicationOptions): Rule {
    return async (tree: Tree, context: SchematicContext) => {
        // Ensure all settings are set for the corresponding mode
        const angularProjects = await getAngularProjects(tree);
        if (options.singleProject) {
            if (options.rendererProject) {
                if (!angularProjects.some((name) => name === options.rendererProject)) {
                    throw new SchematicsException(`Invalid options, "rendererProject" must be - if set - an existing Angular project.`);
                } // else: rendererProject is name of existing Angular project, ignore options.name, use rendererProject
            } else {
                if (context.interactive) {
                    if (angularProjects.length > 0) {
                        const rendererProject = await promptForExistingRendererProject(angularProjects);
                        if (rendererProject) {
                            options.rendererProject = rendererProject;
                        } else {
                            options.name = await getNameOptionOrPrompt(options, promptForSingleProjectName);
                        }
                    } else {
                        options.name = await getNameOptionOrPrompt(options, promptForSingleProjectName);
                    }
                } else {
                    validateName(options.name);
                }
            }
        } else {
            options.name = await getNameOptionOrPrompt(options, promptForBaseName);
            if (options.rendererProject) {
                if (!angularProjects.some((name) => name === options.rendererProject)) {
                    throw new SchematicsException(`Invalid options, "rendererProject" must be - if set - an existing Angular project.`);
                } // else: rendererProject is name of existing Angular project, ignore options.name, use rendererProject
            } else {
                if (context.interactive) {
                    if (angularProjects.length > 0) {
                        const rendererProject = await promptForExistingRendererProject(angularProjects);
                        if (rendererProject) {
                            options.rendererProject = rendererProject;
                        }
                    }
                }
            }
        }
        const angularDep = getPackageJsonDependency(tree, '@angular/core');
        const angularCoreVersion = angularDep ? angularDep.version.match(/\d+/)[0] : undefined;
        const customWebpackBuilderVersion = angularCoreVersion ? `^${angularCoreVersion}.0.0` : 'latest';
        options.mainBuilder = await getMainBuilderOptionOrPrompt(options, angularCoreVersion, context);
        addPackageJsonDependency(tree, {
            name: options.mainBuilder,
            type: NodeDependencyType.Dev,
            version: options.mainBuilder === '@da-mkay/ng-builder-typescript' ? '0.x' : '>=1.0.2-rc.4 <2',
        });
        // Install @angular-builders/custom-webpack, because we need to modify webpack config (specify externals)
        addPackageJsonDependency(tree, {
            name: '@angular-builders/custom-webpack',
            type: NodeDependencyType.Dev,
            version: customWebpackBuilderVersion,
        });
        context.addTask(new NodePackageInstallTask());
        if (context.interactive && options.enableNodeIntegration === undefined) {
            options.enableNodeIntegration = await promptForEnableNodeIntegration();
        }

        let rendererProject: string;
        let mainProject: string;
        let relMainApiPath: string;
        let mainRule: Rule;
        if (options.singleProject) {
            relMainApiPath = 'main/src/api';
            if (options.rendererProject) {
                rendererProject = mainProject = options.rendererProject;
                mainRule = chain([
                    updateRendererProject(options.rendererProject),
                    options.mainBuilder === '@da-mkay/ng-builder-typescript'
                        ? addTscMainTarget(options.rendererProject, options.enableNodeIntegration)
                        : addWebpackMainTarget(options.rendererProject, options.enableNodeIntegration),
                    addElectronTargets(options.rendererProject),
                ]);
            } else {
                rendererProject = mainProject = options.name;
                mainRule = chain([
                    createRendererProject(rendererProject, context),
                    updateRendererProject(rendererProject),
                    options.mainBuilder === '@da-mkay/ng-builder-typescript'
                        ? addTscMainTarget(mainProject, options.enableNodeIntegration)
                        : addWebpackMainTarget(mainProject, options.enableNodeIntegration),
                    addElectronTargets(options.name),
                ]);
            }
        } else {
            rendererProject = options.rendererProject ? options.rendererProject : `${options.name}-renderer`;
            mainProject = `${options.name}-main`;
            relMainApiPath = `src/api`;
            const electronName = `${options.name}-electron`;
            mainRule = chain([
                options.rendererProject ? noop() : createRendererProject(rendererProject, context),
                updateRendererProject(rendererProject),
                options.mainBuilder === '@da-mkay/ng-builder-typescript'
                    ? addTscMainProject(mainProject, options.enableNodeIntegration)
                    : addWebpackMainProject(mainProject, options.enableNodeIntegration),
                addElectronProject(options.name, electronName, mainProject, rendererProject),
            ]);
        }
        if (options.enableNodeIntegration) {
            return mainRule;
        }
        return chain([mainRule, updateAppComponent(rendererProject, 'my-api'), updateTsConfig('my-api', mainProject, relMainApiPath)]);
    };
}

async function getNameOptionOrPrompt(options: ApplicationOptions, promptForName: () => Promise<string>) {
    if (options.name !== undefined) {
        validateName(options.name);
        return options.name;
    }
    return await promptForName();
}

async function getMainBuilderOptionOrPrompt(options: ApplicationOptions, angularCoreVersion: string, context: SchematicContext) {
    if (options.mainBuilder === undefined) {
        if (context.interactive) {
            const choices: { value: SupportedMainBuilder; label: string }[] = [
                {
                    value: '@da-mkay/ng-builder-typescript',
                    label: '@da-mkay/ng-builder-typescript [ for simple projects, uses only typescript compiler ]',
                },
                { value: '@richapps/ngnode', label: '@richapps/ngnode               [ for complex projects, uses webpack ]' },
            ];
            const answer = await inquirer.prompt<{ mainBuilder: string }>([
                {
                    name: 'mainBuilder',
                    message: "Which builder would you like to use for building the code that will be run in electron's main thread?",
                    type: 'list',
                    choices: choices.map((choice) => choice.label),
                },
            ]);
            options.mainBuilder = choices.find((choice) => choice.label === answer.mainBuilder).value;
        } else {
            options.mainBuilder = '@da-mkay/ng-builder-typescript';
        }
    }
    if (options.mainBuilder === '@richapps/ngnode' && Number(angularCoreVersion) < 9) {
        throw new Error(
            `You are currently using Angular ${angularCoreVersion} which has a bug that makes using @richapps/ngnode for the main code impossible. Upgrade Angular to version >=9 or use a different main builder.`
        );
    }
    return options.mainBuilder;
}

async function promptForSingleProjectName() {
    return await promptForName('What name would you like to use for the application?');
}

async function promptForBaseName() {
    return await promptForName('What name would you like to use as a base for the main, renderer and electron project?');
}

async function promptForName(message: string) {
    const answer = await inquirer.prompt<{ name: string }>([
        {
            name: 'name',
            message,
            type: 'input',
        },
    ]);
    validateName(answer.name);
    return answer.name;
}

async function promptForExistingRendererProject(angularProjects: string[]) {
    const answer = await inquirer.prompt<{ rendererProject: string }>([
        {
            name: 'rendererProject',
            message: 'You already have Angular projects in your workspace. Do you want to use one of them as the renderer project?',
            type: 'list',
            choices: ['No, I want to create a new Angular project.', ...angularProjects.map((name) => `Use project "${name}"`)],
        },
    ]);
    return angularProjects.find((name) => `Use project "${name}"` === answer.rendererProject);
}

async function promptForEnableNodeIntegration() {
    const answer = await inquirer.prompt<{ enableNodeIntegration: boolean }>([
        {
            name: 'rendererProject',
            message:
                'Do you want to enable node integration or not (default)? With node integration enabled you will be able to use Node.js modules in the renderer thread (not recommended). Without node integration enabled the renderer thread has only access to predefined functions/values which will be made available using a preload script (recommended).',
            type: 'confirm',
        },
    ]);
    return answer.enableNodeIntegration;
}

function validateName(name: string) {
    if (!name) {
        throw new SchematicsException(`Invalid options, "name" is required.`);
    }
    validateProjectName(name);
}

function updateTsConfig(apiName: string, mainProject: string, relMainApiPath: string) {
    return async (tree: Tree, context: SchematicContext) => {
        const tsConfigPath = normalize('/tsconfig.json');
        const workspace = await getWorkspace(tree);
        const apiPath = relativeRoot(workspace.projects.get(mainProject).root, relMainApiPath);
        const tsConfigContent = tree.read(tsConfigPath).toString('utf8');
        const tsConfig = ts.parseJsonText(tsConfigPath, tsConfigContent);
        const obj = tsConfig.statements[0].expression as ts.ObjectLiteralExpression;
        const update = tree.beginUpdate(tsConfigPath);
        const coProp = obj.properties.find((prop) => 'text' in prop.name && prop.name.text === 'compilerOptions') as ts.PropertyAssignment;
        if (!coProp) {
            const insertPos = obj.properties.length > 0 ? obj.properties[obj.properties.length - 1].getEnd() : obj.getEnd() - 1;
            const preComma = obj.properties.length > 0 ? ', ' : '';
            update.insertRight(insertPos, `${preComma} "compilerOptions": { "paths": { "${apiName}": ["${apiPath}"] } }`);
        } else {
            const coObj = coProp.initializer as ts.ObjectLiteralExpression;
            const pathsProp = coObj.properties.find((prop) => 'text' in prop.name && prop.name.text === 'paths') as ts.PropertyAssignment;
            if (pathsProp) {
                const pathsObj = pathsProp.initializer as ts.ObjectLiteralExpression;
                const insertPos =
                    pathsObj.properties.length > 0 ? pathsObj.properties[pathsObj.properties.length - 1].getEnd() : pathsObj.getEnd() - 1;
                const preComma = pathsObj.properties.length > 0 ? ', ' : '';
                update.insertRight(insertPos, `${preComma} "${apiName}": ["${apiPath}"]`);
            } else {
                const insertPos = coObj.properties.length > 0 ? coObj.properties[coObj.properties.length - 1].getEnd() : coObj.getEnd() - 1;
                const preComma = coObj.properties.length > 0 ? ', ' : '';
                update.insertRight(insertPos, `${preComma} "paths": { "${apiName}": ["${apiPath}"] }`);
            }
        }
        tree.commitUpdate(update);
    };
}

function updateAppComponent(rendererProject: string, apiName: string) {
    return async (tree: Tree, context: SchematicContext) => {
        const apiUse = `const api = ((window as any) as CustomWindow).api;
if (api) {
    api.onMainMessage((msg) => console.log('Got message from main:', msg));
    api.sendToMain('Message from renderer!');
}`;
        const workspace = await getWorkspace(tree);
        const appComponentPath = join(normalize(workspace.projects.get(rendererProject).sourceRoot), 'app/app.component.ts');
        if (!tree.exists(appComponentPath)) {
            context.logger.warn(`App component file "${appComponentPath}" not found. Cannot add example code for API usage.`);
            context.logger.warn(`Example:`);
            context.logger.warn(`import { CustomWindow } from '${apiName}';`);
            context.logger.warn(apiUse);
            return;
        }
        const fileContent = tree.read(appComponentPath).toString('utf8');
        const file = ts.createSourceFile(appComponentPath, fileContent, ts.ScriptTarget.Latest, true);
        const update = tree.beginUpdate(appComponentPath);
        const classDec = findNodes(file, ts.SyntaxKind.ClassDeclaration);
        if (classDec.length > 1) {
            context.logger.warn(`Multiple classes found in "${appComponentPath}". Cannot add example code for API usage.`);
            context.logger.warn(`Example:`);
            context.logger.warn(`import { CustomWindow } from '${apiName}';`);
            context.logger.warn(apiUse);
            return;
        }
        const constr = findNodes(classDec[0], ts.SyntaxKind.Constructor) as ts.MethodDeclaration[];
        if (constr.length === 0) {
            update.insertLeft(classDec[0].getEnd() - 1, `\nconstructor() {\n${apiUse}\n}`);
        } else {
            update.insertLeft(constr[0].getEnd() - 1, `\n${apiUse}\n`);
        }

        const c = insertImport(file, appComponentPath, 'CustomWindow', apiName) as InsertChange;
        if (c.toAdd) {
            update.insertLeft(c.pos, c.toAdd);
        }
        tree.commitUpdate(update);
    };
}

function createRendererProject(name: string, context: SchematicContext): Rule {
    context.logger.info('Creating Angular project as renderer project:');
    return externalSchematic('@schematics/angular', 'application', {
        name,
    });
}

function addMainFiles(appDir: string, root: string, enableNodeIntegration: boolean): Rule {
    return chain([
        mergeWith(
            apply(url('./files/main'), [
                applyTemplates({ relativePathToWorkspaceRoot: relativePathToWorkspaceRoot(appDir), enableNodeIntegration }),
                move(root),
            ])
        ),
        enableNodeIntegration ? noop() : mergeWith(apply(url('./files/main-preload'), [move(root)])),
    ]);
}

function addElectronFiles(appName: string, root: string): Rule {
    return mergeWith(apply(url('./files/electron'), [applyTemplates({ appName }), move(root)]));
}

function updateRendererProject(name: string): Rule {
    return updateWorkspaceExtended((workspace) => {
        const rendererProject = workspace.projects.get(name);
        rendererProject.targets.get('build').builder = '@angular-builders/custom-webpack:browser';
        return mergeWith(apply(url('./files/renderer'), [move(rendererProject.root)]));
    });
}

function addTscMainTarget(rendererName: string, enableNodeIntegration: boolean): Rule {
    return updateWorkspaceExtended((workspace) => {
        const rendererProject = workspace.projects.get(rendererName);
        const appDir = relativeRoot(rendererProject.root, 'main');
        const root = `${appDir}/`;
        const sourceRoot = join(normalize(root), 'src');
        rendererProject.targets.add({
            name: 'main-build',
            builder: '@da-mkay/ng-builder-typescript:build',
            options: {
                outputPath: `dist/${rendererName}-main`,
                tsConfig: `${root}tsconfig.json`,
            },
            configurations: {
                production: {
                    fileReplacements: [
                        {
                            replace: `${sourceRoot}/environments/environment.ts`,
                            with: `${sourceRoot}/environments/environment.prod.ts`,
                        },
                    ],
                },
            },
        });
        return addMainFiles(appDir, root, enableNodeIntegration);
    });
}

function addWebpackMainTarget(rendererName: string, enableNodeIntegration: boolean): Rule {
    return updateWorkspaceExtended((workspace) => {
        const rendererProject = workspace.projects.get(rendererName);
        const appDir = relativeRoot(rendererProject.root, 'main');
        const root = `${appDir}/`;
        const sourceRoot = join(normalize(root), 'src');
        rendererProject.targets.add({
            name: 'main-build',
            builder: '@richapps/ngnode:build',
            options: {
                outputPath: `dist/${rendererName}-main`,
                main: enableNodeIntegration ? `${sourceRoot}/main.ts` : [`${sourceRoot}/main.ts`, `${sourceRoot}/preload.ts`],
                tsConfig: `${root}tsconfig.json`,
                webpackConfigObject: {
                    externals: getWebpackExternals(),
                    node: {
                        __dirname: false,
                        __filename: false,
                    },
                },
            },
            configurations: {
                production: {
                    fileReplacements: [
                        {
                            replace: `${sourceRoot}/environments/environment.ts`,
                            with: `${sourceRoot}/environments/environment.prod.ts`,
                        },
                    ],
                },
            },
        });
        return addMainFiles(appDir, root, enableNodeIntegration);
    });
}

function addTscMainProject(name: string, enableNodeIntegration: boolean): Rule {
    return async (tree: Tree, context: SchematicContext) => {
        const { appDir, root, sourceRoot } = await generateProjectPaths(tree, name);

        return chain([
            updateWorkspaceExtended((workspace) => {
                workspace.projects.add({
                    name,
                    projectType: ProjectType.Application,
                    root,
                    sourceRoot,
                    targets: {
                        build: {
                            builder: '@da-mkay/ng-builder-typescript:build',
                            options: {
                                outputPath: `dist/${name}`,
                                tsConfig: `${root}tsconfig.json`,
                            },
                            configurations: {
                                production: {
                                    fileReplacements: [
                                        {
                                            replace: `${sourceRoot}/environments/environment.ts`,
                                            with: `${sourceRoot}/environments/environment.prod.ts`,
                                        },
                                    ],
                                },
                            },
                        },
                    },
                });
            }),
            addMainFiles(appDir, root, enableNodeIntegration),
        ]);
    };
}

function addWebpackMainProject(name: string, enableNodeIntegration: boolean): Rule {
    return async (tree: Tree, context: SchematicContext) => {
        const { appDir, root, sourceRoot } = await generateProjectPaths(tree, name);

        return chain([
            updateWorkspaceExtended((workspace) => {
                workspace.projects.add({
                    name,
                    projectType: ProjectType.Application,
                    root,
                    sourceRoot,
                    targets: {
                        build: {
                            builder: '@richapps/ngnode:build',
                            options: {
                                outputPath: `dist/${name}`,
                                main: enableNodeIntegration
                                    ? `${sourceRoot}/main.ts`
                                    : [`${sourceRoot}/main.ts`, `${sourceRoot}/preload.ts`],
                                tsConfig: `${root}tsconfig.json`,
                                webpackConfigObject: {
                                    externals: getWebpackExternals(),
                                    node: {
                                        __dirname: false,
                                        __filename: false,
                                    },
                                },
                            },
                            configurations: {
                                production: {
                                    fileReplacements: [
                                        {
                                            replace: `${sourceRoot}/environments/environment.ts`,
                                            with: `${sourceRoot}/environments/environment.prod.ts`,
                                        },
                                    ],
                                },
                            },
                        },
                    },
                });
            }),
            addMainFiles(appDir, root, enableNodeIntegration),
        ]);
    };
}

function addElectronTargets(rendererName: string): Rule {
    return updateWorkspaceExtended((workspace) => {
        const rendererProject = workspace.projects.get(rendererName);
        const appDir = relativeRoot(rendererProject.root, 'electron');
        const root = `${appDir}/`;
        const sourceRoot = join(normalize(root), 'src');

        rendererProject.targets.add({
            name: 'electron-build',
            builder: '@da-mkay/ng-builder-electron:build',
            options: {
                outputPath: `dist/${rendererName}-electron`,
                packageJsonPath: `${sourceRoot}/package.json`,
                main: 'main/main.js',
                mainTarget: {
                    target: `${rendererName}:main-build`,
                    options: {
                        outputPath: `dist/${rendererName}-electron/main`,
                    },
                },
                rendererTargets: [
                    {
                        target: `${rendererName}:build`,
                        options: {
                            outputPath: `dist/${rendererName}-electron/renderer`,
                            baseHref: './index.html',
                            customWebpackConfig: {
                                path: relativeRoot(rendererProject.root, 'webpack_electron.config.js'),
                            },
                        },
                    },
                ],
            },
            configurations: {
                production: {
                    mainTargetOverrides: {
                        target: `${rendererName}:main-build:production`,
                    },
                    rendererTargetsOverrides: [
                        {
                            target: `${rendererName}:build:production`,
                        },
                    ],
                },
            },
        });
        rendererProject.targets.add({
            name: 'electron-serve',
            builder: '@da-mkay/ng-builder-electron:serve',
            options: {
                buildTarget: {
                    target: `${rendererName}:electron-build`,
                    options: {
                        outputPath: `dist/${rendererName}-electron-serve`,
                        mainTarget: {
                            options: {
                                outputPath: `dist/${rendererName}-electron-serve/main`,
                                watch: true,
                            },
                        },
                        rendererTargets: [
                            {
                                options: {
                                    outputPath: `dist/${rendererName}-electron-serve/renderer`,
                                    watch: true,
                                },
                            },
                        ],
                    },
                },
            },
            configurations: {
                production: {
                    buildTargetOverrides: {
                        target: `${rendererName}:electron-build:production`,
                    },
                },
            },
        });
        rendererProject.targets.add({
            name: 'electron-package',
            builder: '@da-mkay/ng-builder-electron:package',
            options: {
                buildTarget: {
                    target: `${rendererName}:electron-build`,
                    options: {
                        outputPath: `dist/${rendererName}-electron-package/app`,
                        mainTarget: {
                            options: {
                                outputPath: `dist/${rendererName}-electron-package/app/main`,
                            },
                        },
                        rendererTargets: [
                            {
                                options: {
                                    outputPath: `dist/${rendererName}-electron-package/app/renderer`,
                                },
                            },
                        ],
                    },
                },
                electronBuilderConfig: {
                    config: {
                        appId: 'some.app.id',
                        directories: {
                            app: `dist/${rendererName}-electron-package/app`,
                            output: `dist/${rendererName}-electron-package/pkg`,
                        },
                    },
                },
            },
            configurations: {
                production: {
                    buildTargetOverrides: {
                        target: `${rendererName}:electron-build:production`,
                    },
                },
            },
        });
        return addElectronFiles(rendererName, root);
    });
}

function addElectronProject(appName: string, name: string, mainName: string, rendererName: string): Rule {
    return async (tree: Tree, context: SchematicContext) => {
        const { workspace, root, sourceRoot } = await generateProjectPaths(tree, name);
        const renderRoot = workspace.projects.get(rendererName).root;

        return chain([
            updateWorkspaceExtended((workspace) => {
                workspace.projects.add({
                    name,
                    projectType: ProjectType.Application,
                    root,
                    sourceRoot,
                    targets: {
                        build: {
                            builder: '@da-mkay/ng-builder-electron:build',
                            options: {
                                outputPath: `dist/${name}`,
                                packageJsonPath: `${sourceRoot}/package.json`,
                                main: 'main/main.js',
                                mainTarget: {
                                    target: `${mainName}:build`,
                                    options: {
                                        outputPath: `dist/${name}/main`,
                                    },
                                },
                                rendererTargets: [
                                    {
                                        target: `${rendererName}:build`,
                                        options: {
                                            outputPath: `dist/${name}/renderer`,
                                            baseHref: './index.html',
                                            customWebpackConfig: {
                                                path: `${renderRoot}/webpack_electron.config.js`,
                                            },
                                        },
                                    },
                                ],
                            },
                            configurations: {
                                production: {
                                    mainTargetOverrides: {
                                        target: `${mainName}:build:production`,
                                    },
                                    rendererTargetsOverrides: [
                                        {
                                            target: `${rendererName}:build:production`,
                                        },
                                    ],
                                },
                            },
                        },
                        serve: {
                            builder: '@da-mkay/ng-builder-electron:serve',
                            options: {
                                buildTarget: {
                                    target: `${name}:build`,
                                    options: {
                                        outputPath: `dist/${name}-serve`,
                                        mainTarget: {
                                            options: {
                                                outputPath: `dist/${name}-serve/main`,
                                                watch: true,
                                            },
                                        },
                                        rendererTargets: [
                                            {
                                                options: {
                                                    outputPath: `dist/${name}-serve/renderer`,
                                                    watch: true,
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                            configurations: {
                                production: {
                                    buildTargetOverrides: {
                                        target: `${name}:build:production`,
                                    },
                                },
                            },
                        },
                        package: {
                            builder: '@da-mkay/ng-builder-electron:package',
                            options: {
                                buildTarget: {
                                    target: `${name}:build`,
                                    options: {
                                        outputPath: `dist/${name}-package/app`,
                                        mainTarget: {
                                            options: {
                                                outputPath: `dist/${name}-package/app/main`,
                                            },
                                        },
                                        rendererTargets: [
                                            {
                                                options: {
                                                    outputPath: `dist/${name}-package/app/renderer`,
                                                },
                                            },
                                        ],
                                    },
                                },
                                electronBuilderConfig: {
                                    config: {
                                        appId: 'some.app.id',
                                        directories: {
                                            app: `dist/${name}-package/app`,
                                            output: `dist/${name}-package/pkg`,
                                        },
                                    },
                                },
                            },
                            configurations: {
                                production: {
                                    buildTargetOverrides: {
                                        target: `${name}:build:production`,
                                    },
                                },
                            },
                        },
                    },
                });
            }),
            addElectronFiles(appName, root),
        ]);
    };
}

async function getAngularProjects(tree: Tree) {
    const workspace = await getWorkspace(tree);
    const angularProjects = Array.from(workspace.projects.entries())
        .filter(([, projectDef]) => {
            const buildTarget = projectDef.targets.get('build');
            if (!buildTarget) {
                return false;
            }
            return (
                buildTarget.builder === '@angular-devkit/build-angular:browser' ||
                buildTarget.builder === '@angular-builders/custom-webpack:browser'
            );
        })
        .map(([name]) => name);
    return angularProjects;
}

function getWebpackExternals(): { [mod: string]: string } {
    return NODE_BUILD_IN_MODULES.reduce(
        (acc, cur) => {
            acc[cur] = `commonjs ${cur}`;
            return acc;
        },
        { electron: 'commonjs electron' }
    );
}

function updateWorkspaceExtended(updater: (workspace: WorkspaceDefinition) => Rule | Promise<Rule> | void | Promise<void>) {
    return async (tree: Tree, context: SchematicContext) => {
        const workspace = await getWorkspace(tree);
        const rule = await updater(workspace);
        const updateWS = updateWorkspace(workspace);
        return chain([updateWS, rule ? rule : noop()]);
    };
}

async function generateProjectPaths(tree: Tree, name: string) {
    const workspace = await getWorkspace(tree);
    const newProjectRoot = (workspace.extensions.newProjectRoot as string) || '';
    const appDir = join(normalize(newProjectRoot), strings.dasherize(name));
    const root = appDir ? `${appDir}/` : appDir;
    const sourceRoot = join(normalize(root), 'src');
    return { workspace, appDir, root, sourceRoot };
}

function relativeRoot(root: string, path: string) {
    // avoid path starting with '/'
    return (root ? `${root}/` : '') + path;
}
