import * as vscode from "vscode";

import { opaOutputShowError } from "./output";

let lastEvalSelectionRange: { fileName: string; startRow: number; endRow: number } | undefined;

export function consumeEvalSelectionCoverageFilter(): (fileName: string, ranges: any[]) => any[] {
  const range = lastEvalSelectionRange;
  lastEvalSelectionRange = undefined;

  return (fileName: string, ranges: any[]) => {
    if (!range || !range.fileName.endsWith(fileName)) {
      return ranges;
    }

    // Coverage inside the evaluated selection reflects the ad-hoc query, not the file, so
    // drop it rather than show it as covered or not covered.
    return ranges.filter((r: any) => !(r.start.row <= range.endRow && r.end.row >= range.startRow));
  };
}

export async function evalSelection(editor: vscode.TextEditor) {
  const selection = editor.selection;
  let lastLine = selection.end.line;
  if (selection.end.character === 0 && lastLine > selection.start.line) {
    lastLine -= 1;
  }

  const args = {
    target: editor.document.uri.toString(),
    // "path" is the regal.eval command's field for the query text, not a file path. It can
    // hold a plain query as well as a rule reference.
    path: editor.document.getText(selection),
    row: lastLine + 1,
  };

  lastEvalSelectionRange = {
    fileName: editor.document.fileName,
    startRow: selection.start.line + 1,
    endRow: lastLine + 1,
  };

  try {
    await vscode.commands.executeCommand("regal.eval", JSON.stringify(args));
  } catch (error) {
    opaOutputShowError(error instanceof Error ? error.message : String(error));
  }
}
