import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INSPECTOR_OPTION_ARITY,
  INSPECTOR_OPTIONS,
  type InspectorCommand,
  parseInspectorCommand,
  scanInspectorArgs,
  tokenizeInspectorArgs,
} from "../../src/commands/grammar.ts";

const report = (args: string): InspectorCommand => {
  const parsed = parseInspectorCommand(args);
  assert.equal(parsed.ok, true, args);
  if (!parsed.ok) throw new Error(`expected a parsed command: ${args}`);
  return parsed.command;
};

/** Narrows to a report command for tests that read its fields. */
const reportOptions = (args: string) => {
  const command = report(args);
  if (command.kind !== "report") {
    throw new Error(`expected a report command: ${args}`);
  }
  return command;
};

test("parses the documented positional modes, targets, and options", () => {
  assert.deepEqual(report(""), {
    kind: "report",
    mode: "tui",
    target: "current",
    scope: "active",
    noOpen: false,
  });
  assert.deepEqual(report("ui"), {
    kind: "report",
    mode: "ui",
    target: "current",
    scope: "active",
    noOpen: false,
  });
  assert.deepEqual(report("ui --theme dark --scope tree"), {
    kind: "report",
    mode: "ui",
    target: "current",
    scope: "tree",
    theme: "dark",
    noOpen: false,
  });
  assert.equal(parseInspectorCommand("snapshot").ok, false);
  assert.deepEqual(report("snapshot current --scope tree --preset 7"), {
    kind: "report",
    mode: "snapshot",
    target: "current",
    scope: "tree",
    range: { kind: "preset", preset: 7 },
    noOpen: false,
  });
  assert.deepEqual(report("snapshot session session-a --theme dark"), {
    kind: "report",
    mode: "snapshot",
    target: "session",
    scope: "tree",
    sessionId: "session-a",
    theme: "dark",
    noOpen: false,
  });
  assert.deepEqual(report("tui ledger"), {
    kind: "report",
    mode: "tui",
    target: "ledger",
    scope: "active",
    noOpen: false,
  });
  assert.deepEqual(report("json history --output '/tmp/report file.json'"), {
    kind: "report",
    mode: "json",
    target: "history",
    scope: "tree",
    output: "/tmp/report file.json",
    noOpen: false,
  });
  assert.deepEqual(report("json global"), {
    kind: "report",
    mode: "json",
    target: "global",
    scope: "tree",
    noOpen: false,
  });
  assert.deepEqual(report("help"), { kind: "help" });
  assert.deepEqual(report("--help"), { kind: "help" });
});

test("rejects invalid combinations and removed syntax with a usable message", () => {
  const cases = [
    "ui history",
    "ui --output report.html",
    "ui --preset 7",
    "tui global",
    "json ledger",
    "json history --scope active",
    "json global --scope active",
    "tui --theme dark",
    "json --theme light",
    "tui --output /tmp/x.json",
    "snapshot session session-a --scope tree",
    "snapshot session session-a --from 2026-01-01 --to 2026-01-02",
    "snapshot history --scope active",
    "snapshot global --scope tree",
    "snapshot current --preset 7 --from 2026-01-01 --to 2026-01-02",
    "snapshot current --from 2026-02-02",
    "snapshot current --preset 7 --preset 14",
    "snapshot current --output ''",
    "snapshot current --theme dark --theme light",
    "snapshot current --no-open --no-open",
    "json --no-open",
    "--format tui",
    "current",
    "ledger",
    "--subagents-artifact /tmp/x.json",
    "ui --theme blue",
    "ui --scope branch",
    "ui --output",
    "ui 'unterminated",
    // Prototype-member names must not be mistaken for declared options.
    "ui constructor",
    "ui --scope tree constructor",
    "ui --scope tree toString",
    "ui --scope tree hasOwnProperty",
    "ui --scope tree __proto__",
    "ui __proto__",
  ];
  for (const input of cases) {
    const parsed = parseInspectorCommand(input);
    assert.equal(parsed.ok, false, input);
    if (!parsed.ok) {
      assert.match(parsed.message, /Usage|help/i, input);
      assert.equal(
        parsed.message.includes("options are unavailable"),
        false,
        input,
      );
    }
  }
});

