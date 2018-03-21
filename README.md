# vscode-opa

## Features

* Evaluate Packages
* Evaluate Selections
* Trace Selections
* Run Tests in Workspace
* Toggle Coverage in Worskspace

![Eval](https://raw.githubusercontent.com/tsandall/vscode-opa/master/eval.gif)

## Requirements

The plugin requires the latest version of the [Open Policy Agent](https://github.com/open-policy-agent/opa) and the `opa` executable must be installed in your `$PATH`. For example:

1. Clone OPA repository to build from source.

    ```bash
    git clone https://github.com/open-policy-agent/opa.git ~/go/src/github.com/open-policy-agent/opa
    ```

1. Build OPA from source and install into `$GOPATH/bin`.

    ```
    cd ~/go/src/github.com/open-policy-agent/opa
    make install
    ```

1. Add `~/go/bin` to your `$PATH`.

    ```
    export PATH=$PATH:~/go/bin
    ```

## Install

This extension is still under early development. To install the extension, clone
this repository into your VS Code extensions directory and build the extension
from source. For example:

```bash
git clone https://github.com/tsandall/vscode-opa ~/.vscode/extensions/vscode-opa
cd ~/.vscode/extensions/vscode-opa
npm install
npm run compile
```

## ROADMAP

[ ] run `opa check` on file change to catch compile errors
[ ] run `opa fmt` no save to reformat file
[ ] run `opa test` on package (current support tests entire workspace)
