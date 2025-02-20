<img alt="Classy!" src="https://raw.githubusercontent.com/sleelin/classy-template/e5614dd52986e1b6187c6d36693564a6c8f1da8d/assets/logo.svg" width="512" />

**Classy!** A reimplementation of the default JSDoc template, adding context-aware inferred ES6 class syntax doclet tags like static, alias, memberOf, and constructs for nested API classes.

> Visit the <a href="https://sleelin.github.io/classy-template/" target="_blank">Example Documentation</a> to see how it looks!

##### Features

* Inferred context for ES6 class members/methods, as well as default values.
* Structured page navigation that matches nested ES6 API classes.
* Table of contents for each page, automatically sourced from documentation contents.
* Optionally link to git-hosted source files instead of generating extra source pages.
* Automatically updates the API section of supplied README in generated index page.
* Minimal external dependencies for generated documentation.
* Native support for small viewport sizes.

##### Requirements

* [Node.js](https://nodejs.org) v16+ with NPM 7+, as this template relies heavily on modern syntax features like nullish coalescing, and arrow functions.
* [JSDoc 4.0.2](https://github.com/jsdoc/jsdoc) as this was the most recent published version at the time of release, however it is also backwards-compatible with JSDoc 3.6.x.
* [jsdom 25.0.1+](https://github.com/jsdom/jsdom) for sanitising parsed markdown and table of contents generation.

# Installation and Usage

Through NPM:

```
$ npm install --save-dev classy-template
```

Assuming you have JSDoc installed, you can then use this template without any further configuration:

```
$ /path/to/jsdoc -t ./node_modules/classy-template
```

# Configuration

This template works best when a JSDoc configuration file is supplied and additional template options are specified.
It also includes a JSDoc plugin for correcting some anomalous behaviour when documenting JavaScript classes.
Additionally, though not required, it is recommended you also use the JSDoc Markdown plugin as it provides extra structure to generated documentation.

Example `jsdoc.json` file:

```json
{
  "plugins": [
    "plugins/markdown",
    "classy-template/plugin"
  ],
  "source": {
    "include": [
      "src"
    ]
  },
  "opts": {
    "recurse": true,
    "template": "classy-template",
    "destination": "./docs",
    "readme": "./README.md",
    "package": "./package.json"
  },
  "markdown": {
    "idInHeadings": true
  },
  "templates": {
    "classy": {
      "name": "My Project",
      "icon": "assets/icon.svg",
      "logo": "assets/logo.png",
      "apiEntry": "MyProject",
      "showName": false,
      "showGitLink": true
    }
  }
}
```

## Options

**From This Template:**  
These are specified under the `classy` property under the templates part of the JSDoc configuration file. All values are optional.

* `name`: the text to use as the link to the index page, and as the alt-text for a configured logo.
  * If a package.json file is supplied to JSDoc, this defaults to the package name specified there.
  * Otherwise, defaults to "Home".
* `icon`: path to an image to use as the favicon for each page.
  * Should ideally be an SVG or icon file.
  * The image will automatically be included in the assets directory of the generated output.
  * If not specified, no favicon will be included in generated pages.
* `logo`: path to an image to use as the logo inside the link to the index page.
  * Should be at least 36px tall, and ideally 36px wide.
  * The image will automatically be included in the assets directory of the generated output.
  * If not specified, no logo will be included in generated page headers.
* `apiEntry`: full name of a namespace or class that acts as the entry point (default export) of your package.
  * The namespace or class should be identified with a JSDoc `@name`, `@namespace`, `@class`, or `@alias` tag with the same value.
  * When specified, classy will attempt to generate a structured "API" section in the navigation menu, with member namespaces and classes included.
  * If a README file is supplied to JSDoc, and it includes an "API" heading, classy will automatically replace all content between the "API" heading and the next heading it finds with the contents of the entry point's `@description` JSDoc
    tag _in the generated index page_ (it will _not_ modify your README file).
  * If an entry point is specified, but no README is supplied, the contents of the entry point's `@description` JSDoc tag will be used as the generated index page content.
* `showName`: whether the name text should be included alongside the logo in the index page link.
  * If no logo has been specified, this option will be ignored and the name will be shown in the header.
  * Defaults to true, and the name will only be hidden from the index link if this is set to the boolean value false.
* `showLogo`: whether the logo should be displayed in the index page link.
  * If no logo has been specified, this option will be ignored and the name will be shown in the header.
  * Defaults to true if a logo has been specified, and the logo will only be hidden from the index link if this is set to the boolean value false.
* `showVersion`: whether the package version should be included after the index page link.
  * If no package.json file is supplied to JSDoc, this option will be ignored and no version will be included in the header.
  * Defaults to true, and the version will only be hidden from the header if this is set to the boolean value false, or no package.json file is supplied.
* `showGitLink`: whether the git repository host logo should be shown as a link to the repository in the header.
  * If no package.json file is supplied to JSDoc, this option will be ignored and no logo will be included in the header.
  * Defaults to true, and the git host logo/link will only be hidden from the header if this is set to the boolean value false, or no package.json file is supplied.
  * Currently supported git hosts are GitHub, Bitbucket, and GitLab, and any other host will be ignored and no logo will be shown.

**From Default Template:**  
Options available under the `default` JSDoc template configuration may also be used to customise the appearance and content of generated documentation.

* `includeDate`: whether to include the date the documentation was generated in the footer of a page. Defaults to true.
* `useLongnameInNav`: whether to use a symbol's long name for its navigation menu entry. Defaults to false.
* `layoutFile`: path to a custom template file to use for the overall layout of all generated documentation pages. Defaults to classy's layout file.
* `outputSourceFiles`: whether to include links to hosted git source files, or generate and link to pages for each source file being documented.
  * If undefined, source file links will point to hosted git source files.
  * If true, source file links will point to generated source file pages.
  * If false, source file links and generated pages will be disabled.
* `staticFiles`: any additional files to be copied to the static folder in the output directory.
  * As with the default template, files and directories should be specified under the `include`, `includePattern`, `exclude`, and `excludePattern` child properties.