test("every option has exactly one arity entry", () => {
  const optionNames = new Set(Object.values(INSPECTOR_OPTIONS).flat());
  const arityNames = Object.keys(INSPECTOR_OPTION_ARITY);
  assert.equal(arityNames.length, optionNames.size);
  for (const name of optionNames) {
    assert.equal(typeof INSPECTOR_OPTION_ARITY[name], "string", name);
  }
  for (const name of arityNames) {
    assert.equal(optionNames.has(name), true, name);
  }
});

test("keeps documented target defaults and output ownership", () => {
  assert.equal(reportOptions("json").target, "current");
  assert.equal(reportOptions("json").scope, "active");
  assert.equal(reportOptions("ui --no-open").noOpen, true);
  assert.equal(
    reportOptions("snapshot current --output '/tmp/a.html'").output,
    "/tmp/a.html",
  );
  assert.equal(
    reportOptions("json --output 'C:\\reports\\my file.json'").output,
    "C:\\reports\\my file.json",
  );
});

test("scanned tokens carry raw spans and the parser's own text", () => {
  const scanned = scanInspectorArgs(
    'snapshot current --output "/tmp/my report.html" --th',
  );
  assert.deepEqual(
    scanned?.tokens.map((token) => [
      token.raw,
      token.start,
      token.end,
      token.quoted,
    ]),
    [
      ["snapshot", 0, 8, false],
      ["current", 9, 16, false],
      ["--output", 17, 25, false],
      ['"/tmp/my report.html"', 26, 47, true],
      ["--th", 48, 52, false],
    ],
  );
  assert.equal(scanned?.tokens[3]?.text, "/tmp/my report.html");
  assert.equal(scanned?.trailingWhitespace, false);
});

test("the scanner keeps the parser's quote behaviour exactly", () => {
  const single = scanInspectorArgs("snapshot history --output '/tmp/a b.html'");
  assert.deepEqual(
    [single?.tokens.at(-1)?.text, single?.tokens.at(-1)?.quoted],
    ["/tmp/a b.html", true],
  );
  const midToken = scanInspectorArgs(
    'snapshot current --output="/tmp/a b.html" --th',
  );
  assert.deepEqual(
    midToken?.tokens.map((token) => token.text),
    ["snapshot", "current", "--output=/tmp/a b.html", "--th"],
  );
  assert.equal(midToken?.tokens[2]?.raw, '--output="/tmp/a b.html"');
  assert.equal(
    scanInspectorArgs('snapshot current --output="/tmp/a b.html'),
    undefined,
  );
});

test("the stripped tokenizer is a projection of the scanner", () => {
  const prefix = 'json history --output "/tmp/a b.json" ';
  assert.deepEqual(tokenizeInspectorArgs(prefix)?.tokens, [
    "json",
    "history",
    "--output",
    "/tmp/a b.json",
  ]);
  assert.equal(
    tokenizeInspectorArgs(prefix)?.trailingWhitespace,
    scanInspectorArgs(prefix)?.trailingWhitespace,
  );
  // The scanner's spans index the original input, and the projected tokenizer
  // agrees with it on both the text and the trailing-whitespace flag.
  const corpus = [
    "",
    "   ",
    "ui",
    "ui ",
    "ui --scope tree",
    "tui current --scope active",
    "json history --output '/tmp/x y.json'",
    'snapshot current --output="/tmp/a b.html" --th',
    "ui --theme ''",
    '" json " history',
  ];
  for (const input of corpus) {
    const scanned = scanInspectorArgs(input);
    for (const token of scanned?.tokens ?? []) {
      assert.equal(input.slice(token.start, token.end), token.raw, input);
    }
    assert.deepEqual(
      tokenizeInspectorArgs(input)?.tokens,
      scanned?.tokens.map((token) => token.text),
      input,
    );
    assert.equal(
      tokenizeInspectorArgs(input)?.trailingWhitespace,
      scanned?.trailingWhitespace,
      input,
    );
  }
});
