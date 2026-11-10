"use client";

import { useMemo, useRef, useState } from "react";
import AddItemSheet from "@/components/stuff/AddItemSheet";
import ItemTile from "@/components/stuff/ItemTile";
import ShoppingList from "@/components/stuff/ShoppingList";
import ConfirmSheet from "@/components/ui/ConfirmSheet";
import Toast from "@/components/ui/Toast";
import { useToast } from "@/components/ui/useToast";
import { NEXT_STATE, STATE_TOAST, shoppingList } from "@/lib/pantry";
import { loadPantry } from "@/lib/queries";
import { useLiveRows } from "@/lib/realtime/useLiveRows";
import { createClient } from "@/lib/supabase/client";
import type { PantryItemRow, PantryKind, PantryState } from "@/types/database";

type Props = { roomId: string; initialItems: PantryItemRow[] };

export default function HomeStuff({ roomId, initialItems }: Props) {
  const [supabase] = useState(createClient);
  const { rows: items, setRows, refetch, hold, isBusy } = useLiveRows({
    supabase,
    table: "pantry_items",
    roomId,
    initialRows: initialItems,
    load: loadPantry,
  });
  const [view, setView] = useState<"stock" | "shopping">("stock");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<PantryItemRow | null>(null);
  const [seeding, setSeeding] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  // One save at a time, so quick taps reach the database in the order made.
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());

  const sections = useMemo(() => {
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    return {
      ready: sorted.filter((item) => item.kind === "ready_food"),
      groceries: sorted.filter((item) => item.kind === "grocery"),
    };
  }, [items]);
  const { out, low } = useMemo(() => shoppingList(items), [items]);
  const shoppingCount = out.length + low.length;

  function setState(item: PantryItemRow, next: PantryState) {
    // Show it straight away; the save happens behind the scenes.
    setRows((current) => current.map((row) => (row.id === item.id ? { ...row, state: next } : row)));
    showToast(STATE_TOAST[next](item.name));

    // We send the new state itself (not "move one step"), so a retried
    // request can never skip a step.
    const run = saveQueue.current.then(() =>
      supabase.from("pantry_items").update({ state: next }).eq("id", item.id).select().single(),
    );
    saveQueue.current = run.catch(() => undefined);

    void hold(item.id, () => run).then(({ data, error }) => {
      if (error) {
        showToast("Couldn't save that. Try again.");
        if (!isBusy(item.id)) void refetch();
        return;
      }
      // Only the last of several quick taps updates the screen from the server.
      if (!isBusy(item.id)) {
        setRows((current) => current.map((row) => (row.id === data.id ? data : row)));
      }
    });
  }

  async function addItem(name: string, kind: PantryKind) {
    const { data, error } = await supabase
      .from("pantry_items")
      .insert({ room_id: roomId, name, kind })
      .select()
      .single();
    if (error) {
      // 23505 is Postgres's "unique violation": the name already exists.
      showToast(error.code === "23505" ? `${name} is already on the list` : "Couldn't add that.");
      return false;
    }
    setRows((current) => (current.some((row) => row.id === data.id) ? current : [...current, data]));
    showToast(`${name} added`);
    return true;
  }

  async function deleteItem(item: PantryItemRow) {
    setRows((current) => current.filter((row) => row.id !== item.id));
    const { error } = await supabase.from("pantry_items").delete().eq("id", item.id);
    if (error) {
      showToast("Couldn't delete that.");
      void refetch();
    } else {
      showToast(`${item.name} deleted`);
    }
  }

  async function seed() {
    setSeeding(true);
    const { error } = await supabase.rpc("seed_pantry", { p_room_id: roomId });
    setSeeding(false);
    if (error) showToast("Couldn't add them. Try again.");
    else await refetch();
  }

  function renderSection(title: string, list: PantryItemRow[], empty: string) {
    return (
      <section className="mb-6">
        <h2 className="mb-2 text-lg font-bold">{title}</h2>
        {list.length === 0 ? (
          <p className="rounded-2xl bg-white/60 p-4 text-center text-stone-600">{empty}</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3">
            {list.map((item) => (
              <ItemTile
                key={item.id}
                item={item}
                onTap={() => setState(item, NEXT_STATE[item.state])}
                onHold={() => setDeleting(item)}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-44">
      <h1 className="mb-3 text-2xl font-bold">Home Stuff</h1>

      <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-white/70 p-1">
        {(
          [
            ["stock", "📦 Stock"],
            ["shopping", `🛒 Shopping list${shoppingCount ? ` (${shoppingCount})` : ""}`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={`min-h-12 rounded-xl font-semibold ${
              view === value ? "bg-stone-900 text-white" : ""
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "shopping" ? (
        <ShoppingList
          items={items}
          onBought={(item) => setState(item, "have")}
          showToast={showToast}
        />
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-white p-6 text-center">
          <p className="text-5xl" aria-hidden="true">
            🧺
          </p>
          <p className="mt-2 mb-4">The cupboard is empty. Start with the usual stuff?</p>
          <button
            type="button"
            disabled={seeding}
            onClick={() => void seed()}
            className="min-h-14 w-full rounded-xl bg-stone-900 font-semibold text-white disabled:opacity-50"
          >
            Add common items
          </button>
        </div>
      ) : (
        <>
          {renderSection("🍲 Ready food", sections.ready, "Nothing cooked. Tap + to add some.")}
          {renderSection("🧂 Groceries", sections.groceries, "No groceries yet. Tap + to add.")}
          <p className="text-center text-sm text-stone-500">
            Tap to change · Hold to delete
          </p>
        </>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="Add an item"
        className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 flex size-16 items-center justify-center rounded-full bg-stone-900 text-4xl text-white shadow-lg"
      >
        +
      </button>

      {adding && <AddItemSheet onAdd={addItem} onClose={() => setAdding(false)} />}
      {deleting && (
        <ConfirmSheet
          title={`Delete ${deleting.name}?`}
          confirmLabel="Delete"
          onConfirm={() => void deleteItem(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
      <Toast toast={toast} onDone={clearToast} />
    </main>
  );
}
