import * as vscode from "vscode";

// log: true creates a LogOutputChannel, required for traceOutputChannel in LanguageClientOptions
export const opaOutputChannel = vscode.window.createOutputChannel("OPA & Regal", { log: true });

export function opaOutputShow(msg: string) {
  opaOutputChannel.clear();
  opaOutputChannel.append(msg);
  opaOutputChannel.show(true);
}

export function opaOutputShowError(error: string) {
  opaOutputChannel.clear();
  opaOutputChannel.append(formatErrors(error));
  opaOutputChannel.show(true);
}

function formatErrors(error: string): string {
  try {
    const output = JSON.parse(error);
    let errors;
    if (output.error !== undefined) {
      if (!Array.isArray(output.error)) {
        errors = [output.error];
      } else {
        errors = output.error;
      }
    } else if (output.errors !== undefined) {
      errors = output.errors;
    }
    const msg = [];
    for (let i = 0; i < errors.length; i++) {
      let location_prefix;
      if (errors[i].location.file !== "") {
        location_prefix = `${errors[i].location.file}:${errors[i].location.row}`;
      } else {
        location_prefix = `<query>`;
      }
      msg.push(`${location_prefix}: ${errors[i].code}: ${errors[i].message}`);
    }
    return msg.join("\n");
  } catch (_) {
    return error;
  }
}
