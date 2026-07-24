import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

export type AppSelectOption<T extends string | number> = {
  value: T;
  label: string;
};

type Props<T extends string | number> = {
  value: T;
  options: readonly AppSelectOption<T>[];
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
};

export function AppSelect<T extends string | number>({ value, options, ariaLabel, className, onChange }: Props<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const listboxID = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selectedOption = options[selectedIndex];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const closeWhenOutside = (event: PointerEvent) => {
      if (!selectRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, [isOpen]);

  const openMenu = () => {
    setActiveIndex(selectedIndex);
    setIsOpen(true);
    window.requestAnimationFrame(() => listboxRef.current?.focus());
  };

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const chooseOption = (option: AppSelectOption<T>) => {
    onChange(option.value);
    closeMenu(true);
  };

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseOption(options[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };

  return <div className={["app-select", isOpen ? "is-open" : "", className].filter(Boolean).join(" ")} ref={selectRef}>
    <button ref={triggerRef} type="button" className="app-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-controls={listboxID} aria-expanded={isOpen} onClick={() => isOpen ? closeMenu(true) : openMenu()} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMenu();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    }}>
      <span>{selectedOption?.label ?? "Choose an option"}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {isOpen ? <div ref={listboxRef} id={listboxID} className="app-select-menu" role="listbox" aria-label={ariaLabel} tabIndex={-1} aria-activedescendant={`${listboxID}-option-${activeIndex}`} onKeyDown={handleListboxKeyDown}>
      {options.map((option, index) => <button key={String(option.value)} id={`${listboxID}-option-${index}`} type="button" role="option" aria-selected={option.value === value} className={`${option.value === value ? "selected" : ""} ${index === activeIndex ? "active" : ""}`} onMouseMove={() => setActiveIndex(index)} onClick={() => chooseOption(option)}>{option.label}</button>)}
    </div> : null}
  </div>;
}
