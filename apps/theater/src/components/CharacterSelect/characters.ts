export type Character = {
  id: string
  name: string
  modelUrl: string
  /**
   * Clip source for the stage preview. Several source models carry no real
   * animation of their own — just a static Mixamo T-pose export — so the
   * clip lives in a separate "without skin" glTF sharing the model's own
   * skeleton bone names (no mesh, no retargeting step needed to bind it).
   * Omit to fall back to the model file's own embedded clip, if any.
   */
  animationUrl?: string
  tagline?: string
  /** false → shown as a locked "coming soon" slot, not selectable. */
  available?: boolean
}

export const CHARACTERS: Character[] = [
  {
    id: 'master-chief',
    name: 'Master Chief',
    modelUrl: '/models/master-chief.glb',
    animationUrl: '/animations/idle.glb',
    tagline: 'Spartan-117 · UNSC',
  },
  {
    id: 'kanna',
    name: 'Kanna Kamui',
    modelUrl: '/models/kanna.glb',
    animationUrl: '/animations/idle.glb',
    tagline: "Kobayashi's Dragon Maid",
  },
  {
    id: 'anis',
    name: 'Anis',
    modelUrl: '/models/anis.glb',
    animationUrl: '/animations/idle.glb',
    tagline: 'Anis · Goddess of Victory: NIKKE',
  },
  {
    id: 'ghost',
    name: 'Ghost',
    modelUrl: '/models/ghost.glb',
    animationUrl: '/animations/idle.glb',
    tagline: 'Call of Duty: Modern Warfare 2',
  },
  {
    id: 'xxxtentacion',
    name: 'XXXTentacion',
    modelUrl: '/models/xxxtentacion.glb',
    animationUrl: '/animations/idle.glb',
    tagline: 'Rapper',
  },
  {
    id: 'tamara',
    name: 'Tamara',
    modelUrl: '/models/tamara.glb',
    animationUrl: '/animations/idle.glb',
    tagline: 'Outer Plane',
  },
  {
    id: 'charlie',
    name: 'Charlie',
    modelUrl: '/models/charlie.glb',
    animationUrl: '/animations/twerk.glb',
    tagline: 'The Legend',
  },
]
