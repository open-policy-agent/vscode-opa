# vscode-opa

## Features

* Check Syntax on Save
* Evaluate Packages
* Evaluate Selections
* Partially Evaluate Selections
* Trace Selections
* Profile Selections
* Run Tests in Workspace
* Toggle Coverage in Worskspace

![Eval](https://raw.githubusercontent.com/tsandall/vscode-opa/master/eval.gif)

## Requirements

* This plugin requires the [Open Policy Agent](https://github.com/open-policy-agent/opa) executable (`opa`) to be installed in your $PATH. Alternatively, you can configure the `opa.path` setting to point to the executable. If you do not have OPA installed, the plugin will prompt you to install the executable the first time you evaluate a policy, run tests, etc.

## Installation

Search for "Open Policy Agent" in the Extensions (Shift ⌘ X) panel and then install and reload the extension.

## Tips

### Set the `input` document by creating `input.json` at the root of your workspace.

The extension will look for a file called `input.json` in the root of the workspace to specify for the `input` document when you evaluate policies. If you modify this file and re-run evaluation you will see the affect of the changes.

### Bind keyboard shortcuts for frequently used commands.

Open the keyboard shortcuts file (`keybindings.json`) for VS Code (⌘ Shift p → `Preferences: Open Keyboard Shortcuts File`) and add the following JSON snippets.

Bind the `OPA: Evaluate Selection` command to a keyboard shortcut (e.g., ⌘ e) to quickly evaluate visually selected blocks in the policy.

```json
{
    "key": "cmd+e",
    "command": "opa.eval.selection",
    "when": "editorLangId == rego"
}
```

Bind the `OPA: Evaluate Package` command to a keyboard shortcut (e.g., ⌘ Shift a) to quickly evaluate the entire package adn see all of the decisions.

```json
{
    "key": "shift+cmd+a",
    "command": "opa.eval.package",
    "when": "editorLangId == rego"
}
```

## Development

If you want to hack on the extension itself, you should clone this repository, install the dependencies (`npm install`) and use Visual Studio Code's Debugger (F5) to test your changes.

## ROADMAP

* [ ] run `opa fmt` on save to reformat file
* [ ] run `opa test` on package instead of entire workspace
* [ ] highlight syntax errors in file
