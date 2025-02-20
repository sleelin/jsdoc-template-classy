const fs = require("fs");
const path = require("path");
const env = require("jsdoc/env");
const helper = require("jsdoc/util/templateHelper");
const logger = require("jsdoc/util/logger");
const JSDocFS = require("jsdoc/fs");
const JSDocPath = require("jsdoc/path");
const JSDocTemplate = require("jsdoc/template").Template;
const JSDocFilter = require("jsdoc/src/filter").Filter;
const JSDocScanner = require("jsdoc/src/scanner").Scanner;
const {JSDOM} = require("jsdom");
const outdir = path.normalize(env.opts.destination);

/**
 * Utilities used to help prepare doclet pages for publishing
 * @namespace
 */
class PublishUtils {
    /**
     * Get the path to the template files, template configuration, and source files configuration for publishing
     * @param {String} templateName - name of the template supplied to JSDoc, for normalisation
     * @param {String} packageJsonPath - path to the package.json file of the package being documented
     * @param {String|PackageRepositoryData} packageRepository - value of the repository property in the package.json file
     * @returns {{templatePath: String, templateConfig: TemplateConfig, sourceFiles: SourceFilesData}}
     */
    static getPublishConfig(templateName, packageJsonPath, packageRepository) {
        // Normalise the template name into a usable path, and get some template config details
        const templatePath = (templateName === env.pwd || templateName.includes("node_modules") ? templateName : path.join(".", "node_modules", templateName));
        const {default: defaultConfig = {}, classy: classyConfig = {}} = env?.conf?.templates ?? {};
        
        /**
         * Template configuration, parsed and collated from JSDoc environment config
         * @typedef {Object.<string, any>} TemplateConfig
         * @property {DefaultTemplateConfig} default - configuration options for the default JSDoc template
         * @property {ClassyTemplateConfig} classy - configuration options for classy template
         */
        const templateConfig = Object.assign(env.conf.templates ?? {}, {
            /**
             * Configuration options for the default JSDoc template
             * @typedef {Object.<string, any>} DefaultTemplateConfig
             * @property {Boolean} includeDate - whether to include the date the documentation was generated in the footer of a page
             * @property {Boolean} outputSourceFiles - whether to generate, and link to, pages for each source file being documented
             * @property {Boolean} [useLongnameInNav] - whether to use a symbol's long name for its navigation menu entry
             * @property {String} [layoutFile] - path to the template file to use for the overall layout of a documentation page
             * @property {Object} [staticFiles] - any additional files to be copied to the static folder in the output directory
             * @property {String[]} [staticFiles.include] - a list of paths whose contents should be copied to the output directory
             * @property {String[]} [staticFiles.includePattern] - a list of regular expression indicating which specific files should be copied
             * @property {String[]} [staticFiles.exclude] - a list of paths that should not be copied to the output directory
             * @property {String[]} [staticFiles.excludePattern] - a list of regular expression indicating which specific files should be skipped
             */
            default: {
                ...defaultConfig,
                includeDate: defaultConfig?.includeDate ?? true,
                outputSourceFiles: defaultConfig?.outputSourceFiles,
                ...(defaultConfig?.layoutFile ? {layoutFile: defaultConfig.layoutFile} : {})
            },
            /**
             * Configuration options for classy template
             * @typedef {Object} ClassyTemplateConfig
             * @property {String} name - main page name
             * @property {String} icon - path to the icon, if a path was specified
             * @property {String} logo - path to the logo, if a path was specified
             * @property {String} apiEntry - name of doclet to treat as entrypoint of API, if specified
             * @property {Boolean} showName - whether to show the package name in the page header
             * @property {Boolean} showLogo - whether to show the package logo in the page header
             * @property {Boolean} showVersion - whether to show the package version in the page header
             * @property {Boolean} showGitLink - whether to show a link to the git repository in the page header
             */
            classy: {
                ...classyConfig,
                name: classyConfig.name ?? "Home",
                showName: classyConfig.showName ?? true,
                showLogo: classyConfig.showLogo ?? !!classyConfig.logo,
                showVersion: classyConfig.showVersion ?? true,
                showGitLink: classyConfig.showGitLink ?? true
            }
        });
        
        /**
         * Configuration details about whether to generate pages for, or link to hosted versions of source files
         * @typedef {HostedGitData} SourceFilesData
         * @property {Boolean} output - whether the source files should be generated as standalone pages
         * @property {String} line - prefix to use when linking to specific lines in source files
         */
        const sourceFiles = {
            output: templateConfig?.default?.outputSourceFiles !== false, line: "L",
            ...PublishUtils.getRepository(packageJsonPath, packageRepository)
        };
        
        // Return the collated config for publish
        return {templatePath, templateConfig, sourceFiles};
    }
    
    /**
     * Instantiate the JSDoc Template and make useful details available when rendering
     * @param {String} templatePath - path to the directory containing the template files
     * @param {TemplateConfig} templateConfig - template configuration, parsed and collated from JSDoc environment
     * @param {Salty} data - constructed and filtered dataset of JSDoc doclets
     * @param {PackageData} packageData - details about the package and template configuration
     * @param {SourceFilesData} sourceFiles - details about how source files are being handled
     * @returns {BootstrappedTemplate} an instance of a JSDoc Template, with useful details and methods added
     */
    static bootstrapTemplate(templatePath, templateConfig, data, packageData, sourceFiles) {
        const {default: {layoutFile} = {}} = templateConfig ?? {};
        const layout = !layoutFile ? "layout.tmpl" : JSDocPath.getResourcePath(path.dirname(layoutFile), path.basename(layoutFile));
        const find = (spec) => data(spec).get();
        const {linkto, htmlsafe, resolveAuthorLinks} = helper;
        const {typeString, linkTutorial, summarise, getMasterPath} = PublishUtils;
        const template = new JSDocTemplate(path.join(templatePath, "tmpl"));
        
        /**
         * @typedef {Template} BootstrappedTemplate
         * @property {String} layout - path to the file to use as the base layout of the template
         * @property {Function} find - method for querying and reading raw doclet data from within the template
         * @property {TemplateConfig} templateConfig - template configuration, parsed and collated from JSDoc environment
         * @property {PackageData} packageData - details about the package and template configuration
         * @property {SourceFilesData} sourceFiles - details about how source files are being handled
         * @property {typeof helper.linkto} linkto - method for linking to other doclet pages, from JSDoc template helper library
         * @property {typeof helper.htmlsafe} htmlsafe - method for rendering raw HTML safely, from JSDoc template helper library
         * @property {typeof helper.resolveAuthorLinks} resolveAuthorLinks - method for linking to a doclet's author, from JSDoc template helper library
         * @property {typeof PublishUtils#typeString} typeString - method for generating type strings, from PublishUtils class
         * @property {typeof PublishUtils#linkTutorial} linkTutorial - method for linking to tutorial pages, from PublishUtils class
         * @property {typeof PublishUtils#summarise} summarise - method for rendering doclet summaries, from PublishUtils class
         * @property {typeof PublishUtils#getMasterPath} getMasterPath - method for resolving the path to the master partial template to use when rendering a doclet page
         * @property {String} [boilerplateNav] - generated HTML for the main navigation menu of a page
         */
        return Object.assign(template, {
            // Expose doclets, package data, and source files to template
            layout, find, templateConfig, packageData, sourceFiles,
            // Expose useful helper functions to template
            linkto, htmlsafe, resolveAuthorLinks,
            // Expose useful PublishUtils functions and values to template
            typeString, linkTutorial, summarise, getMasterPath
        });
    }
    
