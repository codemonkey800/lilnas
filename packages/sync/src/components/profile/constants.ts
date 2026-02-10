import type { IconType } from 'react-icons'
import {
  HiChatBubbleBottomCenterText,
  HiClock,
  HiGift,
  HiHandRaised,
  HiHeart,
} from 'react-icons/hi2'

export const PRONOUNS_OPTIONS = ['he/him', 'she/her', 'they/them'] as const

export interface LoveLanguage {
  id: string
  label: string
  description: string
  Icon: IconType
}

export const LOVE_LANGUAGES: LoveLanguage[] = [
  {
    id: 'words-of-affirmation',
    label: 'Words of Affirmation',
    description: 'Verbal compliments & encouragement',
    Icon: HiChatBubbleBottomCenterText,
  },
  {
    id: 'acts-of-service',
    label: 'Acts of Service',
    description: 'Helpful actions & thoughtful deeds',
    Icon: HiHeart,
  },
  {
    id: 'receiving-gifts',
    label: 'Receiving Gifts',
    description: 'Thoughtful presents & surprises',
    Icon: HiGift,
  },
  {
    id: 'quality-time',
    label: 'Quality Time',
    description: 'Undivided attention & togetherness',
    Icon: HiClock,
  },
  {
    id: 'physical-touch',
    label: 'Physical Touch',
    description: 'Hugs, closeness & physical presence',
    Icon: HiHandRaised,
  },
]

export const INTEREST_OPTIONS = [
  'Cooking',
  'Hiking',
  'Movies',
  'Gaming',
  'Travel',
  'Reading',
  'Music',
  'Fitness',
  'Art',
  'Photography',
  'Dancing',
  'Board Games',
  'Sports',
  'Wine & Dining',
  'Gardening',
  'Yoga',
] as const

export const GOAL_OPTIONS = [
  'Better communication',
  'Date night ideas',
  'Gift inspiration',
  'Conflict resolution',
  'Remembering important dates',
  'Deepening emotional connection',
  'Understanding each other better',
  'Fun activities together',
] as const
