"use client";

import { MessageCircle, Phone, Plus, Printer, Trash2, Users } from "lucide-react";
import { Button, Input, Label, Textarea } from "@/components/ui/primitives";

export interface FamilyCardData {
  meetNear: string;
  meetFar: string;
  contacts: { name: string; relation: string; phone: string }[];
  notes: string;
}

export const EMPTY_CARD: FamilyCardData = { meetNear: "", meetFar: "", contacts: [{ name: "", relation: "", phone: "" }], notes: "" };

export function cardComplete(c: FamilyCardData): boolean {
  return Boolean(c.meetNear.trim()) && c.contacts.filter((x) => x.name.trim() && x.phone.trim()).length >= 2;
}

function cardText(c: FamilyCardData, placeLabel: string): string {
  const lines = [
    `ANVIL family emergency card — ${placeLabel}`,
    c.meetNear ? `Meet near home: ${c.meetNear}` : "",
    c.meetFar ? `Meet outside the area: ${c.meetFar}` : "",
    ...c.contacts.filter((x) => x.name || x.phone).map((x) => `${x.name}${x.relation ? ` (${x.relation})` : ""}: ${x.phone}`),
    c.notes ? `Notes: ${c.notes}` : "",
    "Emergency: 112",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Where to meet and who to call — kept only in this browser, printable as a wallet card. */
export function FamilyCard({ card, onChange, placeLabel }: { card: FamilyCardData; onChange: (c: FamilyCardData) => void; placeLabel: string }) {
  const set = (patch: Partial<FamilyCardData>) => onChange({ ...card, ...patch });
  const setContact = (i: number, patch: Partial<FamilyCardData["contacts"][number]>) => set({ contacts: card.contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const filled = card.contacts.filter((x) => x.name.trim() && x.phone.trim());

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="panel space-y-4 p-4 sm:p-5 print:hidden">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Users className="size-5 text-primary" aria-hidden /> Family emergency card</h2>
          <p className="mt-1 text-sm text-muted-foreground">If phones go down, everyone should know where to meet. Stored only in this browser.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="meet-near">Meeting point near home</Label>
            <Input id="meet-near" value={card.meetNear} onChange={(e) => set({ meetNear: e.target.value })} placeholder="e.g. temple gate on Station Road" maxLength={120} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="meet-far">Meeting point outside your area</Label>
            <Input id="meet-far" value={card.meetFar} onChange={(e) => set({ meetFar: e.target.value })} placeholder="e.g. uncle's house in another town" maxLength={120} />
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Contacts (at least two)</legend>
          {card.contacts.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 sm:grid-cols-[1.2fr_0.8fr_1fr_auto]">
              <Input aria-label={`Contact ${i + 1} name`} value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} placeholder="Name" maxLength={60} />
              <Input aria-label={`Contact ${i + 1} relation`} value={c.relation} onChange={(e) => setContact(i, { relation: e.target.value })} placeholder="Relation" maxLength={30} className="hidden sm:flex" />
              <Input aria-label={`Contact ${i + 1} phone`} type="tel" inputMode="tel" autoComplete="tel" value={c.phone} onChange={(e) => setContact(i, { phone: e.target.value })} placeholder="Phone" maxLength={20} />
              <Button variant="ghost" size="icon" aria-label={`Remove contact ${i + 1}`} disabled={card.contacts.length <= 1} onClick={() => set({ contacts: card.contacts.filter((_, j) => j !== i) })}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" disabled={card.contacts.length >= 6} onClick={() => set({ contacts: [...card.contacts, { name: "", relation: "", phone: "" }] })}>
            <Plus /> Add contact
          </Button>
        </fieldset>
        <div className="space-y-1">
          <Label htmlFor="card-notes">Notes for whoever finds this card</Label>
          <Textarea id="card-notes" rows={2} value={card.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. Grandmother needs help with stairs" maxLength={240} />
        </div>
      </div>

      <div className="space-y-3">
        {/* The card itself: also what prints. */}
        <article className="family-card rounded-2xl border-2 border-dashed border-primary/50 bg-card p-5 shadow-sm" aria-label="Preview of your family emergency card">
          <p className="label-caps">Family emergency card</p>
          <p className="mt-1 font-semibold">{placeLabel}</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Meet near home</dt>
              <dd>{card.meetNear || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Meet outside the area</dt>
              <dd>{card.meetFar || "—"}</dd>
            </div>
          </dl>
          <ul className="mt-3 divide-y border-y text-sm">
            {filled.length ? (
              filled.map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-2">
                  <span>{c.name}{c.relation ? <span className="text-muted-foreground"> · {c.relation}</span> : null}</span>
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="num inline-flex items-center gap-1 text-primary"><Phone className="size-3.5" aria-hidden />{c.phone}</a>
                </li>
              ))
            ) : (
              <li className="py-2 text-muted-foreground">Add contacts to fill the card.</li>
            )}
          </ul>
          {card.notes ? <p className="mt-3 text-sm">{card.notes}</p> : null}
          <p className="mt-3 text-sm font-semibold text-danger">Emergency: 112</p>
        </article>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> Print card</Button>
          <a
            className="inline-flex min-h-9 items-center gap-2 rounded-md border bg-card px-3 text-xs font-medium hover:bg-muted"
            href={`https://wa.me/?text=${encodeURIComponent(cardText(card, placeLabel))}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="size-4" aria-hidden /> Send to family on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}