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
    "tui global",
    "json ledger",
    "json history --scope active",
    "json global --scope active",
    "tui --theme dark",
    "json --theme light",
    "tui --output /tmp/x.json",
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
  assert.equal(reportOptions("ui --no-open --output /tmp/a.html").noOpen, true);
  assert.equal(
    reportOptions("json --output 'C:\\reports\\my file.json'").output,
    "C:\\reports\\my file.json",
  );
});

test("scanned tokens carry raw spans and the parser's own text", () => {
  const scanned = scanInspectorArgs('ui --output "/tmp/my report.json" --th');
  assert.deepEqual(
    scanned?.tokens.map((token) => [
      token.raw,
      token.start,
      token.end,
      token.quoted,
    ]),
    [
      ["ui", 0, 2, false],
      ["--output", 3, 11, false],
      ['"/tmp/my report.json"', 12, 33, true],
      ["--th", 34, 38, false],
    ],
  );
  assert.equal(scanned?.tokens[2]?.text, "/tmp/my report.json");
  assert.equal(scanned?.trailingWhitespace, false);
});

test("the scanner keeps the parser's quote behaviour exactly", () => {
  const single = scanInspectorArgs("json history --output '/tmp/a b.json'");
  assert.deepEqual(
    [single?.tokens.at(-1)?.text, single?.tokens.at(-1)?.quoted],
    ["/tmp/a b.json", true],
  );
  const midToken = scanInspectorArgs('ui --output="/tmp/a b.json" --th');
  assert.deepEqual(
    midToken?.tokens.map((token) => token.text),
    ["ui", "--output=/tmp/a b.json", "--th"],
  );
  assert.equal(midToken?.tokens[1]?.raw, '--output="/tmp/a b.json"');
  assert.equal(scanInspectorArgs('ui --output="/tmp/a b.json'), undefined);
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
    'ui --output="/tmp/a b.json" --th',
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
