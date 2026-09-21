/**
 * 8-Language Localization Manager (i18n)
 * Clean Architecture - Presentation Layer
 */

import { LanguageCode, I18N_DICTIONARIES, TranslationDictionary } from "../domain/i18nTypes";
import { MonsterDNA, DNA_CATALOG } from "../domain/dnaModels";

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
   * モンスターのDNAとレア度から、現在言語に即した名前を自然に合成
   */
  getMonsterName(dna: MonsterDNA, rarity: string): string {
    const palette = DNA_CATALOG.palettes.find((p) => p.id === dna.paletteGene) || DNA_CATALOG.palettes[0];
    const body = DNA_CATALOG.bodies.find((b) => b.id === dna.bodyGene) || DNA_CATALOG.bodies[0];

    const prefixKey = `prefix_${palette.id.replace("p_", "")}` as keyof TranslationDictionary;
    const raceKey = `race_${body.nameKey}` as keyof TranslationDictionary;

    const prefix = this.t(prefixKey);
    const race = this.t(raceKey);

    let suffix = "";
    if (rarity === "Rare") {
      suffix = this.t("suffix_knight");
    } else if (rarity === "Epic") {
      suffix = this.t("suffix_lord");
    } else if (rarity === "Legendary") {
      suffix = this.t("suffix_king");
    }

    if (this.currentLang === "ja" || this.currentLang === "zh" || this.currentLang === "ko") {
      return `${prefix}${race}${suffix ? suffix : ""}`;
    } else if (this.currentLang === "fr" || this.currentLang === "it") {
      return suffix ? `${race} ${suffix} ${prefix}` : `${race} ${prefix}`;
    } else {
      return suffix ? `${prefix} ${race} ${suffix}` : `${prefix} ${race}`;
    }
  }

  /**
   * 装備アイテムのローカライズ表示名を取得
   */
  getEquipmentName(nameKey: string): string {
    const eqKey = `eq_${nameKey}` as keyof TranslationDictionary;
    return this.t(eqKey);
  }
}
