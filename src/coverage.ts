import * as vscode from "vscode";

const coverageKindDocs: Record<string, string> = {
  index_excluded: "https://www.openpolicyagent.org/docs/policy-performance#use-indexed-statements",
  early_exit: "https://www.openpolicyagent.org/docs/policy-performance#early-exit-in-rule-evaluation",
};

// toDecoration builds a hover message that shows the coverage status. If
// kinds are present (index_excluded, early_exit), it adds links to them.
export function toDecoration(
  range: any,
  status: "covered" | "not_covered",
  kinds: string[] = [],
): vscode.DecorationOptions {
  const title = status === "covered" ? "Covered" : "Not Covered";
  const kindLinks = kinds.map(kind => {
    const url = coverageKindDocs[kind];
    return url ? `[\`${kind}\`](${url})` : `\`${kind}\``;
  });

  const hoverMessage = kindLinks.length > 0
    ? new vscode.MarkdownString(`${title} ${kindLinks.join(", ")}`)
    : title;

  return { range: toVscodeRange(range), hoverMessage };
}

// toVscodeRange converts an OPA cover.Range to a vscode.Range. It uses
// columns when present, so it can highlight part of a line.
function toVscodeRange(range: any): vscode.Range {
  const startRow = range.start.row - 1;
  const endRow = range.end.row - 1;
  if (range.start.col && range.end.col) {
    return new vscode.Range(startRow, range.start.col - 1, endRow, range.end.col - 1);
  }
  return new vscode.Range(startRow, 0, endRow, 1000);
}
