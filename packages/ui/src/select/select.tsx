'use client'

import { Select as BaseSelect } from '@base-ui/react/select'
import { cns } from '@lilnas/utils/cns'
import type { ComponentProps, JSX } from 'react'

import { Icon } from '../icons'
import {
  FLOATING_GROUP_LABEL,
  FLOATING_ITEM,
  FLOATING_PANEL,
} from '../internal/overlay'

/**
 * Shaped like `Input`: the same height, well fill and `line-control` border,
 * with the chevron added. It takes the accent ring while focused or open.
 */
function Trigger({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Trigger>): JSX.Element {
  return (
    <BaseSelect.Trigger
      {...props}
      className={cns(
        'group inline-flex h-(--control-h) w-full min-w-0 items-center justify-between gap-2 rounded-md border border-line-control bg-bg-sunk px-3 text-left text-sm text-ink outline-none',
        'transition-[border-color,box-shadow] duration-200 ease-standard',
        'focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-ghost',
        'data-popup-open:border-accent data-popup-open:ring-2 data-popup-open:ring-accent-ghost',
        'data-disabled:cursor-not-allowed data-disabled:opacity-40',
        'data-invalid:border-bad',
        className,
      )}
    >
      {children}
      <BaseSelect.Icon className="shrink-0 text-ink-3 transition-transform duration-200 ease-standard group-data-popup-open:rotate-180">
        <Icon className="size-4" name="chevron" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

/** The chosen item's label. With no value it shows `placeholder` in `ink-3`. */
function Value({
  className,
  ...props
}: ComponentProps<typeof BaseSelect.Value>): JSX.Element {
  return (
    <BaseSelect.Value
      {...props}
      className={cns('truncate data-placeholder:text-ink-3', className)}
    />
  )
}

type PopupProps = ComponentProps<typeof BaseSelect.Popup> &
  Pick<
    ComponentProps<typeof BaseSelect.Positioner>,
    'side' | 'align' | 'sideOffset'
  >

/**
 * Bundles the portal, positioner and list. The panel opens under the trigger
 * at its width, like `Menu`, rather than overlaying the current value.
 */
function Popup({
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  className,
  children,
  ...props
}: PopupProps): JSX.Element {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align={align}
        alignItemWithTrigger={false}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <BaseSelect.Popup
          {...props}
          className={cns('min-w-(--anchor-width)', FLOATING_PANEL, className)}
        >
          <BaseSelect.List className="max-h-(--available-height) overflow-y-auto outline-none">
            {children}
          </BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

/** The picked row ends in a check in `accent-hi`. */
function Item({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseSelect.Item>): JSX.Element {
  return (
    <BaseSelect.Item
      {...props}
      className={cns(FLOATING_ITEM, 'justify-between', className)}
    >
      <BaseSelect.ItemText className="min-w-0 flex-1 truncate">
        {children}
      </BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="shrink-0 text-accent-hi">
        <Icon className="size-3.5" name="check" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  )
}

function GroupLabel({
  className,
  ...props
}: ComponentProps<typeof BaseSelect.GroupLabel>): JSX.Element {
  return (
    <BaseSelect.GroupLabel
      {...props}
      className={cns(FLOATING_GROUP_LABEL, className)}
    />
  )
}

/**
 * A single-choice dropdown. Pass `items` to `Root` so `Value` can show the
 * label of the chosen item (otherwise it shows the raw value), and `null` as
 * the value for "nothing chosen yet".
 *
 * ```tsx
 * <Select.Root items={{ sd: 'SD', hd: 'HD' }} value={quality} onValueChange={setQuality}>
 *   <Select.Trigger><Select.Value placeholder="Quality" /></Select.Trigger>
 *   <Select.Popup>
 *     <Select.Item value="sd">SD</Select.Item>
 *     <Select.Item value="hd">HD</Select.Item>
 *   </Select.Popup>
 * </Select.Root>
 * ```
 */
export const Select = {
  Root: BaseSelect.Root,
  Trigger,
  Value,
  Popup,
  Item,
  Group: BaseSelect.Group,
  GroupLabel,
}