    /**
     * Get the path to a partial template in the masters folder to use for the given kind of doclet page
     * @param {DocletPage} page - the doclet page being rendered, with a 'kind' property to map to a master partial template
     * @returns {String} the path to the partial template in the masters folder to use for the given kind of page
     */
    static getMasterPath({kind}) {
        // Default to using module template
        let name = "module";
        
        // Handle main and source pages
        if (["mainpage", "source", "tutorial"].includes(kind)) 
            name = kind;
        // Handle "class-like" pages
        if (DocletPage.classlike.includes(kind))
            name = "classlike";
        
        return `masters/${name}.tmpl`;
    }
    
    /**
     * Collect a list of static files required by a template, and copy them to the output location
     * @param {String} templatePath - path to the directory containing the template files
     * @param {Object} [defaultStatics] - static files specified by the JSDoc default template config for inclusion in output
     * @param {String[]} [defaultStatics.paths=[]] - list of paths to static files to be copied
     * @param {String[]} [defaultStatics.include=[]] - list of path filters to static files to be copied
     * @param {Object} [classyStatics] - static files specified by classy template config for inclusion in output
     * @param {String} [classyStatics.icon] - path to the icon file to be copied to output destination
     * @param {String} [classyStatics.logo] - path to the logo file to be copied to output destination
     * @param {String} [classyStatics.gitImage] - path to the git image file to be copied to output destination
     */
    static handleStatics(templatePath, defaultStatics, classyStatics) {
        // Get list of files to copy from template's static directory
        const fromDir = path.join(templatePath, "static");
        const staticFiles = JSDocFS.ls(fromDir, 3).map(sourcePath => ({sourcePath, fromDir}));
        
        // Get list of user-specified static files to copy
        if (defaultStatics?.constructor === Object) {
            const {paths = [], include: staticFilePaths = paths} = defaultStatics;
            const staticFileFilter = new JSDocFilter(defaultStatics);
            const staticFileScanner = new JSDocScanner();
            
            // Go through user-specified static files
            for (let filePath of staticFilePaths) {
                const fromDir = path.resolve(env.pwd, filePath);
                
                // Add the static file to the list
                staticFiles.push(...staticFileScanner
                    .scan([fromDir], 10, staticFileFilter)
                    .map(sourcePath => ({sourcePath, fromDir: JSDocFS.toDir(fromDir)})));
            }
        }
        
        // Add any logo or git image to list of static files
        if (classyStatics?.constructor === Object) {
            const {icon, logo, gitImage} = classyStatics;
            
            // Add the icon file to the list, if specified
            if (typeof icon === "string") {
                staticFiles.push({
                    sourcePath: path.resolve(env.pwd, icon.replace(/#.*$/, "")),
                    fileName: path.join("assets", `icon${path.extname(icon.replace(/#.*$/, ""))}`),
                    fromDir: JSDocFS.toDir(path.dirname(path.resolve(env.pwd, icon)))
                });
            }
            
            // Add the logo file to the list, if specified
            if (typeof logo === "string") {
                staticFiles.push({
                    sourcePath: path.resolve(env.pwd, logo.replace(/#.*$/, "")),
                    fileName: path.join("assets", `logo${path.extname(logo.replace(/#.*$/, ""))}`),
                    fromDir: JSDocFS.toDir(path.dirname(path.resolve(env.pwd, logo)))
                });
            }
            
            // Add the git image file to the list, if specified
            if (typeof gitImage === "string") {
                staticFiles.push({
                    sourcePath: path.join(templatePath, "assets", gitImage),
                    fileName: path.join("assets", gitImage),
                    fromDir: JSDocFS.toDir(path.join(templatePath, "assets"))
                });
            }
        }
        
        // Actually go through and copy the static files
        for (let {sourcePath, fromDir, fileName} of staticFiles) {
            const toDir = JSDocFS.toDir(sourcePath.replace(fromDir, path.join(outdir, "static")));
            
            JSDocFS.mkPath(path.join(toDir, path.dirname(fileName ?? "")));
            JSDocFS.copyFileSync(sourcePath, toDir, fileName);
        }
    }
    
    /**
     * Generate an HTML link to the specified tutorial
     * @param {Tutorial} t - tutorial to generate the link to
     * @returns {String} HTML link to the specified tutorial
     */
    static linkTutorial(t) {
        return helper.toTutorial(t, null, {tag: "em", classname: "disabled", prefix: "Tutorial: "});
    }
    
    /**
     * Wrap a doclet's summary tag in an unordered list element, if not already wrapped by one
     * @param {String} summary - contents of a doclet's summary tag to return as an unordered list element 
     * @returns {String} either the existing unordered list summary, or a newly created list with the summary as its only item
     */
    static summarise({summary}) {
        const fragment = JSDOM.fragment(summary);
        return (summary.startsWith("<ul>") ? fragment.firstElementChild.outerHTML : `<ul><li>${fragment.firstChild.innerHTML}</li></ul>`);
    }
    
    /**
     * Convert a given string (e.g. a doclet title or ID) into its simple plural form, excluding complex plurals (e.g. tooth/teeth)
     * @param {String} string - the string to be pluralised
     * @returns {String} the pluralised version of the supplied string, or the original if already plural
     */
    static pluralise(string) {
        return string.match(/[^s]s$/) ? string : `${string}s`.replace(/ys$/, "ies").replace(/([xs])s$/, "$1es");
    }
    
    /**
     * Generate all specified tutorials using the given template
     * @param {Tutorial[]} tutorials - tutorials whose content should be rendered
     */
    static generateTutorials({children = []}) {
        for (let tutorial of children) {
            // Construct the data from the tutorial to provide to the template
            const {title, parent, children, name} = tutorial;
            const page = new DocletPage({
                kind: "tutorial", name, title, children, longname: title,
                description: tutorial.parse(), parent: parent?.name && parent
            });
            
            // Write the output to the filesystem and proceed to handle any descendant tutorials
            page.generate(helper.tutorialToUrl(name));
            PublishUtils.generateTutorials(tutorial);
        }
    }
    
    /**
     * Get a standardised version of a value's type string
     * @param {String} name - the existing type string to standardise
     * @returns {String} the standardised version of the value's type string
     */
    static typeString(name) {
        // Turn clojure array syntax back into JSDoc array syntax!
        return name
            .replace(/Promise\.(?:<|&lt;)(.*)>/g, "$1")
            .replace(/(Map|Record|Set)\.((<|&lt;).*?)/g, "$1$2")
            .replace(/Array\.(?:<|&lt;)(.*)>/g, "$1[]")
            .replace(/(.*>)(?:.*?)~(.*)/g, "$1~$2")
            .replace(/(.*?)\.((<|&lt;).*?[>].*)/g, "$1");
    }
    
    /**
     * Standardise and make render-safe a list of type strings for a given doclet
     * @param {String[]} type - list of existing type strings to standardise and make safe for rendering
     * @returns {String} the standardised version of each type string for the given doclet
     */
    static typeStrings({type}) {
        return (type?.names || []).map(name => PublishUtils.typeString(helper.linkto(name, helper.htmlsafe(name)))).join(", ");
    }
    
    /**
     * Concatenate and make render-safe a list of attribute strings
     * @param {String[]} attribs - the list of attribute strings to concatenate and make safe for rendering
     * @returns {String} the concatenated and render-safe attributes list string value
     */
    static attribsString(attribs) {
        return attribs.length ? helper.htmlsafe(`(${attribs.filter(a => a !== "constant").join(", ")})`) : "";
    }
    
    /**
     * Generate the HTML for the main navigation menu of a page
     * @param {BootstrappedTemplate} template - JSDoc Template to assign the generated HTML to
     * @param {Salty} data - constructed and filtered dataset of JSDoc doclets
     * @param {Tutorial[]} tutorials - tutorials to include in the main navigation menu of a page
     * @param {String} [apiEntry] - class or namespace to treat as the entrypoint when generating structured navigation for a page
     */
    static buildBoilerplateNav(template, data, tutorials, apiEntry = "") {
        const scopes = ["Modules", "Namespaces", "Classes", "Interfaces", "Events", "Mixins", "Externals"];
        const {globals, ...members} = helper.getMembers(data);
        const nav = [];
        const seen = {};
        
        nav.push(...[
            // Generate the structured navigation menu for the given API entrypoint
            PublishUtils.buildStructuredNav(data, data({scope: "global", kind: DocletPage.containers, name: apiEntry}).get(), seen, 3, apiEntry),
            // Generate navigation menu entries for any remaining unseen global members
            ...scopes.map(scope => PublishUtils.buildMemberNav(scope, members[scope.toLowerCase()], seen, helper.linkto)),
            // Generate navigation menu entries for any tutorials
            PublishUtils.buildMemberNav("Tutorials", tutorials, {}, (ln, name) => PublishUtils.linkTutorial(name))
        ]);
        
        // Add menu entries for any global doclets with no more specific memberships
        if (globals.length) {
            let globalNav = "";
            
            for (let {kind, longname, name} of globals) {
                globalNav += ((String(kind) !== "typedef" && !seen[longname]) ? `<li>${helper.linkto(longname, name)}</li>` : "");
                seen[longname] = true;
            }
            
            // Turn the heading into a link, so you can actually get to the global page
            nav.push(!globalNav ? `<h3>${helper.linkto("global", "Global")}</h3>` : `<h3>Globals</h3><ul>${globalNav}</ul>`);
        }
        
        // Assign!
        template.boilerplateNav = nav.join("");
    }
    
    /**
     * Generate the HTML for the structured API section of the main navigation menu of a page
     * @param {Salty} data - constructed and filtered dataset of JSDoc doclets
     * @param {ClassyDoclet[]} items - collection of items to generate structured navigation menu entries for
     * @param {Object.<string, boolean>} seen - object keeping track of whether a given item has already had a menu entry generated
     * @param {Number} depth - how deep the current set of menu entries are nested in the overall menu structure
     * @param {String} [apiEntry] - class or namespace to treat as the entrypoint of the structured navigation
     * @returns {String} generated HTML for the structured API section of the main navigation menu of a page
     */
    static buildStructuredNav(data, items, seen, depth, apiEntry) {
        let listContent = "";
        
        // If there's only one item, and that item is the API entrypoint, add the API heading and menu items
        if (!!apiEntry && items.length === 1 && items[0].longname === apiEntry) {
            const [item] = items;
            
            if (!(seen[item.longname])) {
                seen[item.longname] = true;
                
                listContent += `<h${depth}>API</h${depth}>`;
                listContent += PublishUtils.buildStructuredNav(data, data({memberof: item.longname, kind: DocletPage.classlike}).get(), seen, depth + 1);
                
                return listContent;
            }
        }
        // Otherwise, go through and handle the structured menu entries for each item
        else {
            for (let item of items) {
                if (!(seen[item.longname])) {
                    const title = helper.linkto(item.longname, item.name.replace(/\b(module|event):/g, ''));
                    const children = PublishUtils.buildStructuredNav(data, data({memberof: item.longname, kind: DocletPage.classlike}).get(), seen, depth + 1);
                    const heading = ((depth < 5 || children.length) ? `<h${depth}>${title}</h${depth}>` : title);
                    
                    listContent += `<li>${children.length ? `<details><summary>${heading}</summary>${children}</details>` : `${heading}${children}`}</li>`;
                    seen[item.longname] = true;
                }
            }
            
            return listContent.length ? `<ul>${listContent}</ul>` : "";
        }
    }
    
    /**
     * Generate HTML for the main navigation menu for a given heading and set of menu items
     * @param {String} heading - title to use for the collection of menu entries
     * @param {ClassyDoclet[]} items - collection of items under the specified heading to generate navigation menu entries for
     * @param {Object.<string, boolean>} seen - object keeping track of whether a given item has already had a menu entry generated
     * @param {Function} linktoFn - method to call to generate the HTML link to an item
     * @returns {String} generated HTML for the main navigation menu for a given heading and set of menu items
     */
    static buildMemberNav(heading, items, seen, linktoFn) {
        let nav = "";
        
        for (let item of items) {
            if (!item.longname) {
                nav += `<li>${linktoFn("", item.name)}</li>`;
            } else if (!seen[item.longname]) {
                const displayName = env.conf.templates.default.useLongnameInNav ? item.longname : item.name;
                
                seen[item.longname] = true;
                nav += `<li>${linktoFn(item.longname, displayName.replace(/\b(module|event):/g, ''))}</li>`;
            }
        }
        
        return nav.length ? `<h3>${heading}</h3><ul>${nav}</ul>` : "";
    }
    
    /**
     * @typedef {Object} TOCHeading
     * @property {String} id - the value used as the menu item's id attribute
     * @property {String} name - the content used as the menu item's inner text
     * @property {Boolean} section - whether emphasis is added to the menu item
     * @property {TOCHeading[]} siblings - a list of other menu items adjacent to this one
     * @property {TOCHeading[]} children - a list of menu items that are descendants of this one
     */
    
    /**
     * Generate a structured list of headings to use for a page's table of contents menu
     * @param {DocletPage} page - the page whose content should be used to build the table of contents menu
     * @returns {TOCHeading[]} a list of items describing the table of contents menu of a page
     */
    static getTocStructure(page) {
        const {kind, description, doclets, examples, params, properties} = page;
        
        // Get titles in description from heading elements with "id" attribute
        const targets = [...JSDOM.fragment(description).querySelectorAll(`[id]`)]
            // Get rid of any elements that aren't headings with an actual id and name
            .filter((e) => (!!e.tagName.match(/^[hH]/g) && !!e.getAttribute("id") && !!e.textContent))
            // Get the title id, name, and heading level from the number in the element tag
            .map((e) => ([e.getAttribute("id"), e.textContent, Number(e.tagName.replace(/^[hH]/, ""))]))
            .map(([id, name, level]) => ({id, name, level, children: []}));
        
        // Get the size of the biggest heading element
        const minLevel = targets.reduce((min, {level}) => (level < min ? level : min), 6);
        // Go through and give them structure
        const titles = targets.reduce((titles, h) => {
            // If top level title, add it to the list
            if (h.level <= (minLevel === 1 ? 2 : minLevel)) {
                if (!titles.includes(h)) titles.push(h);
            }
            // Otherwise, try find a parent for it
            else {
                // Always start by assuming last title, if any, as parent
                let parent = titles[titles.length-1],
                    level = (parent?.level > 0 ? parent?.level + 1 : h.level);
                
                // Find the closest parent at specified depth
                while (parent?.children?.length && level < h.level) {
                    level += 1;
                    parent = parent.children[parent.children.length - 1];
                }
                
                // Add the child
                parent?.children?.push(h);
            }
            
            return titles;
        }, []);
        
        // Start by assuming headings may just come from titles or be empty
        const headings = (!DocletPage.classlike.includes(kind) ? (["globalobj"].includes(kind) ? [] : titles) : ( 
            // If headings weren't sourced from titles in the description, add a few basic entries
            [
                // Add "Description" heading to cover summary and any extended description 
                {id: "description", name: "Description", section: true, siblings: titles},
                // Add "Usage" heading for details if required
                {
                    id: "usage", name: "Usage", section: true,
                    children: [
                        {id: "details", name: "Details"},
                        ...(params?.length ? [{id: "params", name: "Parameters"}] : []),
                        ...(properties?.length ? [{id: "properties", name: "Properties"}] : []),
                        ...(examples?.length ? [{id: "examples", name: "Examples"}] : [])
                    ]
                }
            ]
        ));
        
        // Add headings for each container and member section
        for (let kind of [...DocletPage.containers, ...DocletPage.members]) if (doclets[kind]?.length) {
            // Get pluralised id and name for each section
            const id = PublishUtils.pluralise(kind === "function" ? "method" : kind);
            const name = PublishUtils.pluralise(DocletPage.titles[kind]);
            // Only add child entries for member sections
            const children = !DocletPage.members.includes(kind) ? [] : doclets[kind]
                .map(({id, name, attribs}) => ({id, name: `${kind === "constant" ? "" : attribs}${name}`}));
            
            // Add the heading!
            headings.push({id, name, children, section: true});
        }
        
        return headings;
    }
    
    /**
     * Generate HTML for the table of contents menu of a page
     * @param {TOCHeading[]} items - collection of items to generate table of contents menu entries for
     * @param {Boolean} [inline=false] - whether list items should be indented in the menu
     * @returns {String} the HTML list of links for the table of contents of a page, with headings
     */
    static buildTocNav(items = [], inline = false) {
        let listContent = "";
        
        for (let item of items) {
            // Build a list of links for each child, as well as their children
            const title = (!!item.id ? `<a href="#${item.id}">${item.name}</a>` : item.name);
            const siblings = PublishUtils.buildTocNav(item.siblings, true);
            const children = PublishUtils.buildTocNav(item.children);
            
            listContent += `<li>${(item.section ? `<h5 class="toc-section">${title}</h5>` : title) + siblings + children}</li>`;
        }
        
        return listContent.length ? `<ul${inline ? ` class="no-indent"` : ""}>${listContent}</ul>` : "";
    }
    
    /**
     * Extended details about a hosted git repository from package.json
     * @typedef {Object} PackageRepositoryData
     * @property {String} type - repository version control provider type
     * @property {String} url - location of the repository hosted by a version control provider
     */
    
    /**
     * Get details of a package's repository located on a hosted git provider
     * @param {String} packagePath - path to the repository's main package.json file
     * @param {String|PackageRepositoryData} repository - location or details of the repository on a hosted git provider
     * @returns {HostedGitData} configuration details for a given hosted git provider
     */
    static getRepository(packagePath, repository) {
        // Break if package.json or repository are undefined
        if (!repository || !packagePath) return {};
        
        // Only look for .git folders next to specified package.json
        const gitDir = path.join(path.dirname(path.resolve(env.pwd, packagePath)), ".git");
        
        // Only continue if git dir exists
        if (fs.existsSync(gitDir)) {
            try {
                // Get the current HEAD ref, which may be a commit or a branch name
                const ref = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
                // It's either a commit, or a branch ref that needs resolving to a commit 
                const commitish = (!ref.startsWith("ref: ") ? ref : fs.readFileSync(path.join(gitDir, ref.replace("ref: ", "")), "utf8").trim());
                
                return PublishUtils.resolveGitHost(repository, commitish) ?? {};
            } catch (ex) {
                // Do nothing, repository can't be resolved
            }
        }
        
        return PublishUtils.resolveGitHost(repository) ?? {};
    }
    
    /**
     * Details about config and source files located on a hosted git provider
     * @typedef {Object} HostedGitData
     * @property {String} [name] - hosted git provider name (e.g. GitHub, Bitbucket, GitLab, etc.)
     * @property {String} [link] - location of the main page of the repository on the hosted git provider
     * @property {String} [image] - name of the default file to use in the repository link in the page header
     * @property {String} [path] - URL to use as base path for source file links on the hosted git provider
     * @property {String} [line] - format of suffix used by hosted git provider to link directly to specific lines in a source file
     */
    
    /**
     * Function to resolve details about config and source files located on a hosted git provider
     * @callback HostedGitDataResolver
     * @param {String} path - user/organisation and repository name used to locate the repository on the hosted git provider
     * @param {String} commitish - a commit hash or similar string that identifies exactly what version of a source file should be linked to
     * @returns {HostedGitData} configuration details for a given hosted git provider
     */
    
    /**
     * Methods to map common Git hosts to their source file path link format and line tag prefix
     * @type {Object}
     * @property {HostedGitDataResolver} github - method used to resolve details of a repository hosted on GitHub
     * @property {HostedGitDataResolver} bitbucket - method used to resolve details of a repository hosted on Bitbucket
     * @property {HostedGitDataResolver} gitlab - method used to resolve details of a repository hosted on GitLab
     * @private
     */
    static #gitHosts = {
        github: (path, commitish) => ({
            name: "GitHub", link: `https://github.com/${path}`, image: "github.png",
            path: !!commitish && `https://github.com/${path}/blob/${commitish}/`, line: "L"
        }),
        bitbucket: (path, commitish) => ({
            name: "Bitbucket", link: `https://bitbucket.org/${path}`, image: "bitbucket.svg",
            path: !!commitish && `https://bitbucket.org/${path}/src/${commitish}/`, line: "line-"
        }),
        gitlab: (path, commitish) => ({
            name: "GitLab", link: `https://gitlab.com/${path}`, image: "gitlab.svg",
            path: !!commitish && `https://gitlab.com/${path}/blob/${commitish}/`, line: "L"
        })
    }
    
    /**
     * Extract details about, and resolve configuration for source files located on a hosted git provider
     * @param {String|PackageRepositoryData} repository - location or details of the repository on a hosted git provider
     * @param {String} [commitish] - a commit hash or similar string that identifies exactly what version of a source file should be linked to
     * @returns {HostedGitData} configuration details for a given hosted git provider
     */
    static resolveGitHost(repository, commitish) {
        if (typeof repository === "string") {
            // Get repository details if specified in short form
            const [host, repo = host] = repository.split(":");
            
            // Get the host's path details as above
            switch (host) {
                case repo:
                    return PublishUtils.#gitHosts.github(repo, commitish);
                case "github":
                case "bitbucket":
                case "gitlab":
                    return PublishUtils.#gitHosts[host](repo, commitish);
            }
        } else if (repository?.type === "git" && !!repository?.url) {
            // Extract git host and repository details from full link
            const target = new URL(repository.url.replace(/^(?:git\+)?(.*?)(?:\.git)?$/, "$1"));
            
            // Then try again with a string value instead
            return PublishUtils.resolveGitHost(`${target.host.split(".").shift()}:${target.pathname.substring(1)}`, commitish);
        }
    }
}

/**
 * Page representation of a doclet, as well as utility methods for preparing the page or pages
 * @extends ClassyDoclet
 */
class DocletPage {
    /**
     * Whether links to other doclet pages should be resolved when the current page is generated
     * @type {Boolean}
     * @instance
     * @private
     */
    #resolveLinks;
    
    /**
     * Map of JSDoc doclet sources to DocletPage instances to ensure uniqueness of each DocletPage
     * @type {Map.<*, DocletPage>}
     * @private
     */
    static #pages = new Map();
    
    /**
     * Unique set of paths to source files for each DocletPage
     * @type {Map.<string, Object>}
     * @private
     */
    static #sources = new Map();
    
    /**
     * List of DocletPage kinds which will potentially need pages of their own
     * @type {String[]}
     */
    static containers = ["module", "class", "namespace", "mixin", "external", "interface"];
    
    /**
     * List of DocletPage kinds that necessarily belong to some other parent DocletPage
     * @type {String[]}
     */
    static members = ["member", "function", "typedef", "constant", "event"];
    
    /**
     * List of DocletPage kinds that are class-like
     * @type {String[]}
     */
    static classlike = ["namespace", "class", "interface"];
    
    /**
     * Map of doclet page kinds to titles to use for the doclet page
     * @type {Object.<string, string>}
     */
    static titles = {
        module: "Module",
        class: "Class",
        namespace: "Namespace",
        mixin: "Mixin",
        external: "External",
        interface: "Interface",
        source: "Source",
        member: "Member",
        function: "Method",
        constant: "Constant",
        typedef: "Type Definition",
        event: "Event",
        tutorial: "Tutorial"
    };
    
    /**
     * Master JSDoc Template used to render all other pages
     * @type {Template}
     * @private
     */
    static #template;
    
    /**
     * Sets the JSDoc master template used to render all documentation pages
     * @param {Template} [template] - the JSDoc master template to use for rendering all documentation pages
     */
    static set template(template) {
        return (DocletPage.#template = template);
    }
    
    /**
     * Instantiate and prepare a new DocletPage, or return an existing DocletPage for the given source
     * @param {ClassyDoclet} source - the JSDoc doclet containing the details of the DocletPage to be created
     * @param {ClassyDoclet[]} [children=[]] - set of JSDoc doclets that are considered children of the current DocletPage
     * @param {Boolean} [resolveLinks=true] - whether to resolve links to other doclets when generating the DocletPage
     * @returns {DocletPage} the newly instantiated DocletPage, or the existing DocletPage if one exists for the given source
     * @property {String} [path] - the full path to the DocletPage's associated source file
     * @property {String} [link] - a link to this DocletPage
     * @property {String} [heading] - the value to use in the page header for this DocletPage
     * @property {String} [doctitle] - the value to use in the head title element for this DocletPage
     * @property {Object.<string, ClassyDoclet[]>} [doclets] - any other doclets that are members of this page
     */
    constructor(source, children = [], resolveLinks = true) {
        // Only allow one doclet page per doclet source
        if (DocletPage.#pages.has(source)) {
            return DocletPage.#pages.get(source);
        }
        
        // Save the new doclet page and copy all properties from source
        DocletPage.#pages.set(source, this);
        Object.assign(this, source);
        
        this.#resolveLinks = resolveLinks;
        this.env = env;
        this.doclet = source;
        this.path = source?.meta?.source;
        this.link = source?.kind === "tutorial" ? helper.tutorialToUrl(source.name) : helper.createLink(source);
        this.heading = (DocletPage.titles[source.kind] ? `${DocletPage.titles[source.kind]}: ` : "")
            + `<span class="ancestors">${(source.ancestors || []).join("")}</span>`
            + (source?.kind === "tutorial" ? source.title : source.name);
        this.doctitle = (DocletPage.titles[source.kind] ? `${DocletPage.titles[source.kind]}: ` : "") + source.longname;
        this.doclets = Object.assign({}, children.reduce((members, c) => {
            if (c.kind) (members[c.kind] = members[c.kind] || []).push(c);
            return members;
        }, {}));
        
        // Add any missing source pages, so they can be linked or generated
        if (!DocletPage.#sources.has(this.path) && !!this.path) {
            DocletPage.#sources.set(this.path, {resolved: this.path, shortened: null});
        }
        
        // Fix the doctitle and description of the main page
        if (this.kind === "mainpage") {
            this.doctitle = this.name;
            this.description = (this.doclets?.readme ?? []).map(d => d.readme ?? "").join("");
        }
        
        // Fix the doctitle of the "Globals" page
        if (this.kind === "globalobj") {
            this.doctitle = "Globals";
        }
        
        for (let doclet of [this, ...children]) {
            // Re-format examples with captions where necessary
            if (doclet.examples) doclet.examples = doclet.examples.map((example) => {
                const [, caption = "",, code = example] = example.match(/^\s*<caption>([\s\S]+?)<\/caption>(\s*[\n\r])([\s\S]+)$/i) ?? [];
                return {caption, code};
            });
            
            // Re-format "see" links with correct anchors where necessary
            if (doclet.see) doclet.see = doclet.see.map((hash) => {
                return (!/^(#.+)/.test(hash) ? hash : `<a href="${doclet.link.replace(/(#.+|$)/, hash)}">${hash}</a>`);
            });
        }
    }
    
    /**
     * Add active class to the global navigation menu entry for the current page, and its parents
     * @param {String} boilerplate - generated boilerplate HTML for the main navigation menu of a page
     * @returns {String} HTML for the main navigation menu of a page, with current page and parents set to active
     */
    nav(boilerplate) {
        const nav = JSDOM.fragment(`<div id="container">${boilerplate}</div>`);
        const active = nav.querySelector(`a[href="${this.link}"]`);
        
        if (!!active) {
            // Add the active class to the current page menu entry
            active.classList.add("active");
            
            let parent = active.parentElement;
            
            // Add the active class to any parents of the current page menu entry
            while (!!parent) {
                parent.classList.add("active");
                parent = parent.parentElement;
            }
        }
        
        for (let details of nav.querySelectorAll(`details.active`)) {
            details.setAttribute("open", "open");
        }
        
        // Return the navigation menu, but with the active classes added
        return nav.querySelector("#container").innerHTML;
    }
    
    /**
     * Generate the HTML for the table of contents menu of the current page
     * @returns {String} generated HTML for the table of contents menu of the current page
     */
    toc() {
        return PublishUtils.buildTocNav(PublishUtils.getTocStructure(this));
    }
    
    /**
     * Render HTML for the current page using the previously specified template
     * @returns {String} rendered HTML for the current page
     */
    render() {
        const html = DocletPage.#template.render("container.tmpl", this);
        return (this.#resolveLinks !== false ? helper.resolveLinks(html) : html);
    }
    
    /**
     * Render and save the HTML document for the current page
     * @param {String} fileName - name of the file to save the rendered page to
     */
    generate(fileName) {
        fs.writeFileSync(path.join(outdir, fileName || this.link), this.render(), "utf8");
    }
    
    /**
     * Declare links to JSDoc for the given set of doclets
     * @param {JSDocDoclet[]} doclets - set of doclets to be declared to JSDoc's linking mechanism
     * @param {String} [apiEntry] - class or namespace whose doclet should be treated as the index page
     * @param {String} [indexUrl] - path to register as the index page
     */
    static declare(doclets, apiEntry, indexUrl) {
        for (let doclet of doclets) {
            doclet.attribs = "";
            doclet.link = helper.createLink(doclet);
            doclet.id = (!doclet.link.includes("#") ? doclet.name : doclet.link.split(/#/).pop());
            if (doclet.longname) helper.registerLink(doclet.longname, doclet.link);
            if (doclet.meta) {
                let {path: dir, filename: fn} = doclet.meta;
                doclet.meta.source = dir && dir !== "null" ? path.join(dir, fn) : fn;
            }
        }
        
        if (!!apiEntry && indexUrl) {
            helper.registerLink(apiEntry, indexUrl);
        }
    }
    
    /**
     * Establish inheritance and child details for a given set of doclets
     * @param {Doclet[]} doclets - set of doclets for which children and inheritance is to be established for
     * @param {Salty} data - constructed and filtered dataset of JSDoc doclets
     */
    static inherit(doclets, data) {
        for (let doclet of doclets) {
            // Establish inheritance for supplied doclets, where supported
            if (!!doclet?.meta) {
                // Establish initial inheritance chain for the doclet, as well as whether it is a container-generating doclet
                const inheritance = new Set([...(doclet.implements ?? []), ...[doclet.augments, doclet.implements, doclet.overrides].flatMap((i) => i ? i : []).map((v) => v.replaceAll(/(.*?)[<].*?[>]/g, "$1"))]);
                const isContainer = DocletPage.containers.includes(doclet.kind);
                const templateValues = new Map(Array.from(doclet?.templates?.entries() ?? [], ([key, value]) => ([key, value?.type?.names?.join("|") || value.defaultvalue || key])));
                
                // If it's not a container, it must have a parent
                if (!isContainer) {
                    // See if we can find the containing parent
                    const {filename, path} = doclet.meta;
                    const [parent] = data().get().filter(({name, longname, meta: {filename: fn, path: p} = {}}) => 
                        // Need to use native array filter since Salty doesn't support comparing deeply nested properties
                        ((fn === filename && p === path) && (name === doclet.memberof || longname === doclet.memberof)));
                    // Then get details about where the doclet inherits from its parent
                    const {augments: augs = [], implements: imps = [], templates} = parent ?? {};
                    const ancestors = [["augments", augs], ["implements", imps]];
                    
                    // Store type parameter values from parent with either specified type or fallback value
                    for (let [key, value] of Array.from(templates?.entries() ?? [], ([key, value]) => ([key, value?.type?.names?.join("|") || key]))) {
                        templateValues.set(key, value);
                    }
                    
                    // If the parent inherits from somewhere, assume this symbol might inherit from there too
                    for (let [type, targets] of ancestors) {
                        // Go through each inheritable symbol to add to the doclet
                        for (let target of targets) {
                            // Strip TypeScript generic type params from inheritance targets
                            const [fallback, longname = fallback, typeParamsString = ""] = /(.*)[<](.*)[>]|.*/g.exec(target);
                            const ancestorName = `${longname}${helper.scopeToPunc[doclet.scope || "instance"]}${doclet.name}`;
                            // Extract TypeScript generic type params from inheritance target
                            const typeParams = typeParamsString.split(",").map((s) => s.trim()).filter(s => s);
                            const [heritage] = data({longname}).get();
                            
                            // Store type parameter values with either specified type or fallback value
                            for (let [key, value] of Array.from(heritage.templates?.entries() ?? [], ([key, value], index) => ([key, typeParams[index] ?? value?.defaultvalue]))) {
                                templateValues.set(key, value);
                            }
                            
                            // Add ancestor to inheritance chain, and to the doclet
                            if (!inheritance.has(ancestorName)) {
                                inheritance.add(ancestorName);
                                
                                // Add inheritance of specified type to the doclet
                                doclet[type] = doclet[type] ?? [];
                                if (!doclet[type].includes(ancestorName)) doclet[type].push(ancestorName);
                            }
                        }
                    }
                }
                
                // Apply inheritance if necessary!
                if (inheritance.size > 0 && !doclet.exceptions) {
                    // Establish details of the symbol to inherit from
                    const {name, kind, scope} = doclet;
                    // Only inherit from the first name in the list
                    const [fallback, longname = fallback, typeParamsString = ""] = /(.*)[<](.*)[>]|.*/g.exec(inheritance.values().next().value);
                    const typeParams = typeParamsString.split(",").map((s) => s.trim()).filter(s => s);
                    // See if we can find a symbol to inherit from
                    const query = {longname, kind, ...(!!scope && !isContainer ? {scope} : {})};
                    const [inheritable] = (isContainer ? data(query).get() : [
                        // Need to use multiple queries as Salty doesn't support branching logic from TaffyDB
                        ...data({...query, name}).get(), ...data({...query, alias: name}).get()
                    ]);
                    
                    // If so, apply inheritance to inheritable tags
                    if (!!inheritable) {
                        for (let key of ["description", "examples", "see", "params", "properties", "type", "returns"]) {
                            // Only if the tag isn't already defined on the doclet
                            if (!Object.keys(doclet[key] ?? "").length && !!inheritable[key]) {
                                doclet[key] = JSON.parse(JSON.stringify(inheritable[key]));
                            }
                        }
                        
                        // Mix in additional type parameter values from the inheritable symbol
                        for (let [key, value] of Array.from(inheritable.templates?.entries() ?? [], ([key, value], index) => ([key, typeParams[index] ?? value?.defaultvalue]))) {
                            templateValues.set(key, value);
                        }
                    }
                }
                
                // Replace inherited type parameter types with actual types
                for (let key of ["params", "properties", "type", "returns"]) if (!!doclet[key]) {
                    for (let value of Array.isArray(doclet[key]) ? doclet[key] : [doclet[key]]) {
                        // Get a new, unique set of type names, with template names replaced
                        if (value?.type?.names) value.type.names = Array.from(
                            new Set(value.type.names.flatMap(t => t
                                .replace(/(?:Promise\.<)(.*)(?:>)/g, "$1").replace(/^(?:\()(.*)(?:\))$/g, "$1")
                                .replace(/(Array\.<)(.*)(>)/g, (_, l, n, r) => `${l}${templateValues.get(n) ?? n}${r}`)
                                .split(/(?<![<].*?)[|]/)
                            )),
                            (n) => (templateValues.get(n) ?? n)
                        ).filter((name) => name !== "void");
                    }
                }
            }
            
            // Get ancestor links for the doclet
            doclet.ancestors = helper.getAncestorLinks(data, doclet);
        }
    }
    
    /**
     * Create custom signature strings for a given set of doclets
     * @param {Object[]} doclets - set of doclets for which signatures should be created
     */
    static sign(doclets) {
        for (let doclet of doclets) {
            const {kind, type, meta, signature = "", params = []} = doclet;
            // Add types to signatures of constants and members
            const needsTypes = ["constant", "member"].includes(kind);
            // Functions and classes automatically get signatures
            const needsSignature = ["function", "class", "interface"].includes(kind)
                // Typedefs that contain functions get a signature, too
                || (kind === "typedef" && (type?.names || []).some(t => t.toLowerCase() === "function"))
                // And namespaces that are functions get a signature (but finding them is a bit messy)
                || (kind === "namespace" && meta?.code?.type?.match(/[Ff]unction/));
            
            if (needsSignature) {
                const source = doclet.yields || doclet.returns || [];
                // Prepare attribs and returns signatures
                const attribs = PublishUtils.attribsString([...new Set(source.map(item => helper.getAttribs(item)).flat())]);
                const throws = doclet.exceptions?.map(e => PublishUtils.typeStrings(e));
                const returns = source.map(s => s.type?.names).flat()
                    .map(s => PublishUtils.typeStrings({type: {names: [s]}})).join("|");
                // Prepare params signature
                const args = params.filter(({name}, index) => (name && !name.includes(".")
                    && index === params.indexOf([...params].reverse().find(({name: n}) => name === n))))
                    .map(({name: itemName, variable, optional, nullable}) => {
                        const name = (variable ? `&hellip;${itemName}` : itemName);
                        const attributes = [...(optional ? ["opt"] : []),
                            ...(nullable === true ? ["nullable"] : []),
                            ...(nullable === false ? ["non-null"] : [])].join(", ");
                        
                        // Return parameter name with trailing attributes if necessary
                        return name + (attributes.length > 0 ? `<span class="signature-attributes">${attributes}</span>` : "");
                    })
                    .join(", ");
                
                // Add params to the signature, then add attribs and returns to the signature
                doclet.signature = `<span class="signature">${signature}(${args})</span>`;
                doclet.signature += `<span class="type-signature returns">${throws?.length ? ` &raquo; ${throws}` : returns.length ? ` &rarr; ${attribs}{${returns}}` : ""}</span>`;
            } else if (needsTypes) {
                const types = PublishUtils.typeStrings(doclet);
                
                // Add types to the signature
                doclet.signature = `${signature}<span class="type-signature">${types.length ? `: ${types}` : ""}</span>`;
            }
            
            if (needsSignature || needsTypes) {
                // Add the attributes tag if signatures or types were set above
                const attribs = PublishUtils.attribsString(helper.getAttribs(doclet));
                if (attribs.length) doclet.attribs = `<span class="type-signature">${attribs} </span>`;
            }
        }
    }
    
    /**
     * Declare links to source files, and generate pages for each file where necessary
     * @param {Object[]} doclets - set of doclets to assess for potential source files
     * @param {String[]} files - list of all source file names
     * @param {String} [encoding="utf8"] - encoding to use when reading source files
     * @param {String|Boolean} [repositoryPath=false] - path to the hosted git repository, if specified
     * @returns {DocletPage[]} collection of doclet pages to be generated for source files
     */
    static sources(doclets, {_: files, encoding = "utf8"}, repositoryPath = false) {
        const pages = [];
        // Get the real prefix of the source files, as JSDoc strips it!
        const realPrefix = files
            .reduce((prefix, file) => (!prefix ? file : prefix
                .split("").filter((c, i) => c === file[i]).join("")))
            .replace(/\\/g, "/");
        
        if (!!doclets && DocletPage.#sources.size > 0) {
            // Find common full path prefix to replace
            const commonPrefix = JSDocPath.commonPrefix([...DocletPage.#sources.keys()]);
            
            for (let file of [...DocletPage.#sources.values()]) {
                // Add the shortened path and register the link
                file.shortened = file.resolved.replace(commonPrefix, realPrefix + (realPrefix.endsWith("/") ? "" : "/")).replace(/\\/g, "/");
                helper.registerLink(file.shortened, !!repositoryPath ? `${repositoryPath}${file.shortened}` : helper.getUniqueFilename(file.shortened));
                
                // If repository path not specified, assume pages must be generated for source files
                if (!repositoryPath) {
                    try {
                        // So attempt to do that
                        const doclet = {kind: "source", name: file.shortened, longname: file.shortened};
                        const docs = [{kind: "source", code: helper.htmlsafe(fs.readFileSync(file.resolved, encoding))}];
                        
                        pages.push(new DocletPage(doclet, docs, false));
                    } catch (ex) {
                        logger.error(`Error while generating source file ${file.resolved}: ${ex.message}`);
                    }
                }
            }
            
            for (let doclet of doclets) {
                // Update the short path for all doclets
                if (doclet.meta && DocletPage.#sources.has(doclet.meta.source)) {
                    doclet.meta.shortpath = DocletPage.#sources.get(doclet.meta.source).shortened;
                }
            }
        }
        
        return pages;
    }
}

/**
 * Prepare and generate documentation pages! 
 * @param {Salty} data - set of doclets detected by JSDoc
 * @param {Object} opts - options supplied to JSDoc
 * @param {Tutorial} tutorials - list of associated tutorials
 */
exports.publish = (data, opts, tutorials) => {
    // Get package data, template path and overall config
    const [packageData = {}] = data({kind: "package"}).get();
    const {templatePath, templateConfig, sourceFiles} = PublishUtils.getPublishConfig(path.normalize(opts.template), opts.package, packageData.repository);
    
    // Claim some special filenames in advance, so the All-Powerful Overseer of Filename Uniqueness
    const globalUrl = helper.getUniqueFilename("global");
    const indexUrl = helper.getUniqueFilename("index");
    const pages = [];
    
    // Get things ready
    helper.prune(data);
    helper.setTutorials(tutorials);
    helper.registerLink("global", globalUrl);
    helper.addEventListeners(data);
    JSDocFS.mkPath(outdir);
    
    // Set up templating and handle static files
    const template = DocletPage.template = PublishUtils.bootstrapTemplate(templatePath, templateConfig, data, packageData, sourceFiles);
    PublishUtils.handleStatics(templatePath, templateConfig?.default?.staticFiles, {icon: templateConfig.classy.icon, logo: templateConfig.classy.logo, gitImage: sourceFiles.image});
    
    // Prepare all doclets for consumption
    DocletPage.declare(data().get(), templateConfig.classy.apiEntry, indexUrl);
    DocletPage.inherit(data().get(), data);
    DocletPage.sign(data().get(), data);
    pages.push(...[
        // Create pages for all container-type doclets
        ...data({kind: DocletPage.containers}).get()
            .map(doclet => new DocletPage(doclet, data({memberof: doclet.longname}).get())),
        // ...as well as any corresponding source files, if enabled, and gitPath not specified or source file output explicitly enabled
        ...(sourceFiles.output ? DocletPage.sources(data().get(), opts, templateConfig?.default?.outputSourceFiles !== true && sourceFiles.path) : [])
    ]);
    
    // Prepare template's common nav structure
    PublishUtils.buildBoilerplateNav(template, data, tutorials.children, templateConfig.classy.apiEntry);
    
    // Extract the main page title from the readme
    let readme = opts.readme && JSDOM.fragment(opts.readme);
    const headingEl = readme.querySelector("h1");
    const heading = (!readme || !headingEl ? "Home" : readme.removeChild(headingEl).textContent);
    
    // Find the API entry doclet (if specified) and move it to the index
    if (!!templateConfig.classy.apiEntry) {
        // Find the doclet and remove it from pages - it no longer gets its own page
        const [entry] = data({kind: DocletPage.containers, longname: templateConfig.classy.apiEntry}).get();
        const index = pages.indexOf(new DocletPage(entry));
        const page = (index >= 0 ? pages.splice(index, 1).pop() : false);
        
        if (!!page) {
            // Render and get the inner contents of the page that would have existed
            const content = JSDOM.fragment(JSDOM.fragment(page.render()).querySelector("main > article").innerHTML);
            
            // If there's no readme, now there is!
            if (!readme) readme = content;
            // Otherwise, add or replace the "API" section of the readme
            else {
                // See if we can find an "API" heading in the readme, and get the overview contents for insertion
                const sectionHeading = [...readme.querySelectorAll("h1, h2, h3, h4, h5, h6")].find(h => h.innerHTML === "API");
                const sectionContent = content.querySelector(".container-overview");
                
                if (!!sectionHeading) {
                    // The "API" heading exists, mark it as such
                    sectionHeading.setAttribute("id", "api");
                    
                    // See if there's any sections following it
                    const nextHeading = readme.querySelector("#api ~ h1, #api ~ h2, #api ~ h3, #api ~ h4, #api ~ h5, #api ~ h6");
                    for (let node of [...readme.querySelectorAll("#api ~ *")]) {
                        // Remove nodes between API heading and next heading (if any)
                        if (node === nextHeading) break;
                        else readme.removeChild(node);
                    }
                    
                    // Insert between sections if something follows...
                    if (nextHeading) readme.insertBefore(sectionContent, nextHeading);
                    // ...or append the contents if nothing follows
                    else for (let node of [...sectionContent.querySelectorAll(".description > *")]) {
                        readme.appendChild(node);
                    }
                } else {
                    // There is no "API" section yet, so we create one
                    const fragment = JSDOM.fragment(`<div id="container"><h2 id="api">API</h2></div>`);
                    const container = fragment.querySelector("#container");
                    // Look for child classes and namespaces for the entrypoint
                    const classes = content.querySelector("#classes");
                    const namespaces = content.querySelector("#namespaces");
                    
                    // If there's a summary and some classes or namespaces, make the section from these
                    if (!!page.summary && (!!classes || !!namespaces)) {
                        // Make a new list, and add all existing class and namespace entries to it
                        const list = JSDOM.fragment(`<ul class="subsection-list"></ul>`).firstChild;
                        for (let node of [...(classes?.querySelectorAll(".subsection-list > li") ?? []),
                            ...(namespaces?.querySelectorAll(".subsection-list > li") ?? [])]) {
                            list.appendChild(node);
                        }
                        
                        // Add the summary and the new list to the container
                        container.appendChild(JSDOM.fragment(page.summary).firstChild);
                        container.appendChild(list);
                    }
                    // If there isn't a summary or there's no classlike children, just transpose the description
                    else for (let node of [...sectionContent.querySelectorAll(".description > *")]) {
                        container.appendChild(node);
                    }
                    
                    // Add each new element to the actual page
                    for (let node of [...fragment.querySelectorAll("#container > *")]) readme.appendChild(node);
                }
            }
        }
    }
    
    // Check to see if we need to render the global page...
    const globals = data({kind: DocletPage.members, memberof: {isUndefined: true}}).get();
    if (globals.length) pages.unshift(new DocletPage({name: "Globals", kind: "globalobj", longname: globalUrl}, globals));
    
    // Index page displays information from package.json and lists files
    pages.unshift(
        new DocletPage({name: heading, kind: "mainpage", longname: indexUrl}, [
            ...data({kind: "package"}).get(),
            ...[{kind: "readme", readme: [...readme?.children || []].map(n => n.outerHTML).join("\n"), longname: (opts.mainpagetitle) ? opts.mainpagetitle : "Main Page"}],
            ...data({kind: "file"}).get()
        ])
    );
    
    // Generate all the pages, then generate the tutorials!
    for (let page of pages) page.generate(helper.longnameToUrl[page.longname] ?? page.longname);
    PublishUtils.generateTutorials(tutorials);
};