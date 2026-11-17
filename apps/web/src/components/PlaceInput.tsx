import { useId, useMemo, useState } from "react";
import { resolvePlace, suggestPlaces } from "@farescope/shared";

interface Props {
  label: string;
  tokens: string[];
  onChange(tokens: string[]): void;
  placeholder?: string;
}

/** Multi-place picker: airports, cities, countries, regions or "Anywhere", shown as chips. */
export function PlaceInput({ label, tokens, onChange, placeholder }: Props) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const id = useId();
  const suggestions = useMemo(() => suggestPlaces(text, 8).filter((p) => !tokens.includes(p.token)), [text, tokens]);

  const add = (token: string) => {
    if (!tokens.includes(token)) onChange([...tokens, token]);
    setText("");
    setActive(0);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="chips-input">
        {tokens.map((t) => {
          const p = resolvePlace(t);
          return (
            <span key={t} className={`chip chip-${p?.kind ?? "unknown"}`} title={p?.sublabel}>
              {p?.label ?? t}
              <button type="button" aria-label={`Remove ${p?.label ?? t}`} onClick={() => onChange(tokens.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          );
        })}
        <input
          id={id}
          value={text}
          placeholder={tokens.length ? "Add another…" : placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && suggestions[active] ? `${id}-option-${active}` : undefined}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.max(0, Math.min(a + 1, suggestions.length - 1))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter" && text.trim()) {
              e.preventDefault();
              if (suggestions[active]) add(suggestions[active].token);
            } else if (e.key === "Backspace" && !text && tokens.length) onChange(tokens.slice(0, -1));
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <ul className="suggestions" id={`${id}-list`} role="listbox">
          {suggestions.map((p, i) => (
            <li
              key={p.token}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                add(p.token);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className={`kind kind-${p.kind}`}>{p.kind}</span>
              <span className="s-label">{p.label}</span>
              <span className="s-sub">{p.sublabel}</span>
            </li>
          ))}
        </ul>
      )}
      {open && text.trim() && suggestions.length === 0 && <p className="muted small" role="status">
        No matching places to add. Try a city, country, or three-letter airport code.
      </p>}
    </div>
  );
}
