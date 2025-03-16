import { AppBar as MuiAppBar, Toolbar } from '@mui/material'

import { AppBarDrawerButton } from './AppBarDrawerButton'
import { AppBarPath } from './AppBarPath'

export function AppBar() {
  return (
    <MuiAppBar>
      <Toolbar>
        <AppBarDrawerButton />

        <h6 className="font-bold text-xl">
          <span>TDR</span>
          <AppBarPath />
        </h6>
      </Toolbar>
    </MuiAppBar>
  )
}
