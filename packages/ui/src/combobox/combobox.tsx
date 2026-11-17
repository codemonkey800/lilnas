'use client'

import { Combobox as BaseCombobox } from '@base-ui/react/combobox'
import { cns } from '@lilnas/utils/cns'
import type { JSX, KeyboardEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon } from '../icons'
import { Input } from '../input'
import {
  FLOATING_GROUP_LABEL,
  FLOATING_ITEM,
  FLOATING_PANEL,
} from '../internal/overlay'

export type ComboboxItem<V> = {
  value: V
  label: string
  /** Key of the entry in `groups` this row sits under. */
  group?: string
  /** Secondary text, right-aligned in `mono-sm`. */
  hint?: string
  /** Leading glyph or avatar. */
  icon?: ReactNode
  disabled?: boolean
}

export type ComboboxGroup = {
  key: string
  label: string
  /** Any CSS colour; drawn as a dot before the group label. */
  dot?: string
}

export type ComboboxProps<V extends string> = {
  items: readonly ComboboxItem<V>[]
  /** The picked value. `null` for nothing chosen yet. */
  value?: V | null
  /** Used when `value` isn't passed. */
  defaultValue?: V | null
  /**
   * With `allowCustom` the value can be text the user typed rather than one of
   * `items`; it arrives here typed as `V`.
   */
  onValueChange?: (value: V | null) => void
  placeholder?: string
  /** Keep typed text that matches no item as the value. */
  allowCustom?: boolean
  /**
   * Heading rows, in display order. Items whose `group` isn't listed follow
   * in the order they first appear; items without a `group` come first.
   */
  groups?: readonly ComboboxGroup[]
  emptyText?: string
  /**
   * Replaces the row's content (icon, label, hint). The picked row's trailing
   * check is still drawn.
   */
  renderItem?: (item: ComboboxItem<V>) => ReactNode
  /** The accessible name. A visible label belongs in a `Field`. */
  label: string
  /** Submitted under this name through a hidden input. */
  name?: string
  disabled?: boolean
  invalid?: boolean
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  className?: string
}

type Section<V extends string> = {
  key: string
  label?: string
  dot?: string
  items: ComboboxItem<V>[]
}

// Case and diacritics fold away, so "jose" finds "José".
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim()
}

function matches<V extends string>(
  item: ComboboxItem<V>,
  query: string,
): boolean {
  const needle = fold(query)
  return needle === '' || fold(item.label).includes(needle)
}

/** Ungrouped rows first, then the declared groups, then any stragglers. */
function buildSections<V extends string>(
  items: readonly ComboboxItem<V>[],
  groups: readonly ComboboxGroup[],
): Section<V>[] {
  const byKey = new Map<string, Section<V>>()
  const loose: Section<V> = { key: '', items: [] }

  for (const group of groups) {
    byKey.set(group.key, {
      key: group.key,
      label: group.label,
      dot: group.dot,
      items: [],
    })
  }

  for (const item of items) {
    if (item.group == null) {
      loose.items.push(item)
      continue
    }

    let section = byKey.get(item.group)
    if (!section) {
      section = { key: item.group, label: item.group, items: [] }
      byKey.set(item.group, section)
    }
    section.items.push(item)
  }

  return [loose, ...byKey.values()].filter(s => s.items.length > 0)
}

