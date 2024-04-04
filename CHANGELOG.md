# Change Log

## 0.13.5

- Add workflow for extension release automation #112
- Fix eslint warnings #116
- fix(docs): fix docs links #117
- Add keywords to package.json #118
- Add dependabot config, linters, metadata #119
- Fix edge case in opa.test.workspace activation #120
- Dependabot updates #121, #122, #123, #126, #127
- Update vscode engine #128

## 0.13.4

- Add configuration to set environment variables for opa subprocess #103
- Use .jsonc extension for output.json #104
- Address issue in Regal LS startups #105
- Fix for OPA: Evaluate Package fails on some systems #108
- Allow ${workspaceFolder} to be used in env var values #110

## 0.13.0

- Support for [Regal](https://docs.styra.com/regal) Language server.

## 0.12.0

- Keyword highligting for `if` and `contains`

## 0.11.0

- Adding support for compiler strict-mode (`--strict`) for OPA `check` command
- Adding support for Running OPA commands on single files outside of a workspace
- Syntax highlighting of the `every` keyword

## 0.10.0

- Resolve `${workspaceFolder}` variable in `opa.path` setting
- Fixing issue where 'Check File Syntax' command produces no output
- Fixing error thrown when `opa.path` setting not set
- Adding `opa.schema` setting
