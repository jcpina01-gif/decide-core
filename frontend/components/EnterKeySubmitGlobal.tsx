import { useEffect } from "react";

/**
 * Enter num campo de texto/número dispara o envio: botão submit do form ou
 * `data-enter-submit="#selector"` num ancestral. Não aplica a textarea, select,
 * checkbox, etc. Opt-out: `data-no-enter-submit` no form ou num ancestral.
 */
export default function EnterKeySubmitGlobal() {
  useEffect(() => {
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      const target = e.target;
      if (!target || !(target instanceof HTMLElement)) return;
      if (target instanceof HTMLTextAreaElement) return;
      if (target.isContentEditable) return;
      if (target.closest("[data-no-enter-submit]")) return;

      if (target instanceof HTMLSelectElement) return;

      if (!(target instanceof HTMLInputElement)) return;

      const skipTypes = new Set([
        "button",
        "submit",
        "reset",
        "checkbox",
        "radio",
        "file",
        "hidden",
        "image",
        "range",
        "color",
      ]);
      if (skipTypes.has(target.type)) return;

      const form = target.closest("form");
      if (form && !form.hasAttribute("data-no-enter-submit")) {
        const primary = form.querySelector(
          "button[type='submit'][data-primary-submit]",
        ) as HTMLButtonElement | null;
        if (primary) {
          e.preventDefault();
          e.stopPropagation();
          primary.click();
          return;
        }
        const explicit = form.querySelector(
          "button[type='submit'], input[type='submit']",
        ) as HTMLElement | null;
        if (explicit) {
          e.preventDefault();
          e.stopPropagation();
          explicit.click();
          return;
        }
        const buttons = Array.from(form.querySelectorAll("button")) as HTMLButtonElement[];
        const implicitSubmit = buttons.filter((b) => !b.type || b.type === "submit");
        if (implicitSubmit.length === 1) {
          e.preventDefault();
          e.stopPropagation();
          implicitSubmit[0].click();
          return;
        }
        const formTarget = form.getAttribute("data-enter-submit");
        if (formTarget) {
          const b = document.querySelector(formTarget);
          if (b instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            b.click();
            return;
          }
        }
      }

      let el: HTMLElement | null = target;
      for (let i = 0; i < 40 && el; i++) {
        if (el.hasAttribute("data-no-enter-submit")) return;
        const sel = el.getAttribute("data-enter-submit");
        if (sel) {
          const btn = document.querySelector(sel);
          if (btn instanceof HTMLElement) {
            e.preventDefault();
            e.stopPropagation();
            btn.click();
            return;
          }
        }
        el = el.parentElement;
      }
    }

    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
  }, []);

  return null;
}
