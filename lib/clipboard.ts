// The modern clipboard API only works on https (a "secure context"). While we
// test over http://192.168.x.x on the phone it doesn't exist, so fall back to
// the older trick: select a hidden textarea and run the copy command.
export async function copyText(text: string) {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the old way.
    }
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // 16px stops iPhone zooming in; fixed + transparent keeps it invisible.
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px;";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length); // iPhone ignores select() alone.
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
