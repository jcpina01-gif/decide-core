import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Clique na «caixa» (área do grupo sem ser o próprio input): retira o foco do campo activo
 * ou passa ao campo seguinte na mesma linha, se estiver geometricamente próximo.
 */
export function onThousandsFieldRowPointerDownCapture(
  e: ReactPointerEvent<HTMLDivElement>,
): void {
  const root = e.currentTarget;
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest("input, textarea, select, button, a, [role='button']")) return;

  const ae = document.activeElement;
  if (
    !ae ||
    (!(ae instanceof HTMLInputElement) &&
      !(ae instanceof HTMLTextAreaElement) &&
      !(ae instanceof HTMLSelectElement))
  ) {
    return;
  }
  if (!root.contains(ae)) return;

  const fields = Array.from(
    root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
    ),
  ).filter((el) => {
    try {
      return el.offsetParent !== null || el.getClientRects().length > 0;
    } catch {
      return false;
    }
  });

  const i = fields.findIndex((el) => el === ae);
  if (i < 0) return;

  if (i < fields.length - 1) {
    const next = fields[i + 1];
    const r0 = ae.getBoundingClientRect();
    const r1 = next.getBoundingClientRect();
    const sameRow = Math.abs(r0.top - r1.top) < 72;
    const hGap = r1.left - r0.right;
    const near = sameRow && hGap > -24 && hGap < 420;
    if (near) {
      try {
        next.focus({ preventScroll: true });
      } catch {
        try {
          next.focus();
        } catch {
          /* ignore */
        }
      }
      return;
    }
  }

  try {
    ae.blur();
  } catch {
    /* ignore */
  }
}
