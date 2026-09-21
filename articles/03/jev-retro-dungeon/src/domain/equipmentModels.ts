/**
 * Equipment & Inventory Models (Classic Retro RPG Style)
 * Clean Architecture - Domain Layer
 */

import { ElementType } from "./models";

export type EquipmentSlot = "weapon" | "shield" | "armor" | "accessory";

export interface BaseEquipment {
  readonly id: string;
  readonly nameKey: string;
  readonly slot: EquipmentSlot;
  readonly rarity: "Common" | "Rare" | "Epic" | "Legendary";
  readonly attackBonus: number;
  readonly defenseBonus: number;
  readonly agilityBonus: number;
  readonly element: ElementType;
  readonly prefixKey?: string;
  readonly traitKey?: string;
}

export interface Inventory {
  readonly equipments: BaseEquipment[];
  equippedWeaponId: string;
  equippedShieldId: string;
  equippedArmorId: string;
  equippedAccessoryId: string;
}

export const INITIAL_EQUIPMENT: BaseEquipment[] = [
  {
    id: "w_copper",
    nameKey: "copper_sword",
    slot: "weapon",
    rarity: "Common",
    attackBonus: 10,
    defenseBonus: 0,
    agilityBonus: 0,
    element: "normal",
  },
  {
    id: "s_leather",
    nameKey: "leather_shield",
    slot: "shield",
    rarity: "Common",
    attackBonus: 0,
    defenseBonus: 4,
    agilityBonus: 0,
    element: "normal",
  },
  {
    id: "a_tunic",
    nameKey: "cloth_armor",
    slot: "armor",
    rarity: "Common",
    attackBonus: 0,
    defenseBonus: 6,
    agilityBonus: 0,
    element: "normal",
  },
  {
    id: "acc_ring",
    nameKey: "copper_ring",
    slot: "accessory",
    rarity: "Common",
    attackBonus: 2,
    defenseBonus: 1,
    agilityBonus: 2,
    element: "normal",
  },
];