function DefaultRow<V extends string>({
  item,
}: {
  item: ComboboxItem<V>
}): JSX.Element {
  return (
    <>
      {item.icon != null && (
        <span className="flex shrink-0 items-center">{item.icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.hint != null && (
        <span className="shrink-0 text-mono-sm text-ink-3">{item.hint}</span>
      )}
    </>
  )
}

function Row<V extends string>({
  item,
  renderItem,
}: {
  item: ComboboxItem<V>
  renderItem?: (item: ComboboxItem<V>) => ReactNode
}): JSX.Element {
  return (
    <BaseCombobox.Item
      className={cns(FLOATING_ITEM, 'justify-between')}
      disabled={item.disabled}
      value={item.value}
    >
      {renderItem ? (
        <span className="min-w-0 flex-1">{renderItem(item)}</span>
      ) : (
        <DefaultRow item={item} />
      )}
      <BaseCombobox.ItemIndicator className="shrink-0 text-accent-hi">
        <Icon className="size-3.5" name="check" />
      </BaseCombobox.ItemIndicator>
    </BaseCombobox.Item>
  )
}

/**
 * A text field that filters a list as you type. Built on Base UI's
 * `Combobox`, with `Input`'s field and `Select`'s panel.
 *
 * The typed text is not the value until it is committed: picking a row
 * commits it, and so does `Enter` or leaving the field when `allowCustom` is
 * on and nothing is highlighted. `Escape` drops the edit and restores the
 * previous value. With `name`, the form receives the typed text even if it was
 * never committed.
 *
 * ```tsx
 * <Combobox
 *   label="Exercise"
 *   allowCustom
 *   groups={[{ key: 'legs', label: 'Legs', dot: 'var(--color-ok)' }]}
 *   items={[{ value: 'squat', label: 'Squat', group: 'legs' }]}
 *   value={exercise}
 *   onValueChange={setExercise}
 * />
 * ```
 */
export function Combobox<V extends string>({
  items,
  value,
  defaultValue = null,
  onValueChange,
  placeholder,
  allowCustom = false,
  groups,
  emptyText = 'No matches',
  renderItem,
  label,
  name,
  disabled,
  invalid,
  id,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: ComboboxProps<V>): JSX.Element {
  const [inner, setInner] = useState<V | null>(defaultValue)
  const current = value !== undefined ? value : inner

  const sections = useMemo(
    () => buildSections(items, groups ?? []),
    [items, groups],
  )
  const grouped = sections.some(s => s.key !== '')
  const labelByValue = useMemo(
    () => new Map(items.map(item => [item.value as string, item.label])),
    [items],
  )
  const labelOf = (v: V | null): string =>
    v == null ? '' : (labelByValue.get(v) ?? v)

  const collection = useMemo(
    () =>
      BaseCombobox.createItems<ComboboxItem<V>, string>(
        grouped ? sections : items.slice(),
        { getValue: item => item.value, getLabel: item => item.label },
      ),
    [grouped, sections, items],
  )

  const [text, setText] = useState(() => labelOf(current))
  const [seen, setSeen] = useState(current)
  if (seen !== current) {
    // The parent changed the value: show its label.
    setSeen(current)
    setText(labelOf(current))
  }

  const highlighted = useRef<string | undefined>(undefined)
  const actions = useRef<BaseCombobox.Root.Actions | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Callbacks fire before the re-render that carries a commit, so they read
  // what was committed from here rather than from `current`.
  const committed = useRef(current)
  useEffect(() => {
    committed.current = current
  }, [current])

  function commit(next: V | null): void {
    setText(labelOf(next))
    setSeen(next)
    setInner(next)
    if (next !== committed.current) {
      committed.current = next
      onValueChange?.(next)
    }
  }

  function commitText(): void {
    const typed = text.trim()
    if (typed === '') {
      commit(null)
    } else if (allowCustom && typed !== labelOf(committed.current)) {
      const item = items.find(i => fold(i.label) === fold(typed))
      commit(item && !item.disabled ? item.value : (typed as V))
    } else {
      setText(labelOf(committed.current))
    }
  }

  // Base UI keeps disabled rows reachable by arrow key so that screen readers
  // can announce them. Here they are skipped: landing on one repeats the key
  // that got there. `hops` stops an all-disabled list from looping.
  const disabledValues = useMemo(
    () => new Set(items.filter(i => i.disabled).map(i => i.value as string)),
    [items],
  )
  const arrow = useRef<'ArrowDown' | 'ArrowUp'>('ArrowDown')
  const hops = useRef(0)
  const repeating = useRef(false)

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      arrow.current = event.key
      if (!repeating.current) {
        hops.current = 0
      }
    } else if (event.key === 'Enter' && highlighted.current === undefined) {
      if (allowCustom && text.trim() !== '') {
        commitText()
        if (actions.current) {
          event.preventDefault()
          actions.current.close()
        }
      }
    }
  }

  function skipDisabled(
    v: string | undefined,
    details: BaseCombobox.Root.HighlightEventDetails,
  ): void {
    highlighted.current = v
    if (
      details.reason !== 'keyboard' ||
      v === undefined ||
      !disabledValues.has(v) ||
      hops.current >= items.length
    ) {
      return
    }

    hops.current += 1
    queueMicrotask(() => {
      repeating.current = true
      inputRef.current?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: arrow.current,
          bubbles: true,
          cancelable: true,
        }),
      )
      repeating.current = false
    })
  }

  // The form gets what is in the field, committed or not.
  const typed = text.trim()
  const dirty = typed !== labelOf(current)
  const submitted =
    allowCustom && dirty && typed !== '' ? typed : (current ?? '')

  return (
    <BaseCombobox.Root
      actionsRef={actions}
      autoHighlight={!allowCustom}
      disabled={disabled}
      filter={(item, query) => matches(item, query)}
      inputValue={text}
      isItemEqualToValue={(a, b) => a === b}
      items={collection}
      itemToStringLabel={labelOf}
      value={current}
      onInputValueChange={(next, details) => {
        // Item presses and resets are driven by `onValueChange` and
        // `onOpenChange`; only typing edits the text.
        if (details.reason === 'input-change') {
          setText(next)
        }
      }}
      onItemHighlighted={(v, details) => skipDisabled(v ?? undefined, details)}
      onOpenChange={(open, details) => {
        if (open || details.reason === 'item-press') {
          return
        }
        if (details.reason === 'escape-key') {
          setText(labelOf(committed.current))
        } else {
          commitText()
        }
      }}
      onValueChange={(next, details) => {
        // Escape restores the committed value; Base UI also clears the
        // selection on Escape when the panel is already closed.
        if (
          details.reason !== 'input-clear' &&
          details.reason !== 'escape-key'
        ) {
          commit(next)
        }
      }}
    >
      <BaseCombobox.InputGroup className={cns('relative', className)}>
        <BaseCombobox.Input
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-label={label}
          id={id}
          placeholder={placeholder}
          render={<Input className="pr-9" invalid={invalid} />}
          ref={inputRef}
          onKeyDown={onKeyDown}
        />
        <BaseCombobox.Trigger
          aria-label={`Show ${label} options`}
          className={cns(
            'group absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink-3 outline-none',
            'focus-visible:text-ink data-disabled:pointer-events-none data-disabled:opacity-40',
          )}
          tabIndex={-1}
        >
          <Icon
            className="size-4 transition-transform duration-200 ease-standard group-data-popup-open:rotate-180"
            name="chevron"
          />
        </BaseCombobox.Trigger>
        {name != null && <input name={name} type="hidden" value={submitted} />}
      </BaseCombobox.InputGroup>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner
          align="start"
          anchor={undefined}
          className="z-50"
          sideOffset={4}
        >
          <BaseCombobox.Popup
            className={cns(
              'w-(--anchor-width) max-w-(--available-width)',
              FLOATING_PANEL,
            )}
          >
            <div
              aria-hidden="true"
              className="hidden items-center gap-2 px-2.5 pb-2 text-sm text-ink-3 pointer-coarse:flex"
            >
              <Icon className="size-4" name="search" />
              <span className="truncate">{text.trim() || 'Search…'}</span>
            </div>
            <BaseCombobox.Empty className="px-2.5 py-2 text-sm text-ink-3 empty:p-0">
              {emptyText}
            </BaseCombobox.Empty>
            <BaseCombobox.List className="max-h-(--available-height) overflow-y-auto outline-none">
              {(entry: ComboboxItem<V> | Section<V>) =>
                'items' in entry ? (
                  <BaseCombobox.Group key={entry.key} items={entry.items}>
                    {entry.label != null && (
                      <BaseCombobox.GroupLabel
                        className={cns(
                          FLOATING_GROUP_LABEL,
                          'flex items-center gap-2',
                        )}
                      >
                        {entry.dot != null && (
                          <span
                            aria-hidden="true"
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: entry.dot }}
                          />
                        )}
                        {entry.label}
                      </BaseCombobox.GroupLabel>
                    )}
                    <BaseCombobox.Collection>
                      {(item: ComboboxItem<V>) => (
                        <Row
                          key={item.value}
                          item={item}
                          renderItem={renderItem}
                        />
                      )}
                    </BaseCombobox.Collection>
                  </BaseCombobox.Group>
                ) : (
                  <Row key={entry.value} item={entry} renderItem={renderItem} />
                )
              }
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  )
}
