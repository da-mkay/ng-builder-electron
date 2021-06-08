# @da-mkay/ng-builder-electron

Inspired by @richapps/ngtron, this set of builders and schematics allows you to build electron apps using the Angular CLI.

> **So what's the difference to @richapps/ngtron?** While @richapps/ngtron does all its magic in the background, @da-mkay/ng-builder-electron is highly configurable. It allows you to configure each and every part of the build process, but it also requires you to do so. Luckily, most - if not all - configuration is done by schematics automatically to get started.\
> And why should I care about configurability? For example, it allows you to choose any builder for your renderer and main project and you can use any of the builder's configuration options.

## Versions

This version of @da-mkay/ng-builder-electron requires Angular 12. Use the tag `ng12` when installing this version, like so:\
`ng add @da-mkay/ng-builder-electron@ng12`

For other Angular versions take a look at the table below or at the [Versions page](https://www.npmjs.com/package/@da-mkay/ng-builder-electron?activeTab=versions).
| Angular Version | Tag for @da-mkay/ng-builder-electron |
| --------------- | ---------------------------------------|
| Angular 12      | ng12                                   |
| Angular 11      | ng11                                   |
| Angular 10      | ng10                                   |
| Angular 9       | ng9                                    |
| Angular 8       | ng8                                    |


## Table of Contents

-   [Quickstart](#quickstart)
-   [General information](#general-information)
-   [Usage](#usage)
    -   [Create electron app from scratch (multiple projects, recommended)](#create-electron-app-from-scratch-multiple-projects-recommended)
    -   [Create electron app from scratch (single project)](#create-electron-app-from-scratch-single-project)
    -   [Reuse an existing Angluar project as renderer project](#reuse-an-existing-angluar-project-as-renderer-project)
-   [Additional topics](#additional-topics)
    -   [Webpack externals](#webpack-externals)
    -   [Include node modules in the electron app package](#include-node-modules-in-the-electron-app-package)
-   [F.A.Q.](#faq)
    -   [Why does my screen keeps white when a soft-reload is performed?](#why-does-my-screen-keeps-white-when-a-soft-reload-is-performed)
-   [App-schematic options](#app-schematic-options)
-   [Builder options](#builder-options)
    -   [Builder: build](#builder-build)
    -   [Builder: serve](#builder-serve)
    -   [Builder: package](#builder-package)
-   [Changelog](#changelog)

## Quickstart

To quickly generate a new electron app perform the following steps. See the documentation below for further information.

Create a new empty Angular workspace, then install @da-mkay/ng-builder-electron:

    $ ng new myworkspace --create-application=false
    $ cd myworkspace
    $ ng add @da-mkay/ng-builder-electron@ng12

(Using the tag `ng12`, the Angular 12 compatible version will be installed)

Then create your Angular app.

    $ ng generate @da-mkay/ng-builder-electron:app

It will ask you for a name for your projects. Type `myapp` and hit enter.\
When prompted for other information you can simply hit enter to use the default values. Read below for more information.

Now it's time to run your new electron app:

    $ ng serve myapp-electron

Each time you change your code the electron window will reload or the electron process will be restarted.

To create an app package for your electron app run the following command:

    $ ng run myapp-electron:package

Now, you can find your app package in `dist/myapp-electron-package/pkg`.

## General information

An electron app built with @da-mkay/ng-builder-electron consists of three parts:

1. **Main project**:\
   The main project is a Node.js application (typically written in typescript) that will be run in electron's main process. It opens a renderer project in an electron window (See the [electron docs](https://www.electronjs.org/docs/tutorial/quick-start#main-and-renderer-processes) on more information about main and renderer process).

2. **Renderer project**:\
   The renderer project is a web application that will be opened in an electron window, i.e. it runs in a renderer process. This project is usually an Angular application.

3. **Electron project**:\
   The electron project simply holds a package.json file and possibly other resources. That package.json file will be used as the base for the final package.json of your electron app. For example, the `main` property required by electron will be added automatically such that it points to your entry-file of your main project. The package.json file is also used when packaging the electron app using `electron-builder`.\
   For example, you can manually add dependencies here that will be copied by `electron-builder` from the node_modules folder to your final app (although there is also an automatic mechanism for that, see below).

@da-mkay/ng-builder-electron comes with an app schematic that sets up these projects for you automatically. Check the examples in the [Usage](#usage) chapter below.

The electron project generated by the app schematic uses the following three builders of @da-mkay/ng-builder-electron:

1. **build**:\
   It builds the main and renderer projects into the same output folder (if configured accordingly) and writes a package.json (based on the one of your electron project) to that same output folder.
   Now, the tool `depcheck` is run on that folder to check which dependencies your code is using and it will add those dependencies to the created package.json.
2. **serve**:\
   It does pretty much the same as the `build` builder (no `depcheck` is used though). However, it must be configured to run the builds of the main and renderer project in watch-mode. Thus, each time the main project or renderer project is changed, the corresponding project starts rebuilding. When all projects are built, the app is started using electron. If the code is changed, then electron is re-started or the windows are reloaded, depending of what was changed (main or renderer code).
3. **package**:\
   The `package` builder simply runs the build target that uses the `build` builder described above. When it's done, you have a folder containing your full app code. Finally, `electron-builder` is run on that output folder to generate the final electron app package.

## Usage

### Create electron app from scratch (multiple projects, recommended)

First, create a new **_empty_** Angular workspace:

    $ ng new myworkspace --create-application=false
    $ cd myworkspace

To install the builder and schematics, simply use `ng add`:

    $ ng add @da-mkay/ng-builder-electron@ng12

If you do not have electron in your package.json's dependencies it will ask you which version to install. Once installed, it will check which version of `@types/node` package is installed and compare it to the Node.js version used by the installed electron version. If they do not match, it will ask you whether it should install the correct one.

Now you can create a new electron app using the app schematic:

    $ ng generate @da-mkay/ng-builder-electron:app

It will ask you a few questions:

1. First, it asks for the name to use for the projects that will be created. If you enter `myapp` the following three projects will be created: `myapp-electron`, `myapp-renderer` and `myapp-main`.\
   The `*-main` project is a Node.js app written in typescript that will run in electrons main process. The `*-renderer` project is a normal Angular app that will be shown in an electron window. The `*-electron` project simply holds the package.json that will be used as a base when generating the final package.json for the electron app (see [General information](#general-information)).
2. The second question is about the builder that should be used for the main project. @da-mkay/ng-builder-typescript will simply use the typescript compiler to compile the code. If you will have a more complex main project then you can also use @richapps/ngnode, which uses webpack to bundle the main project. (At the time this version of @da-mkay/ng-builder-electron was released, @richapps/ngnode was not yet fully Angular 12 compatible)
3. Finally, the Angular app schematic is started to create an Angular application as the renderer project. The questions that appear (about Angular routing, sylesheet format etc.) are standard Angular questions.

You are now ready to serve the electron app:

    $ ng serve myapp-electron

It will build your main and renderer projects and once done, run electron on the output folder. It will also watch your files for changes. In case the main project changes, a hot reload is performed, i.e. the electron-process is re-spawned. In case the renderer project changes, a soft reload is performed, i.e. all electron-windows are reloaded.

Use the `production` configuration to build the renderer and main project using their `production` configurations:

    $ ng serve myapp-electron --configuration=production

To create an electron app package run:

    $ ng run myapp-electron:package

You may want to customize the `electron-builder` options in your angular.json, for example to define what kind of app package should be created (zip, dmg, ..., see [electron-builder docs](https://www.electron.build/configuration/configuration))

Again, pass `--configuration=production` to the `package` task to build the renderer and main project using their `production` configurations.

### Create electron app from scratch (single project)

First, create a new **_empty_** Angular workspace:

    $ ng new myworkspace --create-application=false
    $ cd myworkspace

To install the builder and schematics, simply use `ng add`:

    $ ng add @da-mkay/ng-builder-electron@ng12

Again (see above) it may ask you to install electron and appropriate `@types/node` package.

Now you can create a new electron app using the app schematic:

    $ ng generate @da-mkay/ng-builder-electron:app --single-project

It will ask you a few questions:

1. First, it asks for the name to use for the project that will be created.\
   That project will be a regular Angular app having the additional two sub folders `main` and `electron`. The `main` folder holds the typescript code for a Node.js app that will run in electrons main process. The `electron` folder simply holds the package.json that will be used as a base when generating the final package.json for the electron app (see [General information](#general-information)).
2. The second question is about the builder that should be used for the main code. @da-mkay/ng-builder-typescript will simply use the typescript compiler to compile the code. If you will have a more complex main code then you can also use @richapps/ngnode, which uses webpack to bundle the code. (At the time this version of @da-mkay/ng-builder-electron was released, @richapps/ngnode was not yet fully Angular 12 compatible)
3. Finally, the Angular app schematic is started to create an Angular application. The questions that appear (about Angular routing, sylesheet format etc.) are standard Angular questions.

You are now ready to serve the electron app:

    $ ng run myapp:electron-serve

It will compile your main code and the Angular project and once done, run electron on the output folder. It will also watch your files for changes. In case the main code changes, a hot reload is performed, i.e. the electron-process is re-spawned. In case the Angular project changes, a soft reload is performed, i.e. all electron-windows are reloaded.

Use the `production` configuration to build the renderer and main code using their `production` configurations:

    $ ng run myapp:electron-serve --configuration=production

To create an electron app package run:

    $ ng run myapp:electron-package

You may want to customize the `electron-builder` options in your angular.json, for example to define what kind of app package should be created (zip, dmg, ..., see [electron-builder docs](https://www.electron.build/configuration/configuration)).

Again, pass `--configuration=production` to the `package` task to build the renderer and main code using their `production` configurations.

### Reuse an existing Angluar project as renderer project

If you already have an Angular project called `PROJECT_NAME`, you can turn it into an electron app by passing `--renderer-project=PROJECT_NAME` to the app schematic. In that case, no new renderer project is created and instead your existing Angular project is used as renderer project.

Here are the examples of the last chapters with the `--renderer-project` option appended ...\
... using additional projects for the main code and electron resources:

```
$ ng add @da-mkay/ng-builder-electron@ng12
$ ng generate @da-mkay/ng-builder-electron:app --renderer-project=PROJECT_NAME
```

OR

... by putting main code and electron resources beneath your Angular project folder without creating additional projects:

```
$ ng add @da-mkay/ng-builder-electron@ng12
$ ng generate @da-mkay/ng-builder-electron:app --renderer-project=PROJECT_NAME --single-project
```

See the previous chapters on what exactly the difference is between using `--single-project` and not using it.

## Additional topics

### Webpack externals

When you use a builder for your renderer or main code, that uses webpack under the hood (the Angular builder or @richapps/ngnode), all dependencies that are used inside the code will automatically be included in the bundles created by webpack.\
Sometimes you don't want that. For example, when using built-in modules of Node.js. Those modules should not be bundled, because they are already available in the electron environment. Or maybe you want to use a native node module that cannot be bundled at all. In all those cases you can declare those modules in the webpack config as external and they will not be included in the bundle.\
When using the app schematic as described above, your renderer project (Angular project) and possibly a @richapps/ngnode main project will already be set up with a list of externals. For example, `electron` and Node.js built-ins are added to the list of external modules. To add more modules to the list do the following:

For Angular projects adjust the file `webpack_electron.config.js` inside the project's folder.\
For main projects using @richapps/ngnode adjust the main build target option `webpackConfigObject` in your angular.json.

If you declare a module as external, that module must be either available in the target environment (like Node.js built-in modules) or they must be included in the final electron app package, see next topic.

### Include node modules in the electron app package

When you use a third party node module in your code, that node module has to find its way into your electron app package. There are two ways to achieve that:

1. The module's code is bundled with your project code.\
   For example, Angular projects use webpack which will include the module in the generated bundle unless the module is declared as external (see last chapter). The same holds true for @richapps/ngnode, which can be used for the main code.
2. The node module is copied to the electron app's node_modules folder.

Let's talk about that second case.\
When running the electron package task of your project, it first runs the configured electron build task which in turn compiles the code for the main and renderer process and creates a package.json in the same output folder (see [General information](#general-information)).\
The package.json of your electron project is taken as a base for that.\
The electron build builder also runs the `depcheck` tool on the output folder to detect the dependencies that are used in the code. Those dependencies are added to the package.json.\
Now, when running the electron package builder, `electron-builder` will be started which will take care of including the dependencies of the package.json into the final app.

Maybe that's not enough and you need to add a dependency manually. Then just do that. You can always add dependencies manually to the package.json of your electron project. Since that package.json is used as a base for the final package.json, `electron-builder` will take these dependencies into account.

## F.A.Q.

### Why does my screen keeps white when a soft-reload is performed?

In case you use Angular's router, it will change your window's location. Since a `file://` URL is used for electron it is important that the filename, i.e. `index.html`, stays in the URL. This requires you to use Angular's `HashLocationStrategy`. If you don't use `HashLocationStrategy`, the window's location may change to a URL that cannot be loaded by electron, resulting in a white screen.

## App-schematic options

**name**: `string`\
The base name of the created projects. If `singleProject` is `false`, the name is used as a prefix for the renderer-, main- and electron-project. If `singleProject` is `true`, this name is used as the name of the renderer project.

**singleProject**: `boolean`\
(default: `false`)\
When set to `false`, multiple projects will be created (electron project, main project, renderer project). When set to `true`, one project will be created (or an existing will be used, see `rendererProject`) for the renderer and the files for electron and the main code will be put beneath the renderer project folder.

**rendererProject**: `string`\
When set to a project name, use that project as the renderer project and do not create a new one.

**mainBuilder**: `'@da-mkay/ng-builder-typescript' | '@richapps/ngnode'`\
(default: `'@da-mkay/ng-builder-typescript'`)\
The builder to use for the code that will be run in electron's main process. Use '@da-mkay/ng-builder-typescript' if you plan to create a simple main project (uses just a typescript compiler). Use '@richapps/ngnode' if your main project will be more complex (uses webpack to bundle the project). (At the time this version of @da-mkay/ng-builder-electron was released, @richapps/ngnode was not yet fully Angular 12 compatible)

**enableNodeIntegration**: `boolean`\
(default: `false`)\
If set to `false` (recommended) nodeIntegration will not be enabled. An example preload file will be created that provides functionalities to the renderer process that require Node.js. If set to `true`, nodeIntegration will be enabled. Thus, you will be able to use Node.js modules in the renderer process.

## Builder options

### Builder: build

**outputPath**: `string`\
 (required)\
 The path relative to the workspace root where the final package.json will be written to. The main and renderer targets should be configured to place its output beneath that outputPath.

**packageJsonPath**: `string`\
 (required)\
 The path of the package.json relative to the workspace root. That file is used as a base for the final package.json. The `main` property in the package.json will be set automatically based on the builder config.

**main**: `string`\
 (required)\
 The path relative to the outputPath which will be used as electron's main file. This should fit your mainTarget configuration.

**mainTarget**: `string | { target: string, options?: object }`\
 (required)\
 The target that builds the project which will be run in electron's main process. Set to either a string (format: 'project:target[:config]') or an object having the properties `target` and `options`. The latter allows to override the options specified in the target configuration.

**mainTargetOverrides**: `string | { target?: string, options?: object }`\
Overrides for the `mainTarget` option. Can be used to override target name and/or part of the options. Useful when using configurations in your angular.json.

**rendererTargets**: `(string | {target: string, options?: object })[]`\
 (required)\
 An array of targets that build the projects which will be run in electron's renderer process. Each array item must be either a string (format: 'project:target[:config]') or an object having the properties `target` and `options`. The latter allows to override the options specified in the target configuration.

**rendererTargetsOverrides**: `(string | { target?: string, options?: object })[]`\
Overrides for the `rendererTargets` option. Can be used to override target name and/or part of the options. Useful when using configurations in your angular.json.

**cleanOutputPath**: `boolean`\
 (default: `true`)\
 Whether to clean the ouputPath before running the main and renderer targets.

**depcheck**: `boolean`\
 (default: `true`)\
 Whether to run depcheck on the outputPath to find used dependencies that will be automatically taken from the root package.json and added to the final package.json. Note that you can always manually add dependencies to your package.json (see `packageJsonPath`).

**depcheckOptions**: `boolean`\
 (default: `false`)\
 Options to pass to depcheck (see [depcheck docs](https://www.npmjs.com/package/depcheck)). If not provided depcheck's default options are used with `ignoreMatches` set to `['electron']`

### Builder: serve

**buildTarget**: `string | { target: string, options?: object }`\
 (required)\
The electron build target to take the options from which will be used as a base for the serve. This is either a string using the format 'project:build-target[:config]' or an object having the properties `target` (in format 'project:build-target[:config]') and `options` (an object that will be merged with - not just override - the original options of the build target).\
For example, let's assume, the electron build target is configured with the following `mainTarget` option:

```json
"mainTarget": {
    "target": "myapp:main-build",
    "options": {
        "outputPath": "dist/myapp-electron/main"
    },
},
```

Now, let's define the `buildTarget` option for our serve target:

```json
"buildTarget": {
    "target": "myapp:electron-build",
    "options": {
        "mainTarget": {
            "options": {
                "watch": true
            }
        },
        // ...
    }
}
```

As you can see, we just specify `mainTarget.options` here, but no `mainTarget.target`. Moreover, we set only one option for the main target: `watch`, but no `outputPath`. The serve builder will now merge all these options and use the result, which looks like this:

```json
"buildTarget": {
    "target": "myapp:electron-build",
    "options": {
        "mainTarget": {
            "target": "myapp:main-build",
            "options": {
                "outputPath": "dist/myapp-electron/main",
                "watch": true
            }
        },
        // ...
    }
}
```

**buildTargetOverrides**: `string | { target?: string, options?: object }`\
Overrides for the `buildTarget` option. Can be used to override target name and/or part of the options. Useful when using configurations in your angular.json.

### Builder: package

**buildTarget**: `string | { target: string, options?: object }`\
 (required)\
The electron build target to run prior to packaging the electron app. This is either a string using the format 'project:build-target[:config]' or an object having the properties `target` (in format 'project:build-target[:config]') and `options` (an object that will be merged with - not just override - the original options of the build target). See above for how options are merged.

**buildTargetOverrides**: `string | { target?: string, options?: object }`\
Overrides for the `buildTarget` option. Can be used to override target name and/or part of the options. Useful when using configurations in your angular.json.

**electronBuilderConfig**: `object`\
 (required)\
The configuration options for `electron-builder` (see [electron-builder docs](https://www.electron.build/configuration/configuration)).

## Changelog

Check out [changelog on Github](https://github.com/da-mkay/ng-builder-electron/blob/main/CHANGELOG.md).