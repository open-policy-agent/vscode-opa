# vscode-opa

## Features

* Check Syntax on Save
* Reformat File on Save
* Evaluate Packages
* Evaluate Selections
* Partially Evaluate Selections
* Trace Selections
* Profile Selections
* Run Tests in Workspace
* Toggle Coverage in Workspace
* Toggle Coverage of Selections

![Eval](https://raw.githubusercontent.com/tsandall/vscode-opa/master/eval.gif)

## Requirements

* This plugin requires the [Open Policy Agent](https://github.com/open-policy-agent/opa) executable (`opa`) to be installed in your $PATH. Alternatively, you can configure the `opa.path` setting to point to the executable. If you do not have OPA installed, the plugin will prompt you to install the executable the first time you evaluate a policy, run tests, etc.

## Installation

Search for "Open Policy Agent" in the Extensions (Shift ⌘ X) panel and then install and reload the extension.

## Configuration

| Field | Default | Description |
| --- | --- | --- |
| `opa.path` | `null` | Set path of OPA executable. |
| `opa.checkOnSave` | `false` | Enable automatic checking of .rego files on save. |
| `opa.roots` | `[${workspaceFolder}]` | List of paths to load as bundles for policy and data. Defaults to a single entry which is the current workspace root. The variable `${workspaceFolder}` will be resolved as the current workspace root. The variable `${fileDirname}` will be resolved as the directory of the file currently opened in the active window. |
| `opa.bundleMode`  | `true`  | Enable treating the workspace as a bundle to avoid loading erroneous data JSON/YAML files. It is _NOT_ recommended to disable this. |
| `opa.schema` | `null` | Path to the schema file or directory. If set to `null`, schema evaluation is disabled. As for `opa.roots`, `${workspaceFolder}` and `${fileDirname}` variables can be used in the path. |
| `editor.formatOnSave` | `false` | Enables reformat the current document on save by using `opa fmt`. |

> For bundle documentation refer to [https://www.openpolicyagent.org/docs/latest/management/#bundle-file-format](https://www.openpolicyagent.org/docs/latest/management/#bundle-file-format).
  Note that data files *MUST* be named either `data.json` or `data.yaml`.

## Tips

### Set the `input` document by creating `input.json`

The extension will look for a file called `input.json` in the current directory of the policy file being evaluated, or at the root of the workspace, and will use it as the `input` document when evaluating policies. If you modify this file and re-run evaluation you will see the affect of the changes.

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

### Loading arbitrary JSON/YAML as data

If unable to use `data.json` or `data.yaml` files with `opa.bundleMode` enabled
you can disable the configuration option and *ALL* `*.json` and `*.yaml` files
will be loaded from the workspace

## Development

If you want to hack on the extension itself, you should clone this repository, install the dependencies (`npm install`) and use Visual Studio Code's Debugger (F5) to test your changes.

## ROADMAP

* [ ] run `opa test` on package instead of entire workspace
* [ ] highlight syntax errors in file
