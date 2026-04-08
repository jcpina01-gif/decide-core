import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type InputHTMLAttributes,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  clampNumber,
  formatPtThousands,
  parsePtNumberInputLoose,
  toPlainEditString,
} from "../lib/ptThousandsInput";

export type ThousandsInputValue = number | "";

/** Liga a `useState<number>` ao `onChange` (valores `""` só com `allowEmpty`). */
export function asThousandsNumberChange(set: Dispatch<SetStateAction<number>>): (v: ThousandsInputValue) => void {
  return (v) => {
    if (typeof v === "number") set(v);
  };
}


export type ThousandsNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "defaultValue"
> & {
  value: ThousandsInputValue;
  onChange: (v: ThousandsInputValue) => void;
  /** Casas decimais máximas (0 = inteiros). */
  maxDecimals?: number;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
};

/**
 * Caixa de texto com separação de milhares (pt-PT). Em foco mostra texto simples para editar;
 * ao perder o foco reformata.
 */
const ThousandsNumberInput = forwardRef<HTMLInputElement, ThousandsNumberInputProps>(
  function ThousandsNumberInput(
    {
      value,
      onChange,
      maxDecimals = 0,
      min,
      max,
      allowEmpty = false,
      onBlur,
      onFocus,
      onKeyDown,
      ...rest
    },
    ref,
  ) {
    const innerRef = useRef<HTMLInputElement | null>(null);
    const setRefs = useCallback(
      (el: HTMLInputElement | null) => {
        innerRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as MutableRefObject<HTMLInputElement | null>).current = el;
      },
      [ref],
    );

    const [focused, setFocused] = useState(false);
    const [draft, setDraft] = useState("");

    const numeric =
      value === "" || value === null || value === undefined ? Number.NaN : Number(value);

    useEffect(() => {
      if (!focused) {
        if (value === "" && allowEmpty) setDraft("");
        else if (Number.isFinite(numeric)) setDraft(toPlainEditString(numeric, maxDecimals));
        else setDraft("");
      }
    }, [value, numeric, focused, allowEmpty, maxDecimals]);

    const displayValue = focused
      ? draft
      : value === "" && allowEmpty
        ? ""
        : Number.isFinite(numeric)
          ? formatPtThousands(numeric, maxDecimals)
          : "";

    const commit = useCallback(
      (raw: string) => {
        const t = raw.trim();
        if (t === "" && allowEmpty) {
          onChange("");
          return;
        }
        const n = parsePtNumberInputLoose(raw);
        if (!Number.isFinite(n)) {
          if (allowEmpty) onChange("");
          return;
        }
        let next = n;
        if (maxDecimals <= 0) next = Math.round(next);
        else {
          const f = 10 ** maxDecimals;
          next = Math.round(next * f) / f;
        }
        next = clampNumber(next, min, max);
        onChange(next);
      },
      [allowEmpty, maxDecimals, min, max, onChange],
    );

    return (
      <input
        {...rest}
        ref={setRefs}
        type="text"
        inputMode={maxDecimals > 0 ? "decimal" : "numeric"}
        autoComplete="off"
        value={displayValue}
        onFocus={(e) => {
          setFocused(true);
          if (value === "" && allowEmpty) setDraft("");
          else if (Number.isFinite(numeric)) setDraft(toPlainEditString(numeric, maxDecimals));
          else setDraft("");
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          commit(draft);
          onBlur?.(e);
        }}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          const n = parsePtNumberInputLoose(t);
          if (t.trim() === "" && allowEmpty) {
            onChange("");
            return;
          }
          if (Number.isFinite(n)) {
            let next = maxDecimals <= 0 ? Math.round(n) : n;
            if (max !== undefined && next > max) next = max;
            onChange(next);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            innerRef.current?.blur();
          }
          onKeyDown?.(e);
        }}
      />
    );
  },
);

export default ThousandsNumberInput;
