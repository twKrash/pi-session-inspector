import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { InspectorBundle } from "../../src/ui/bundle.ts";
import { renderInspectorBundle } from "../../src/ui/html.ts";

// biome-ignore lint/suspicious/noExplicitAny: decoding the report's embedded JSON in tests
function embeddedJson(html: string): Record<string, any> {
  const match =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  return JSON.parse(match?.[1] ?? "{}");
}

function bundleFixture(): InspectorBundle {
  return JSON.parse(
    readFileSync(
      new URL("../fixtures/bundles/inspector-bundle.json", import.meta.url),
      "utf8",
    ),
  ) as InspectorBundle;
}

test("renders one offline document with both current views and initial theme", () => {
  const html = renderInspectorBundle(bundleFixture());
  const data = embeddedJson(html);

  assert.match(html, /class="[^"]*theme-dark/);
  assert.equal(data.initialScope, "tree");
  assert.equal(data.current.active.report.sessionId, "session-a");
  assert.equal(data.current.tree.report.sessionId, "session-a");
  assert.equal(data.history.sessions.length, 2);
  assert.equal(data.global.daily.length > 0, true);
  assert.equal(renderInspectorBundle(bundleFixture()), html);

  // No network surface and no raw records.
  for (const leak of [
    "http://",
    "https://",
    "<script src",
    "PRIVATE",
    "promptGuidelines",
  ]) {
    assert.equal(html.includes(leak), false, leak);
  }
});

test("renders inventory, resources, agent activity, integration presence, and error messages", () => {
  const html = renderInspectorBundle(bundleFixture());
  const data = embeddedJson(html);

  assert.equal(data.current.tree.report.commands.items.length, 1);
  assert.equal(data.current.tree.report.resources.items.length, 2);
  assert.equal(data.current.tree.report.agentActivity.calls, 3);
  assert.equal(
    data.current.tree.report.integrations.some(
      (row: { presence: string }) => row.presence === "absent",
    ),
    true,
  );
  assert.equal(
    data.current.tree.report.errors[0].message,
    "429 rate limit from [URL]",
  );
  assert.equal(data.current.tree.report.skills.otherInvocations, 1);
  assert.equal(html.includes("inventory ≠ invocations"), true);
});

test("switches precomputed current views offline without host calls", () => {
  const html = renderInspectorBundle(bundleFixture());

  for (const fragment of [
    "data.current[state.scope]",
    "state.scope=",
    "periods[state.section]",
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
  // No host round-trip, no fetch, no client-side replay of raw records.
  assert.equal(
    /fetch\(|XMLHttpRequest|WebSocket|EventSource/.test(html),
    false,
  );
  assert.equal(
    /data\.(report\.)?(generations|compactions)\b/.test(html),
    false,
  );
});

test("disables an unavailable current view with its bounded diagnostic", () => {
  const bundle = bundleFixture();
  bundle.current.active = {
    availability: "unavailable",
    diagnostic: "current-unavailable",
  };
  const html = renderInspectorBundle(bundle);
  const data = embeddedJson(html);

  assert.equal(data.current.active.availability, "unavailable");
  assert.equal(data.current.active.report, undefined);
  assert.equal(data.current.tree.availability, "available");
  assert.equal(html.includes("button.disabled=unavailable"), true);
});

test("fills the evidence tabs with reviewed copy and columns", () => {
  const html = renderInspectorBundle(bundleFixture());

  for (const fragment of [
    'tr("commands.note")',
    'tr("skills.note")',
    'tr("table.invocations")',
    'tr("skills.otherInvocations"',
    'tr("panel.resources")',
    'tr("agents.activity.note")',
    "PRESENCE_LABELS",
    'tr("table.message")',
    "orUnavailable(row.source)",
    "orUnavailable(row.sourceLabel||row.source||null)",
  ]) {
    assert.equal(html.includes(fragment), true, fragment);
  }
});

test("renders a bounded truncation notice only when the active view was capped", () => {
  const untruncated = renderInspectorBundle(bundleFixture());

  // An uncapped view ships no notice element at all; the copy still lives in
  // the translated catalog, but nothing renders it.
  assert.equal(
    untruncated.includes('<p class="range-note" id="range-truncated"'),
    false,
  );

  const bundle = bundleFixture();
  bundle.current.tree.dailyTruncated = true;
  const html = renderInspectorBundle(bundle);
  const data = embeddedJson(html);

  assert.equal(data.current.tree.dailyTruncated, true);
  assert.match(
    html,
    /<p class="range-note" id="range-truncated">Older days beyond the retained window are not shown\.<\/p>/,
  );
  // The notice is the only change: no rows are fabricated to fill the window.
  assert.deepEqual(
    data.current.tree.daily,
    embeddedJson(untruncated).current.tree.daily,
  );
  assert.equal(
    /id="range-truncated"[^>]*\shidden/.test(html),
    false,
    "a capped view shows the notice",
  );
});

test("escapes hostile session ids and command names in the bundle payload", () => {
  const hostileSessionId = "session</script><& \u2028 ";
  const hostileCommand = "</script><b>&\u2028 cmd";
  const bundle = bundleFixture();
  const active = bundle.current.active.report;
  const tree = bundle.current.tree.report;
  if (active === undefined || tree === undefined) {
    throw new Error("bundle fixture must carry both current view reports");
  }
  active.sessionId = hostileSessionId;
  tree.sessionId = hostileSessionId;
  tree.commands.items[0].name = hostileCommand;

  const html = renderInspectorBundle(bundle);
  const match =
    /<script type="application\/json" id="report-data">([\s\S]*?)<\/script>/.exec(
      html,
    );
  const payload = match?.[1] ?? "";

  // The payload is valid JSON (it parsed) and every hostile value round-trips.
  const data = embeddedJson(html);
  assert.equal(data.current.active.report.sessionId, hostileSessionId);
  assert.equal(data.current.tree.report.sessionId, hostileSessionId);
  assert.equal(data.current.tree.report.commands.items[0].name, hostileCommand);

  for (const raw of ["<", ">", "&", "\u2028"]) {
    assert.equal(payload.includes(raw), false, `raw ${JSON.stringify(raw)}`);
  }
  assert.equal(payload.includes("</script"), false);
});
