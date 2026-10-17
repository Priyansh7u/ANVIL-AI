import type { HouseholdProfile } from "./checklists";

/**
 * Household readiness: an emergency-bag list sized to the household, and a
 * transparent readiness score built only from things the user did in the app.
 * Quantities are general preparedness guidance (labelled in the UI), not official instructions.
 */

export interface GoBagItem {
  id: string;
  en: string;
  hi: string;
  qty: string | null;
  essential: boolean;
}

export const GO_BAG_ASSUMPTIONS = { waterLitresPerPersonPerDay: 4, mealsPerPersonPerDay: 3 } as const;

export function goBagList(h: HouseholdProfile, days = 3): GoBagItem[] {
  const n = Math.max(1, Math.round(h.members));
  const d = Math.max(1, Math.min(7, Math.round(days)));
  const water = n * d * GO_BAG_ASSUMPTIONS.waterLitresPerPersonPerDay;
  const meals = n * d * GO_BAG_ASSUMPTIONS.mealsPerPersonPerDay;
  const items: GoBagItem[] = [
    { id: "water", en: "Drinking water", hi: "पीने का पानी", qty: `${water} L`, essential: true },
    { id: "food", en: "Dry, ready-to-eat food", hi: "सूखा, तैयार भोजन", qty: `${meals} meals`, essential: true },
    { id: "torch", en: "Torch with spare batteries", hi: "टॉर्च और अतिरिक्त बैटरी", qty: `${Math.max(1, Math.ceil(n / 2))}`, essential: true },
    { id: "power", en: "Charged power bank and charging cable", hi: "चार्ज किया हुआ पावर बैंक और केबल", qty: "1", essential: true },
    { id: "firstaid", en: "First-aid kit", hi: "प्राथमिक चिकित्सा किट", qty: "1", essential: true },
    { id: "docs", en: "Copies of ID, ration card, bank and insurance papers in a waterproof pouch", hi: "पहचान पत्र, राशन कार्ड, बैंक और बीमा कागज़ों की प्रतियाँ वॉटरप्रूफ़ थैली में", qty: null, essential: true },
    { id: "cash", en: "Some cash in small notes", hi: "छोटे नोटों में कुछ नकद", qty: null, essential: true },
    { id: "radio", en: "Battery or hand-crank radio", hi: "बैटरी या हाथ से चलने वाला रेडियो", qty: "1", essential: false },
    { id: "whistle", en: "Whistle to signal for help", hi: "मदद के लिए संकेत देने को सीटी", qty: `${n}`, essential: false },
    { id: "clothes", en: "Change of clothes and a rain cover", hi: "बदलने के कपड़े और बरसाती", qty: `${n} sets`, essential: false },
    { id: "hygiene", en: "Soap, sanitiser, masks, sanitary supplies", hi: "साबुन, सैनिटाइज़र, मास्क, सैनिटरी सामान", qty: null, essential: false },
  ];
  if (h.medicalNeeds) items.splice(5, 0, { id: "meds", en: "Regular medicines with prescriptions", hi: "नियमित दवाइयाँ और पर्चे", qty: `${d + 4} days`, essential: true });
  if (h.children > 0) items.push({ id: "kids", en: "Baby food, milk powder, diapers, a small toy", hi: "शिशु आहार, दूध पाउडर, डायपर, छोटा खिलौना", qty: `for ${h.children}`, essential: true });
  if (h.elderly > 0) items.push({ id: "elderly", en: "Spare spectacles, hearing-aid batteries, walking aid", hi: "अतिरिक्त चश्मा, श्रवण यंत्र की बैटरी, चलने का सहारा", qty: `for ${h.elderly}`, essential: true });
  if (h.mobilityNeeds) items.push({ id: "mobility", en: "Plan for who helps move a person with limited mobility", hi: "चलने में असमर्थ व्यक्ति को कौन ले जाएगा, यह तय करें", qty: null, essential: true });
  if (h.pets) items.push({ id: "pets", en: "Pet food, water, leash or carrier", hi: "पालतू जानवर का भोजन, पानी, पट्टा या पिंजरा", qty: `${d} days`, essential: false });
  return items;
}

export interface ReadinessInputs {
  checklistDone: number;
  checklistTotal: number;
  bagDone: number;
  bagTotal: number;
  /** Meeting point and at least two contacts filled in. */
  familyCardComplete: boolean;
  /** Best drill time in seconds, if a drill was completed. */
  drillSeconds: number | null;
  /** Hours since the plan was generated; null if none. */
  planAgeHours: number | null;
  /** True when a new official alert appeared after the plan was generated. */
  planOutdated: boolean;
}

export interface ReadinessResult {
  score: number;
  parts: { id: string; label: string; points: number; max: number; tip: string | null }[];
}

export function readinessScore(r: ReadinessInputs): ReadinessResult {
  const frac = (a: number, b: number) => (b > 0 ? Math.min(1, Math.max(0, a / b)) : 0);
  const planFresh = r.planAgeHours == null ? 0 : r.planOutdated ? 0.4 : r.planAgeHours <= 24 * 7 ? 1 : 0.6;
  const parts = [
    { id: "plan", label: "Up-to-date plan", max: 20, value: planFresh, tip: r.planAgeHours == null ? "Generate your plan." : r.planOutdated ? "A new alert arrived — regenerate the plan." : r.planAgeHours > 24 * 7 ? "Your plan is over a week old." : null },
    { id: "checklist", label: "Checklist done", max: 25, value: frac(r.checklistDone, r.checklistTotal), tip: r.checklistDone < r.checklistTotal ? `${r.checklistTotal - r.checklistDone} checklist step(s) left.` : null },
    { id: "bag", label: "Emergency bag packed", max: 25, value: frac(r.bagDone, r.bagTotal), tip: r.bagDone < r.bagTotal ? `${r.bagTotal - r.bagDone} item(s) still to pack.` : null },
    { id: "family", label: "Family card", max: 15, value: r.familyCardComplete ? 1 : 0, tip: r.familyCardComplete ? null : "Add a meeting point and two contacts." },
    { id: "drill", label: "Evacuation drill", max: 15, value: r.drillSeconds == null ? 0 : 1, tip: r.drillSeconds == null ? "Time a practice evacuation." : null },
  ];
  const scored = parts.map((p) => ({ id: p.id, label: p.label, max: p.max, points: Math.round(p.value * p.max), tip: p.tip }));
  return { score: scored.reduce((n, p) => n + p.points, 0), parts: scored };
}