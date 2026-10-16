import type { HazardType } from "./types";

/**
 * General preparedness templates written by the ANVIL team. They are shown
 * with the label "ANVIL general guidance — not an official instruction" and
 * always rank BELOW official CAP instructions and verified district advisories.
 */

export interface ChecklistItem {
  en: string;
  hi: string;
}

export interface HouseholdProfile {
  members: number;
  children: number;
  elderly: number;
  mobilityNeeds: boolean;
  medicalNeeds: boolean;
  pets: boolean;
}

const COMMON: ChecklistItem[] = [
  { en: "Keep phones charged and a power bank ready.", hi: "फ़ोन चार्ज रखें और पावर बैंक तैयार रखें।" },
  { en: "Pack an emergency bag: water, dry food, torch, medicines, copies of ID documents.", hi: "आपातकालीन बैग तैयार रखें: पानी, सूखा भोजन, टॉर्च, दवाइयाँ, पहचान पत्रों की प्रतियाँ।" },
  { en: "Follow only official channels (SACHET, IMD, district administration) for updates.", hi: "अपडेट के लिए केवल आधिकारिक स्रोतों (सचेत, IMD, जिला प्रशासन) पर भरोसा करें।" },
  { en: "Save 112 and your district control-room number in your phone.", hi: "112 और अपने जिला नियंत्रण कक्ष का नंबर फ़ोन में सेव करें।" },
];

const BY_HAZARD: Partial<Record<HazardType, ChecklistItem[]>> = {
  flood: [
    { en: "Move valuables, documents and medicines to a higher shelf or floor.", hi: "कीमती सामान, दस्तावेज़ और दवाइयाँ ऊँचे स्थान या ऊपरी मंज़िल पर रखें।" },
    { en: "Do not walk or drive through flowing water.", hi: "बहते पानी में पैदल न चलें और न ही वाहन चलाएँ।" },
    { en: "Switch off electricity at the mains if water enters your home.", hi: "घर में पानी घुसने पर मुख्य स्विच से बिजली बंद कर दें।" },
    { en: "Be ready to move if authorities announce evacuation.", hi: "प्रशासन द्वारा निकासी की घोषणा होने पर तुरंत निकलने के लिए तैयार रहें।" },
  ],
  heavy_rain: [
    { en: "Avoid underpasses and low-lying roads during heavy rain.", hi: "भारी बारिश में अंडरपास और निचली सड़कों से बचें।" },
    { en: "Keep drains around your home clear.", hi: "घर के आसपास की नालियाँ साफ़ रखें।" },
  ],
  thunderstorm: [
    { en: "Stay indoors during lightning; keep away from trees, poles and open fields.", hi: "बिजली कड़कने के समय घर के अंदर रहें; पेड़ों, खंभों और खुले मैदानों से दूर रहें।" },
    { en: "Unplug electrical appliances.", hi: "बिजली के उपकरणों के प्लग निकाल दें।" },
  ],
  cyclone: [
    { en: "Secure loose objects outside your home.", hi: "घर के बाहर रखी ढीली चीज़ों को सुरक्षित करें।" },
    { en: "Stay away from the coast and follow evacuation orders.", hi: "तट से दूर रहें और निकासी आदेशों का पालन करें।" },
  ],
  heatwave: [
    { en: "Drink water frequently and avoid going out between noon and 4 pm.", hi: "बार-बार पानी पिएँ और दोपहर 12 से 4 बजे के बीच बाहर जाने से बचें।" },
    { en: "Check regularly on elderly neighbours and children.", hi: "बुज़ुर्ग पड़ोसियों और बच्चों का नियमित रूप से ध्यान रखें।" },
  ],
  earthquake: [
    { en: "Drop, cover and hold on; stay away from windows.", hi: "झुकें, ढकें और पकड़ें; खिड़कियों से दूर रहें।" },
    { en: "After shaking stops, move to open ground carefully.", hi: "झटके रुकने के बाद सावधानी से खुले स्थान पर जाएँ।" },
  ],
  landslide: [
    { en: "Avoid steep slopes and hill roads during heavy rain.", hi: "भारी बारिश के दौरान खड़ी ढलानों और पहाड़ी सड़कों से बचें।" },
  ],
  high_waves: [
    { en: "Stay away from beaches and do not venture into the sea.", hi: "समुद्र तट से दूर रहें और समुद्र में न जाएँ।" },
  ],
};

export function buildTemplateChecklist(hazards: HazardType[], household: HouseholdProfile): ChecklistItem[] {
  const items = [...COMMON];
  for (const h of Array.from(new Set(hazards))) items.push(...(BY_HAZARD[h] ?? []));
  if (household.children > 0) {
    items.push({ en: "Pack food, milk and comfort items for children; keep a family photo for identification.", hi: "बच्चों के लिए भोजन, दूध और ज़रूरी सामान रखें; पहचान के लिए परिवार की फ़ोटो रखें।" });
  }
  if (household.elderly > 0 || household.mobilityNeeds) {
    items.push({ en: "Plan who will help members with limited mobility and how they will be moved.", hi: "तय करें कि चलने-फिरने में असमर्थ सदस्यों की मदद कौन करेगा और उन्हें कैसे ले जाया जाएगा।" });
  }
  if (household.medicalNeeds) {
    items.push({ en: "Keep at least 7 days of essential medicines and prescriptions in a waterproof pouch.", hi: "कम से कम 7 दिनों की ज़रूरी दवाइयाँ और पर्चे वॉटरप्रूफ़ थैली में रखें।" });
  }
  if (household.pets) {
    items.push({ en: "Prepare a leash/carrier, food and water for pets.", hi: "पालतू जानवरों के लिए पट्टा/कैरियर, भोजन और पानी तैयार रखें।" });
  }
  items.push({ en: `Agree on a meeting point for all ${household.members} household members.`, hi: `परिवार के सभी ${household.members} सदस्यों के लिए एक मिलने का स्थान तय करें।` });
  return items;
}

/** Hazard-specific items only (used by the next-steps engine). */
export function hazardChecklist(hazard: HazardType): ChecklistItem[] {
  return BY_HAZARD[hazard] ?? [];
}

/** Items that apply whatever the hazard. */
export function commonChecklist(): ChecklistItem[] {
  return COMMON;
}