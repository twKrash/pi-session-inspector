/**
 * The browser's range intent grammar (`/range.js`): exactly the two bounded
 * forms the API accepts, parsed into an intent and serialized back into
 * canonical query pairs.
 *
 *   preset=7|14|30
 *   from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * An intent is what the interface chose, not what the report shows: this module
 * resolves no range, computes no span, filters no row and reads no clock. A
 * well-formed pair is passed through as written, and the API remains the
 * authority that validates it against real calendar dates, presets, and bounds.
 */
(function () {
  "use strict";
  const web = (globalThis.SessionInspectorWeb =
    globalThis.SessionInspectorWeb || {});

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const PRESETS = [7, 14, 30];
  /** The bounded query text this grammar reads, matching the API's own bound. */
  const MAX_LENGTH = 512;
  const INVALID = { ok: false, code: "invalid-range" };

  /**
   * Parses a query string into one intent. Empty input succeeds without an
   * intent; a known preset or a complete, non-inverted `from`/`to` pair succeeds
   * with one. Mixed preset/endpoint forms, lone endpoints, unknown keys,
   * duplicates, empty values and oversized text are rejected as a whole, never
   * partially applied.
   */
  function parse(query) {
    if (typeof query !== "string" || query.length > MAX_LENGTH) return INVALID;
    if (query === "") return { ok: true };
    const params = new Map();
    const parts = query.split("&");
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const separator = part.indexOf("=");
      if (separator < 1) return INVALID;
      let name;
      let value;
      try {
        name = decodeURIComponent(part.slice(0, separator));
        value = decodeURIComponent(part.slice(separator + 1));
      } catch (error) {
        return INVALID;
      }
      if (
        (name !== "preset" && name !== "from" && name !== "to") ||
        value === "" ||
        params.has(name)
      ) {
        return INVALID;
      }
      params.set(name, value);
    }
    const preset = params.get("preset");
    if (preset !== undefined) {
      if (params.has("from") || params.has("to")) return INVALID;
      const days = Number(preset);
      return PRESETS.indexOf(days) < 0 || String(days) !== preset
        ? INVALID
        : { ok: true, intent: { kind: "preset", preset: days } };
    }
    const from = params.get("from");
    const to = params.get("to");
    if (from === undefined || to === undefined) return INVALID;
    if (!DATE.test(from) || !DATE.test(to) || from > to) return INVALID;
    return { ok: true, intent: { kind: "custom", from: from, to: to } };
  }

  /** The canonical query pairs of one intent; an unusable intent emits none. */
  function serialize(intent) {
    if (intent === null || intent === undefined) return [];
    if (intent.kind === "preset") {
      return PRESETS.indexOf(intent.preset) < 0
        ? []
        : [["preset", String(intent.preset)]];
    }
    if (
      intent.kind === "custom" &&
      DATE.test(intent.from) &&
      DATE.test(intent.to) &&
      intent.from <= intent.to
    ) {
      return [
        ["from", intent.from],
        ["to", intent.to],
      ];
    }
    return [];
  }

  /** The one query string of one intent, or the empty text for no intent. */
  function query(intent) {
    const pairs = serialize(intent);
    if (pairs.length === 0) return "";
    const parts = [];
    for (let index = 0; index < pairs.length; index += 1) {
      parts.push(pairs[index][0] + "=" + pairs[index][1]);
    }
    return parts.join("&");
  }

  web.range = {
    presets: PRESETS,
    parse: parse,
    serialize: serialize,
    query: query,
  };
})();
