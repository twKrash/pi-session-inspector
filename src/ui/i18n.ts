import { createInstance, type InterpolationOptions } from "i18next";

import {
  ENGLISH_CATALOG,
  type MessageKey,
  type MessageValues,
} from "./i18n/catalog.ts";

export type Translator = (key: MessageKey, values?: MessageValues) => string;

/**
 * The one interpolation value formatter. A number handed to a key is formatted
 * here, once, so a count reads the same on every surface and a plural form
 * (`…_one`) can still be selected: a pre-formatted string would neither group
 * its digits nor resolve to its singular form.
 */
type NumberFormatter = (
  value: unknown,
  format: string | undefined,
  lng: string | undefined,
) => string;

/**
 * Creates the one explicit local translator used by presentation surfaces.
 * There is no detector, backend, persistence, or asynchronous resource load.
 */
export function createTranslator(locale = "en"): Translator {
  const instance = createInstance();
  // The pinned i18next types omit `interpolation.format` even though the option
  // is part of the API it documents; the intersection keeps that one option
  // typed rather than widening the whole init call.
  const interpolation: InterpolationOptions & { format: NumberFormatter } = {
    prefix: "{",
    suffix: "}",
    escapeValue: false,
    // A catalog value may carry a format (`{count, number}`), which is what lets
    // a counted key group its digits *and* resolve to its singular form.
    formatSeparator: ",",
    format: (value, _format, lng) =>
      typeof value === "number"
        ? new Intl.NumberFormat(lng ?? "en").format(value)
        : String(value),
  };
  void instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH_CATALOG } },
    keySeparator: false,
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    saveMissing: false,
    debug: false,
    interpolation,
  });

  return (key, values) => instance.t(key, values);
}
