'use client'

import { deepOrange } from '@mui/material/colors'
import { createTheme } from '@mui/material/styles'
import NextLink, { type LinkProps as NextLinkProps } from 'next/link'
import { forwardRef, type Ref } from 'react'

// Defaulting `LinkComponent` on the theme lets `<Button href="…">` /
// `<MenuItem href="…">` render a Next.js Link without callers passing
// `component={Link}`. That pattern crashes inside Server Components
// because a function reference can't cross the RSC → Client boundary.
const LinkBehavior = forwardRef(function LinkBehavior(
  props: NextLinkProps,
  ref: Ref<HTMLAnchorElement>,
) {
  return <NextLink prefetch={false} {...props} ref={ref} />
})

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: deepOrange,
  },

  typography: {
    fontFamily: 'var(--font-roboto)',
  },

  components: {
    MuiButtonBase: {
      defaultProps: {
        LinkComponent: LinkBehavior,
      },
    },
  },
})
