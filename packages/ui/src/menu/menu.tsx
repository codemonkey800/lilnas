'use client'

import { Menu as BaseMenu } from '@base-ui/react/menu'
import { cns } from '@lilnas/utils/cns'
import type { ComponentProps, JSX, ReactNode } from 'react'

import {
  FLOATING_GROUP_LABEL,
  FLOATING_ITEM,
  FLOATING_PANEL,
} from '../internal/overlay'

type PopupProps = ComponentProps<typeof BaseMenu.Popup> &
  Pick<
    ComponentProps<typeof BaseMenu.Positioner>,
    'side' | 'align' | 'sideOffset'
  >

/** Bundles the portal and the positioner, so a menu is `Root > Trigger + Popup`. */
function Popup({
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  className,
  ...props
}: PopupProps): JSX.Element {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        align={align}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <BaseMenu.Popup
          {...props}
          className={cns('min-w-44', FLOATING_PANEL, className)}
        />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

type ItemProps = ComponentProps<typeof BaseMenu.Item> & {
  /** Red text, for the row that removes something. Put it below a `Separator`. */
  destructive?: boolean
  /** A keyboard hint, right-aligned in mono: `⌘C`. Display only. */
  shortcut?: ReactNode
}

/**
 * Arrow keys, Home/End and typeahead move through rows; Enter and Space pick
 * one. `render={<a href="…" />}` makes the row a link.
 */
function Item({
  destructive = false,
  shortcut,
  className,
  children,
  ...props
}: ItemProps): JSX.Element {
  return (
    <BaseMenu.Item
      {...props}
      className={cns(
        FLOATING_ITEM,
        destructive &&
          'text-bad data-highlighted:bg-bad-ghost data-highlighted:text-bad',
        className,
      )}
    >
      {children}
      {shortcut != null ? (
        <span className="ml-auto pl-4 font-mono text-mono-sm text-ink-3">
          {shortcut}
        </span>
      ) : null}
    </BaseMenu.Item>
  )
}

function Separator({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.Separator>): JSX.Element {
  return (
    <BaseMenu.Separator
      {...props}
      className={cns('my-1.5 h-px bg-line', className)}
    />
  )
}

function GroupLabel({
  className,
  ...props
}: ComponentProps<typeof BaseMenu.GroupLabel>): JSX.Element {
  return (
    <BaseMenu.GroupLabel
      {...props}
      className={cns(FLOATING_GROUP_LABEL, className)}
    />
  )
}

/**
 * An action menu.
 *
 * ```tsx
 * <Menu.Root>
 *   <Menu.Trigger render={<Button />}>Actions</Menu.Trigger>
 *   <Menu.Popup>
 *     <Menu.Item shortcut="⌘C" onClick={copy}>Copy link</Menu.Item>
 *     <Menu.Separator />
 *     <Menu.Item destructive onClick={remove}>Delete</Menu.Item>
 *   </Menu.Popup>
 * </Menu.Root>
 * ```
 */
export const Menu = {
  Root: BaseMenu.Root,
  Trigger: BaseMenu.Trigger,
  Popup,
  Item,
  Separator,
  Group: BaseMenu.Group,
  GroupLabel,
}
