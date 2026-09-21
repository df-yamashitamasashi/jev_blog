/**
 * 8-Language Localization Manager (i18n)
 * Clean Architecture - Presentation Layer
 */

import { LanguageCode, I18N_DICTIONARIES, TranslationDictionary } from "../domain/i18nTypes";

export class I18nManager {
  private currentLang: LanguageCode = "ja";
  private listeners: Array<(lang: LanguageCode) => void> = [];

  constructor(initialLang?: LanguageCode) {
    if (initialLang) {
      this.currentLang = initialLang;
    } else if (typeof window !== "undefined") {
      const saved = localStorage.getItem("jev_lang") as LanguageCode;
      if (saved && I18N_DICTIONARIES[saved]) {
        this.currentLang = saved;
      }
    }
  }

  get language(): LanguageCode {
    return this.currentLang;
  }

  setLanguage(lang: LanguageCode): void {
    if (I18N_DICTIONARIES[lang]) {
      this.currentLang = lang;
      if (typeof window !== "undefined") {
        localStorage.setItem("jev_lang", lang);
        this.updateDom();
      }
      this.listeners.forEach((cb) => cb(lang));
    }
  }

  onLanguageChange(callback: (lang: LanguageCode) => void): void {
    this.listeners.push(callback);
  }

  /**
   * 辞書キーから翻訳テキストを取得（{param}の展開対応）
   */
  t(key: keyof TranslationDictionary, params?: Record<string, string | number>): string {
    const dict = I18N_DICTIONARIES[this.currentLang] || I18N_DICTIONARIES.ja;
    let text = dict[key] || (I18N_DICTIONARIES.ja[key] ?? String(key));

    if (params) {
      for (const [pKey, pVal] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${pKey}\\}`, "g"), String(pVal));
      }
    }
    return text;
  }

  /**
   * DOM内の [data-i18n] 要素を一括更新
   */
  updateDom(): void {
    if (typeof document === "undefined") return;

    // テキストコンテンツ
    const elements = document.querySelectorAll<HTMLElement>("[data-i18n]");
    elements.forEach((el) => {
      const key = el.getAttribute("data-i18n") as keyof TranslationDictionary;
      if (key) {
        el.textContent = this.t(key);
      }
    });

    // プレースホルダー
    const placeholders = document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]");
    placeholders.forEach((input) => {
      const key = input.getAttribute("data-i18n-placeholder") as keyof TranslationDictionary;
      if (key) {
        input.placeholder = this.t(key);
      }
    });
  }

  /**
   * 装備アイテムのローカライズ表示名を取得
   */
  getEquipmentName(nameKey: string): string {
    const eqKey = `eq_${nameKey}` as keyof TranslationDictionary;
    return this.t(eqKey);
  }
}
