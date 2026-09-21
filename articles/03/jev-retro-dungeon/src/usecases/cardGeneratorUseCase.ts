/**
 * Retro RPG Style TCG Card Generator Use Case
 * Clean Architecture - Use Case Layer
 */

import { Monster, Hero, CardData } from "../domain/models";
import { JevClient } from "../adapters/jevClient";

export class CardGeneratorUseCase {
  constructor(private readonly jevClient: JevClient) {}

  /**
   * 討伐モンスターと戦闘記録からレトロRPG風カードデータを生成
   */
  async generateMonsterCard(
    monster: Monster,
    hero: Hero,
    floor: number
  ): Promise<{
    card: CardData;
    latencyMs: number;
    isSimulated: boolean;
  }> {
    const hpRatio = Math.round((hero.stats.currentHp / hero.stats.maxHp) * 100) / 100;
    const state = {
      monsterName: monster.name,
      monsterType: monster.type,
      monsterElement: monster.element,
      monsterRarity: monster.rarity,
      floor,
      heroHpRemainingRatio: hpRatio,
      heroLevel: hero.stats.level,
      usedWeapon: hero.weapon.name,
    };

    const { response, latencyMs, isSimulated } = await this.jevClient.systemOne({
      state,
      questions: {
        epicTitle: {
          type: "choice",
          instructions: "この討伐劇に冠する二つ名・称号を選択してください",
          criteria: {
            miracle_slayer: "瀕死の死線を潜り抜けた『不撓不屈の勇者』",
            blade_master: "鋭き剣技で一刀両断した『剛剣の勇士』",
            abyss_breaker: "暗黒の魔境を討ち破りし『魔窟の討伐者』",
            dragon_vanquisher: "竜の咆哮を退けた『竜討の英傑』",
            legendary_hero: "歴史に名を刻みし『伝説の英傑』",
          },
        },
        dangerScore: {
          type: "score",
          instructions: "この戦闘の死闘度・ドラマチック度を0.0〜4.0でスコアリングしてください",
          legend: {
            "1": "小競り合い、勇者の圧勝",
            "2": "白熱したコマンドの応酬",
            "3": "死闘、呪文と刃が交錯する緊迫感",
            "4": "奇跡的勝利、残り僅かなHPでの劇的な討伐",
          },
        },
        flavorLore: {
          type: "choice",
          instructions: "カード下部に刻むフレーバーテキストを選択してください",
          criteria: {
            lore_a: "迷宮の深淵に棲みつき、幾多の冒険者を屠ってきた魔物。勇者の刃の前に散った。",
            lore_b: "魔力を帯びたその瞳は暗闇を照らし、侵入者を捕食する。いま、その魂はカードへと封じられた。",
            lore_c: "一撃必殺の牙を持つ凶悪な魔獣。死闘の末に討ち取られ、その名は歴史の1ページとなる。",
            lore_d: "洞窟の主として君臨した脅威。勇者の放ちし一閃により、静寂が訪れた。",
          },
        },
      },
    });

    const titleAns = response.answers["epicTitle"];
    const scoreAns = response.answers["dangerScore"];
    const loreAns = response.answers["flavorLore"];

    const titleMap: Record<string, string> = {
      miracle_slayer: "不撓不屈の勇者",
      blade_master: "剛剣の勇士",
      abyss_breaker: "魔窟の討伐者",
      dragon_vanquisher: "竜討の英傑",
      legendary_hero: "伝説の英傑",
    };

    const loreMap: Record<string, string> = {
      lore_a: "迷宮の深淵に棲みつき、幾多の冒険者を屠ってきた魔物。勇者の刃の前に散った。",
      lore_b: "魔力を帯びたその瞳は暗闇を照らし、侵入者を捕食する。いま、その魂はカードへと封じられた。",
      lore_c: "一撃必殺の牙を持つ凶悪な魔獣。死闘の末に討ち取られ、その名は歴史の1ページとなる。",
      lore_d: "洞窟の主として君臨した脅威。勇者の放ちし一閃により、静寂が訪れた。",
    };

    const chosenTitleKey = titleAns?.type === "choice" ? titleAns.choice : "legendary_hero";
    const dangerScore = scoreAns?.type === "score" ? scoreAns.score : 2.5;
    const chosenLoreKey = loreAns?.type === "choice" ? loreAns.choice : "lore_a";

    const title = titleMap[chosenTitleKey] || "不撓不屈の勇者";
    const flavorText = loreMap[chosenLoreKey] || loreMap.lore_a;

    const speedGrade = monster.agility >= 14 ? "S" : monster.agility >= 9 ? "A" : "B";

    const card: CardData = {
      id: `card_${Date.now()}`,
      title: monster.name,
      subtitle: `【${title}】`,
      monsterType: monster.type,
      element: monster.element,
      rarity: monster.rarity,
      stats: {
        attack: monster.attack,
        defense: monster.defense,
        speed: speedGrade,
        dangerScore,
      },
      dna: monster.dna,
      flavorText,
      slayerName: "勇者 (Hero)",
      floor,
      timestamp: Date.now(),
      jevConfidence: titleAns?.type === "choice" ? titleAns.confidence : 0.9,
    };

    return { card, latencyMs, isSimulated };
  }
}
