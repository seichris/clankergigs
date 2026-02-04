"use client";

import * as React from "react";
import type { Column } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { Check, PlusCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface FacetOption {
  label: string;
  value: string;
  icon?: LucideIcon;
}

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>;
  title: string;
  options: FacetOption[];
  selectedValues?: Set<string>;
  onSelectedValuesChange?: (next: Set<string>) => void;
  className?: string;
  highlight?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
  selectedValues,
  onSelectedValuesChange,
  className,
  highlight,
  onOpenChange,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues();
  const internalValues = React.useMemo(() => {
    if (selectedValues) return new Set(selectedValues);
    const raw = (column?.getFilterValue() as string[]) || [];
    return new Set(raw);
  }, [selectedValues, column]);

  const setValues = React.useCallback(
    (values: Set<string>) => {
      if (column) {
        const next = Array.from(values);
        column.setFilterValue(next.length ? next : undefined);
        return;
      }
      onSelectedValuesChange?.(values);
    },
    [column, onSelectedValuesChange]
  );

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-8 border-dashed",
            highlight ? "border-red-500 ring-2 ring-red-500/40 animate-pulse" : null,
            className
          )}
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          {title}
          {internalValues.size > 0 ? (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              {internalValues.size > 2 ? (
                <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                  {internalValues.size} selected
                </Badge>
              ) : (
                options
                  .filter((option) => internalValues.has(option.value))
                  .map((option) => (
                    <Badge key={option.value} variant="secondary" className="rounded-sm px-1 font-normal">
                      {option.label}
                    </Badge>
                  ))
              )}
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = internalValues.has(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => {
                      const next = new Set(internalValues);
                      if (isSelected) {
                        next.delete(option.value);
                      } else {
                        next.add(option.value);
                      }
                      setValues(next);
                    }}
                  >
                    <div
                      className={cn(
                        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                        isSelected
                          ? "bg-primary text-primary-foreground"
                          : "opacity-50 [&_svg]:invisible"
                      )}
                    >
                      <Check className="h-4 w-4" />
                    </div>
                    {option.icon ? <option.icon className="mr-2 h-4 w-4 text-muted-foreground" /> : null}
                    <span>{option.label}</span>
                    {facets?.get(option.value) ? (
                      <span className="ml-auto flex h-4 w-4 items-center justify-center font-mono text-xs">
                        {facets.get(option.value)}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {internalValues.size > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => setValues(new Set())}
                    className="justify-center text-center"
                  >
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
