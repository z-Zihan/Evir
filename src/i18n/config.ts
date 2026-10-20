import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

/**
 * English is the product default. The browser/system language is not used as a
 * signal; only an explicit user choice persisted under `evir-language` wins.
 */
function initialLanguage(): string {
  const stored =
    typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage.getItem("evir-language");
  return stored ?? "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

i18n.on("languageChanged", (language) => {
  if (typeof globalThis.localStorage !== "undefined") {
    globalThis.localStorage.setItem("evir-language", language);
  }
  if (typeof globalThis.document !== "undefined") {
    globalThis.document.documentElement.lang = language;
  }
});

export default i18n;
