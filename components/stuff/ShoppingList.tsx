"use client";

import { copyText } from "@/lib/clipboard";
import { shoppingList, whatsAppText } from "@/lib/pantry";
import type { PantryItemRow } from "@/types/database";

type Props = {
  items: PantryItemRow[];
  onBought: (item: PantryItemRow) => void;
  showToast: (message: string) => void;
};

export default function ShoppingList({ items, onBought, showToast }: Props) {
  const { out, low } = shoppingList(items);

  if (out.length + low.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-6 text-center">
        <p className="text-5xl" aria-hidden="true">
          🎉
        </p>
        <p className="mt-2">Nothing to buy. The cupboard is living its best life.</p>
      </div>
    );
  }

  const text = whatsAppText(items);

  async function copy() {
    showToast((await copyText(text)) ? "Copied! Paste it in WhatsApp 📋" : "Couldn't copy on this browser");
  }

  function group(title: string, list: PantryItemRow[], dot: string) {
    if (list.length === 0) return null;
    return (
      <section className="mb-5">
        <h2 className="mb-2 text-lg font-bold">{title}</h2>
        <ul className="flex flex-col gap-2">
          {list.map((item) => (
            <li key={item.id} className="flex items-center gap-3 rounded-2xl bg-card p-2 pl-4">
              <span className={`size-3 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-lg font-semibold">{item.name}</span>
              <button
                type="button"
                onClick={() => onBought(item)}
                className="min-h-12 shrink-0 rounded-xl bg-green-600 px-4 font-semibold text-white"
              >
                Bought ✅
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-14 rounded-xl bg-primary font-semibold text-on-primary"
        >
          📋 Copy list
        </button>
        {/* wa.me opens WhatsApp with the text ready to send, even over http. */}
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-14 items-center justify-center rounded-xl bg-green-600 font-semibold text-white"
        >
          💬 WhatsApp
        </a>
      </div>
      {group("❌ Out", out, "bg-red-500")}
      {group("⚠️ Running low", low, "bg-amber-500")}
    </>
  );
}
