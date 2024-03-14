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
* Start and show messages from the [Regal](https://docs.styra.com/regal) Language server

![Use of the extension to lint and eval Rego code](https://raw.githubusercontent.com/open-policy-agent/vscode-opa/master/eval.gif)

## Requirements

* This plugin requires the [Open Policy Agent](https://github.com/open-policy-agent/opa) executable (`opa`) to be installed in your $PATH. Alternatively, you can configure the `opa.dependency_paths.opa` setting to point to the executable. If you do not have OPA installed, the plugin will prompt you to install the executable the first time you evaluate a policy, run tests, etc.

## Installation

Search for "Open Policy Agent" in the Extensions (Shift ⌘ X) panel and then install and reload the extension.

## Configuration

| Field | Default | Description |
| --- | --- | --- |
| `opa.dependency_paths.opa` | `null` | Set path of OPA executable. If the path contains the string `${workspaceFolder}` it will be replaced with the current workspace root. E.g., if the path is set to `${workspaceFolder}/bin/opa` and the current workspace root is `/home/alice/project`, the OPA executable path will resolve to `/home/alice/project/bin/opa`. |
| `opa.checkOnSave` | `false` | Enable automatic checking of .rego files on save. |
| `opa.strictMode` | `false` | Enable [strict-mode](https://www.openpolicyagent.org/docs/latest/strict/) for the `OPA: Check File Syntax command`. |
| `opa.roots` | `[${workspaceFolder}]` | List of paths to load as bundles for policy and data. Defaults to a single entry which is the current workspace root. The variable `${workspaceFolder}` will be resolved as the current workspace root. The variable `${fileDirname}` will be resolved as the directory of the file currently opened in the active window. |
| `opa.bundleMode`  | `true`  | Enable treating the workspace as a bundle to avoid loading erroneous data JSON/YAML files. It is _NOT_ recommended to disable this. |
| `opa.schema` | `null` | Path to the [schema](https://www.openpolicyagent.org/docs/latest/schemas/) file or directory. If set to `null`, schema evaluation is disabled. As for `opa.roots`, `${workspaceFolder}` and `${fileDirname}` variables can be used in the path. |
| `editor.formatOnSave` | `false` | Enable reformatting the current document on save by using `opa fmt`. |
| `opa.languageServers` | `null` | An array of enabled language servers (currently `["regal"]` is supported) |
| `opa.env` | `{}` | Object of environment variables passed to the process running OPA (e.g. `{"key": "value"}`) |

Note that the `${workspaceFolder}` variable will expand to a full URI of the workspace, as expected by most VS Code commands. The `${workspacePath}` variable may additionally be used where only the path component (i.e. without the `file://` schema component) of the workspace URI is required.

> For bundle documentation refer to [https://www.openpolicyagent.org/docs/latest/management/#bundle-file-format](https://www.openpolicyagent.org/docs/latest/management/#bundle-file-format).
  Note that data files *MUST* be named either `data.json` or `data.yaml`.

### Using `opa.env` to set OPA command line flags

From OPA v0.62.0 and onwards, it's possible to set any command line flag via environment variables as an alternative to arguments to the various `opa` commands. This allows using the `opa.env` object for setting any flag to the commmands executed by the extension. The format of the environment variables follows the pattern `OPA_<COMMAND>_<FLAG>` where `COMMAND` is the command name in uppercase (like `EVAL`) and `FLAG` is the flag name in uppercase (like `IGNORE`). For example, to set the `--capabilities` flag for the `opa check` and `opa eval` command, use the following configuration in your `.vscode/settings.json` file:

```json
{
    "opa.env": {
        "OPA_CHECK_CAPABILITIES": "${workspacePath}/misc/capabilities.json",
        "OPA_EVAL_CAPABILITIES": "${workspacePath}/misc/capabilities.json"
    }
}
```

## Tips

### Set the `input` document by creating `input.json`

The extension will look for a file called `input.json` in the current directory of the policy file being evaluated, or at the root of the workspace, and will use it as the `input` document when evaluating policies. If you modify this file and re-run evaluation you will see the affect of the changes.

### Bind keyboard shortcuts for frequently used commands

Open the keyboard shortcuts file (`keybindings.json`) for VS Code (⌘ Shift p → `Preferences: Open Keyboard Shortcuts File`) and add the following JSON snippets.

Bind the `OPA: Evaluate Selection` command to a keyboard shortcut (e.g., ⌘ e) to quickly evaluate visually selected blocks in the policy.

```json
{
    "key": "cmd+e",
    "command": "opa.eval.selection",
    "when": "editorLangId == rego"
}
```

Bind the `OPA: Evaluate Package` command to a keyboard shortcut (e.g., ⌘ Shift a) to quickly evaluate the entire package and see all of the decisions.

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
will be loaded from the workspace.

## Debugging OPA command evaluation

In case some command isn't behaving as you expect, you can see exactly what command was executed by opening the developer tools from the **Help** menu and check the **Console** tab.

## Development

If you want to hack on the extension itself, you should clone this repository, install the dependencies (`npm install`) and use Visual Studio Code's Debugger (F5) to test your changes.

## ROADMAP

* [x] highlight syntax errors in file (available when using Regal language server)
* [ ] run `opa test` on package instead of entire workspace
