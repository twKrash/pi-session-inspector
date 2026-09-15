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
    },
  });

  return (key, values) => instance.t(key, values);
}
