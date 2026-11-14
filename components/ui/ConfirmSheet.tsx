"use client";

import Sheet from "@/components/ui/Sheet";

type Props = {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

// In-app instead of window.confirm(): it looks like the rest of the app, and
// browser dialogs behave differently on every phone.
export default function ConfirmSheet({ title, confirmLabel, onConfirm, onClose }: Props) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-14 rounded-xl bg-chip font-semibold"
        >
          Keep it
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="min-h-14 rounded-xl bg-red-600 font-semibold text-white"
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
