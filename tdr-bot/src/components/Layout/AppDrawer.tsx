import { Home, Message, Settings } from '@mui/icons-material'
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material'

import { MobileAppDrawer } from './MobileAppDrawer'

const ITEMS = [
  { label: 'Home', href: '/', Icon: Home },
  { label: 'Messages', href: '/messages', Icon: Message },
  { label: 'Settings', href: '/settings', Icon: Settings },
]

function DrawerContent() {
  return (
    <List>
      {ITEMS.map(({ label, href, Icon }) => (
        <ListItem key={href} disablePadding>
          <ListItemButton href={href}>
            <ListItemIcon>
              <Icon />
            </ListItemIcon>

            <ListItemText primary={label} />
          </ListItemButton>
        </ListItem>
      ))}
    </List>
  )
}

export function AppDrawer() {
  return (
    <>
      <MobileAppDrawer>
        <DrawerContent />
      </MobileAppDrawer>

      <Drawer
        classes={{
          root: 'max-md:hidden',
          paper: 'w-[256px]',
        }}
        variant="permanent"
        anchor="left"
      >
        <DrawerContent />
      </Drawer>
    </>
  )
}
