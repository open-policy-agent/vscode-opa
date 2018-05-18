# vscode-opa

## Features

* Check Syntax on Save
* Evaluate Packages
* Evaluate Selections
* Trace Selections
* Run Tests in Workspace
* Toggle Coverage in Worskspace

![Eval](https://raw.githubusercontent.com/tsandall/vscode-opa/master/eval.gif)

## Requirements

This plugin requires the [Open Policy Agent](https://github.com/open-policy-agent/opa) executable (`opa`) to be installed in your $PATH. Alternatively, you can configure the `opa.path` setting to point to the executable. If you do not have OPA installed, the plugin will prompt you to install the executable the first time you evaluate a policy, run tests, etc.

## Installation

Search for "Open Policy Agent" in the Extensions (Shift ⌘ X) panel and then install and reload the extension.

## Development

If you want to hack on the extension itself, you should clone this repository and use Visual Studio Code's Debugger (F5) to test your changes.

## ROADMAP

* [ ] run `opa fmt` on save to reformat file
* [ ] run `opa test` on package instead of entire workspace
* [ ] highlight syntax errors in file
