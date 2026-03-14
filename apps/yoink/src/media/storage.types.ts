export interface RootFolderStorage {
  path: string
  freeSpace: number
  totalSpace: number
  moviesBytes: number
  showsBytes: number
}

export interface LargestItem {
  title: string
  sizeOnDisk: number
  quality: string | null
  mediaType: 'movie' | 'show'
  href: string
  rootFolder: string | null
}

export interface StorageOverview {
  rootFolders: RootFolderStorage[]
  largestItems: LargestItem[]
}
