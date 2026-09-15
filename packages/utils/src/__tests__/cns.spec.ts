import { cns, cnsNoMerge, THEME_FONT_SIZES } from 'src/cns'

describe('cns', () => {
  it('merges conflicting utilities last-wins', () => {
    expect(cns('px-2', 'px-4')).toBe('px-4')
    expect(cns('text-ink-3', 'text-ink-4')).toBe('text-ink-4')
  })

  it('keeps falsy values out of the result', () => {
    expect(cns('px-2', false, undefined, null, 'py-1')).toBe('px-2 py-1')
  })

  describe('theme font-size tokens', () => {
    // Regression: tailwind-merge only knows Tailwind's built-in font-size
    // names, so without the extendTailwindMerge config below these tokens are
    // classified as text *colours* and silently annihilate a neighbouring ink
    // colour (or get annihilated by one). See packages/utils/src/cns.ts.
    it.each([...THEME_FONT_SIZES])(
      'keeps both text-%s and an ink colour, in either order',
      token => {
        const both = [`text-${token}`, 'text-ink-3'].sort()
        expect(cns(`text-${token} text-ink-3`).split(' ').sort()).toEqual(both)
        expect(cns(`text-ink-3 text-${token}`).split(' ').sort()).toEqual(both)
      },
    )

    it('still treats two theme font sizes as one conflict group', () => {
      expect(cns('text-h1 text-h2')).toBe('text-h2')
      expect(cns('text-mono text-mono-sm')).toBe('text-mono-sm')
    })

    it('lets a theme token override an arbitrary size and vice versa', () => {
      expect(cns('text-[14px] text-h3')).toBe('text-h3')
      expect(cns('text-h3 text-[14px]')).toBe('text-[14px]')
      expect(cns('text-h3 text-[length:var(--text-mono)]')).toBe(
        'text-[length:var(--text-mono)]',
      )
    })

    it('leaves built-in font-size names working as before', () => {
      expect(cns('text-sm text-ink-2').split(' ').sort()).toEqual([
        'text-ink-2',
        'text-sm',
      ])
      expect(cns('text-sm text-h3')).toBe('text-h3')
    })

    it('does not touch the font-family group', () => {
      expect(cns('font-mono text-mono text-ink-3').split(' ').sort()).toEqual([
        'font-mono',
        'text-ink-3',
        'text-mono',
      ])
    })

    it('keeps two ink colours conflicting with each other', () => {
      expect(cns('text-cap text-ink-3 text-ink-4').split(' ').sort()).toEqual([
        'text-cap',
        'text-ink-4',
      ])
    })
  })
})

describe('cnsNoMerge', () => {
  it('concatenates without resolving conflicts', () => {
    expect(cnsNoMerge('text-cap', 'text-ink-3')).toBe('text-cap text-ink-3')
    expect(cnsNoMerge('px-2', 'px-4')).toBe('px-2 px-4')
  })
})
