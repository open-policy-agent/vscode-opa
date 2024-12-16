# Change Log


## 0.19.0

- util: fix bug in replaceWorkspaceFolderPathVariable [#288](https://github.com/open-policy-agent/vscode-opa/pull/288)
- Dependency updates:
  - `vscode`: `^1.94.0` -> `^1.95.0`
  - `@stylistic/eslint-plugin`: `^2.9.0` -> `^2.11.0`
  - `@types/mocha`: `10.0.8` -> `10.0.10`
  - `@types/node`: `22.7.4` -> `22.10.1`
  - `@types/vscode`: `1.94.0` -> `1.95.0`
  - `cspell`: `^8.14.4` -> `^8.16.1`
  - `dprint`: `^0.47.2` -> `^0.47.6`
  - `eslint`: `^9.12.0` -> `^9.16.0`
  - `typescript`: `^5.6.2` -> `^5.7.2`
  - `typescript-eslint`: `^8.8.0` -> `^8.16.0`
  - `@vscode/vsce`: `^3.1.1` -> `^3.2.1`


## 0.18.0

- lsp: Explicitly enable custom LSP features [#282](https://github.com/open-policy-agent/vscode-opa/pull/282)
- Dependency updates:
  - @types/vscode 1.93.0 to 1.94.0 [#281](https://github.com/open-policy-agent/vscode-opa/pull/281)
  - vscode 1.93.0 to 1.94.0 [#281](https://github.com/open-policy-agent/vscode-opa/pull/281)
  - vsce 2.15.0 to 3.1.1 [#281](https://github.com/open-policy-agent/vscode-opa/pull/281)
  - cspell 8.14.2 to 8.14.4 [#271](https://github.com/open-policy-agent/vscode-opa/pull/271)
  - eslint 9.10.0 to 9.12.0 [#273](https://github.com/open-policy-agent/vscode-opa/pull/273), [#274](https://github.com/open-policy-agent/vscode-opa/pull/274), [#280](https://github.com/open-policy-agent/vscode-opa/pull/280)
  - typescript-eslint 8.5.0 to 8.8.0 [#270](https://github.com/open-policy-agent/vscode-opa/pull/270), [#276](https://github.com/open-policy-agent/vscode-opa/pull/276), [#277](https://github.com/open-policy-agent/vscode-opa/pull/277)
  - typescript 5.5.4 to 5.6.2 [#272](https://github.com/open-policy-agent/vscode-opa/pull/272)
  - @types/node 22.5.5 to 22.7.4 [#275](https://github.com/open-policy-agent/vscode-opa/pull/275)
  - @stylistic/eslint-plugin 2.8.0 to 2.9.0 [#279](https://github.com/open-policy-agent/vscode-opa/pull/279)


## 0.17.0

- Debugger Adapter Protocol Support, see [documentation here](https://docs.styra.com/regal/debug-adapter) - [\#218](https://github.com/open-policy-agent/vscode-opa/pull/218), [\#263](https://github.com/open-policy-agent/vscode-opa/pull/263), [\#262](https://github.com/open-policy-agent/vscode-opa/pull/262)
- Added PR checks (eslint, dprint, markdownlint, cspell, vsce package) \- [\#246](https://github.com/open-policy-agent/vscode-opa/pull/246), [\#268](https://github.com/open-policy-agent/vscode-opa/pull/268)
- Dependency updates
  - typescript-eslint: From 8.1.0 to 8.5.0
  - stylelint/eslint-plugin: From 2.6.2 to 2.8.0
  - cspell: From 8.14.1 to 8.14.2
  - types/node: From 22.0.0 to 22.5.5
  - types/mocha: From 10.0.7 to 10.0.8
  - types/vscode: From 1.92.0 to 1.93.0


## 0.16.0

- Improvements to support code lens evaluation of Rego -
  <https://github.com/open-policy-agent/vscode-opa/pull/231>
  <https://github.com/open-policy-agent/vscode-opa/pull/232>
  <https://github.com/open-policy-agent/vscode-opa/pull/233>
  <https://github.com/open-policy-agent/vscode-opa/pull/234>
  <https://github.com/open-policy-agent/vscode-opa/pull/235>
  <https://github.com/open-policy-agent/vscode-opa/pull/240>
  <https://github.com/open-policy-agent/vscode-opa/pull/241>
- Allow setting alternative formatters - <https://github.com/open-policy-agent/vscode-opa/pull/226>
- Check for OS architecture when installing OPA CLI - <https://github.com/open-policy-agent/vscode-opa/pull/216>
  thanks @tjons!


## 0.15.0

- Add support for syntax highlighting for Rego embedded in Markdown code blocks using the `rego` language identifier.

Additionally, the [latest release](https://github.com/StyraInc/regal/releases/tag/v0.22.0) of the Regal language server (v0.22.0) brings a number of features relevant to this extension:

- Basic support for code completion in Rego policies
- Warning message displayed when CRLF line endings are detected in a Rego file
- Parser errors now displayed more prominently, making them easier to spot
- Errors reported by OPA will now link directly to corresponding docs, making it easier to understand and resolve issues

Make sure to update Regal to get the latest features!


## 0.14.0

This update is focused on exposing the latest features of the Regal language server in the extension.


### Client Language Server Updates


#### Quick Fixes for Diagnostics

Building on the current diagnostics supported, [Code actions](https://code.visualstudio.com/docs/editor/refactoring) now offer a means to quickly remediate common issues. Currently Code Actions are available for the following linter violations:

- [OPA-fmt](https://docs.styra.com/regal/rules/style/opa-fmt)
- [use-rego-v1](https://docs.styra.com/regal/rules/imports/use-rego-v1)
- [use-assignment-operator](https://docs.styra.com/regal/rules/style/use-assignment-operator)
- [no-whitespace-comment](https://docs.styra.com/regal/rules/style/no-whitespace-comment)

More fixes to come in future releases now that the fundamentals are in place. It's also now possible to go to the linter diagnostic documentation as a Code Action.


#### Document & Workspace Symbols

Rego symbols — such as packages, rules and functions, are now provided by the Regal Language server upon requests from an editor. This allows for a quick overview of the structure of a Rego project, and provides "breadcrumbs" to navigate the symbols of the currently open Rego document.

Similar to Document Symbols, the language server is able to provide symbols for top-level packages, rule or function definitions in the workspace.


#### Formatting and Goto Definition

We are standardizing the functions of the Rego developer environment on the [Regal Language Server](https://docs.styra.com/regal/editor-support) implementation. This allows us to offer a standardized experience to all Rego developers, regardless of their preferred editor. [OPA format](https://github.com/StyraInc/regal/pull/630) and [Goto Definition](https://github.com/StyraInc/regal/pull/664) are now available as part of the language server and so users are encouraged to use the language server to access the currently supported option for these editor functions. See PRs [#156](https://github.com/open-policy-agent/vscode-opa/pull/156)& [#148](https://github.com/open-policy-agent/vscode-opa/pull/148) where the VS Code OPA extension is updated to use this language server.


#### Folding Ranges

Code folding ranges are also now supported in the Regal language server and can be used to collapse comments, rules and others ranges within Rego files.


#### Other Updates

- Enable connection message logging in debug mode [#147](https://github.com/open-policy-agent/vscode-opa/pull/147)
- Name Regal's output panel "Regal" instead of "regal-ls" [#145](https://github.com/open-policy-agent/vscode-opa/pull/145)
- When restarting Regal, reuse output panel [#157](https://github.com/open-policy-agent/vscode-opa/pull/157)
- Linter configuration can be loaded from a workspace's parent directory (Regal [#650](https://github.com/StyraInc/regal/pull/650))


### Dependency updates

- Bump typescript from 5.4.3 to 5.4.4 [#134](https://github.com/open-policy-agent/vscode-opa/pull/134)
- Bump @types/vscode from 1.87.0 to 1.88.0 [#135](https://github.com/open-policy-agent/vscode-opa/pull/135)
- Bump @types/node from 20.12.4 to 20.12.5 [#137](https://github.com/open-policy-agent/vscode-opa/pull/137)
- Bump @typescript-eslint/eslint-plugin from 7.5.0 to 7.6.0 [#140](https://github.com/open-policy-agent/vscode-opa/pull/140)
- Bump @typescript-eslint/parser from 7.5.0 to 7.6.0 [#141](https://github.com/open-policy-agent/vscode-opa/pull/141)
- Bump typescript-eslint from 7.5.0 to 7.6.0 [#142](https://github.com/open-policy-agent/vscode-opa/pull/142)
- Bump @types/node from 20.12.5 to 20.12.6 [#143](https://github.com/open-policy-agent/vscode-opa/pull/143)
- Bump @types/node from 20.12.6 to 20.12.7 [#146](https://github.com/open-policy-agent/vscode-opa/pull/146)
- Bump typescript from 5.4.4 to 5.4.5 [#149](https://github.com/open-policy-agent/vscode-opa/pull/149)
- Bump @Microsoft/eslint-formatter-sarif from 3.0.0 to 3.1.0 [#150](https://github.com/open-policy-agent/vscode-opa/pull/150)
- Bump @typescript-eslint/parser from 7.6.0 to 7.7.0 [#152](https://github.com/open-policy-agent/vscode-opa/pull/152)
- Bump typescript-eslint from 7.6.0 to 7.7.0 [#153](https://github.com/open-policy-agent/vscode-opa/pull/153)
- Bump @stylistic/eslint-plugin from 1.7.0 to 1.7.2 [#154](https://github.com/open-policy-agent/vscode-opa/pull/154)


## 0.13.6

- Bump @types/node from 20.12.3 to 20.12.4 #131


## 0.13.5

- Add workflow for extension release automation #112
- Fix eslint warnings #116
- fix(docs): fix docs links #117
- Add keywords to package.JSON #118
- Add dependabot config, linters, metadata #119
- Fix edge case in OPA.test.workspace activation #120
- Dependabot updates #121, #122, #123, #126, #127
- Update vscode engine #128
- Add grammar definition for raw strings #130


## 0.13.4

- Add configuration to set environment variables for OPA subprocess #103
- Use .jsonc extension for output.JSON #104
- Address issue in Regal LS startups #105
- Fix for OPA: Evaluate Package fails on some systems #108
- Allow ${workspaceFolder} to be used in env var values #110


## 0.13.0

- Support for [Regal](https://docs.styra.com/regal) Language server.


## 0.12.0

- Keyword highlighting for `if` and `contains`


## 0.11.0

- Adding support for compiler strict-mode (`--strict`) for OPA `check` command
- Adding support for Running OPA commands on single files outside of a workspace
- Syntax highlighting of the `every` keyword


## 0.10.0

- Resolve `${workspaceFolder}` variable in `opa.path` setting
- Fixing issue where 'Check File Syntax' command produces no output
- Fixing error thrown when `opa.path` setting not set
- Adding `opa.schema` setting
