import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface SearchableSelectOption {
  /** Stable id — this is what the form stores. */
  value: string;
  /** Primary text: shown on the trigger and in the list, and searched. */
  label: string;
  /** Muted secondary text (release year, "inactive"). Searched too. */
  hint?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** Trigger text when nothing is selected. */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * cmdk scores each item against its `value`, which here is a uuid — a search
 * for "cafe" would match stray characters scattered through an id. Score the
 * keywords we attach (label + hint) instead, and require every typed word to
 * appear somewhere, so "empire strikes" finds "Star Wars: The Empire Strikes
 * Back" without needing the words in order.
 */
function filterByKeywords(_value: string, search: string, keywords?: string[]): number {
  const query = search.trim().toLowerCase();
  if (!query) return 1;

  const haystack = (keywords ?? []).join(" ").toLowerCase();
  const words = query.split(/\s+/);
  if (!words.every((word) => haystack.includes(word))) return 0;

  // Titles starting with what was typed sort above incidental matches.
  return haystack.startsWith(query) ? 2 : 1;
}

/**
 * A type-to-search replacement for `<Select>`, for lists long enough that
 * scrolling a dropdown is painful. Keyboard handling (arrows, Enter) comes
 * from `Command`.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyText = "No match.",
  id,
  className,
  disabled,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          // Radix's trigger already passes type="button"; stated here too so
          // that opening the picker can never submit the surrounding form if
          // this button is ever rendered outside a PopoverTrigger.
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground", className)}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
            {selected?.hint && <span className="ml-2 text-muted-foreground">{selected.hint}</span>}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command filter={filterByKeywords}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.label, option.hint ?? ""]}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option.label}</span>
                  {option.hint && <span className="ml-2 shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
