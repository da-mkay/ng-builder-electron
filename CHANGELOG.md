# Changelog

## Version 0.2.0, 2020-03-25

### `build` builder:

-   feat: added options `mainTargetOverrides` and `rendererTargetsOverrides` that allow to override parts of options `mainTarget` and `rendererTargets`, respectively. Useful when using configurations in angular.json.

### `serve` builder:

-   feat: added option `buildTargetOverrides` that allows to override parts of option `buildTarget`. Useful when using configurations in angular.json.

### `package` builder:

-   feat: added option `buildTargetOverrides` that allows to override parts of option `buildTarget`. Useful when using configurations in angular.json.

### `app` schematic:

-   feat: use new options `mainTargetOverrides`, `rendererTargetsOverrides` and `buildTargetOverrides` which allows to use non-production and production builds when serving and packaging an electron app.

## Version 0.1.0, 2020-03-21

### `app` schematic:

-   feat: added production config for main project

### `ng-add` schematic:

-   feat: log warning when electron installation is skipped
