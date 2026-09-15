import { createInstance } from "i18next";

import {
  ENGLISH_CATALOG,
  type MessageKey,
  type MessageValues,
} from "./i18n/catalog.ts";

export type Translator = (key: MessageKey, values?: MessageValues) => string;

/**
 * Creates the one explicit local translator used by presentation surfaces.
 * There is no detector, backend, persistence, or asynchronous resource load.
 *
 * A counted key may carry a format specifier (`{count, number}`). i18next's own
 * number formatter resolves it, so a count groups its digits while the key's
 * singular form (`…_one`) is still selected from the same value: a
 * pre-formatted string would do neither. `formatSeparator` is written out
 * because the catalog depends on that comma being the separator.
 */
export function createTranslator(locale = "en"): Translator {
  const instance = createInstance();
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
    interpolation: {
      prefix: "{",
      suffix: "}",
      escapeValue: false,
      formatSeparator: ",",
    },
  });

  return (key, values) => instance.t(key, values);
}
