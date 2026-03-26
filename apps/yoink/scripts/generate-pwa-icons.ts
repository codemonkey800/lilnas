import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

const BG = { r: 13, g: 15, b: 14, alpha: 1 }
const SVG_PATH = path.resolve('src/app/icon.svg')
const OUTPUT_DIR = path.resolve('public/icons')

async function generateIcon(
  size: number,
  filename: string,
  paddingFraction = 0,
) {
  const padding = Math.round(size * paddingFraction)
  const iconSize = size - padding * 2

  const iconBuffer = await sharp(SVG_PATH)
    .resize(iconSize, iconSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: iconBuffer, gravity: 'center' }])
    .png()
    .toFile(path.join(OUTPUT_DIR, filename))

  console.log(
    `  ✓ ${filename} (${size}×${size}${padding ? `, ${padding}px padding` : ''})`,
  )
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  console.log('Generating PWA icons...')

  await generateIcon(192, 'icon-192.png')
  await generateIcon(512, 'icon-512.png')
  // maskable: 20% inset so the logo sits in the safe zone
  await generateIcon(512, 'icon-maskable-512.png', 0.2)
  await generateIcon(180, 'apple-touch-icon.png')

  console.log('Done!')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
