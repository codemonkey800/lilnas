import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import { z } from 'zod'

/** Identifiers for each node (and pseudo-node) in the LangGraph state machine. */
export enum GraphNode {
  AddTdrSystemPrompt = 'addTdrSystemPrompt',
  CheckResponseType = 'checkResponseType',
  End = '__end__',
  GetModelDefaultResponse = 'getModelDefaultResponse',
  GetModelImageResponse = 'getModelImageResponse',
  GetModelMathResponse = 'getModelMathResponse',
  GetModelMediaResponse = 'getModelMediaResponse',
  GetModelReminderResponse = 'getModelReminderResponse',
  Start = '__start__',
  Tools = 'tools',
  TrimMessages = 'trimMessages',
}

/** Classification of a user message that determines which graph branch executes. */
export enum ResponseType {
  Default = 'default',
  Image = 'image',
  Math = 'math',
  Media = 'media',
  Reminder = 'reminder',
}

/** Type of media the user is requesting (movies, TV shows, or both). */
export enum MediaRequestType {
  Movies = 'movies',
  Shows = 'shows',
  Both = 'both',
}

/** Whether the user wants to search their existing library, external databases, or both. */
export enum SearchIntent {
  Library = 'library',
  External = 'external',
  Both = 'both',
  Delete = 'delete',
}

export const ImageQuerySchema = z
  .array(
    z.object({
      query: z.string(),
      title: z.string(),
    }),
  )
  .max(3)

export const ImageResponseSchema = z.object({
  title: z.string(),
  url: z.string(),
  parentId: z.string().optional(),
})

export type ImageResponse = z.infer<typeof ImageResponseSchema>

export const MediaRequestSchema = z.object({
  mediaType: z.nativeEnum(MediaRequestType),
  searchIntent: z.nativeEnum(SearchIntent),
  searchTerms: z.string(),
})

export type MediaRequest = z.infer<typeof MediaRequestSchema>

/** State schema for the graph's public input surface. */
export const InputStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>,
  userInput: Annotation<string>,
  userId: Annotation<string>,
  guildId: Annotation<string>,
})

/** State schema for the graph's public output surface. */
export const OutputStateAnnotation = Annotation.Root({
  images: Annotation<ImageResponse[]>,
  messages: Annotation<BaseMessage[]>,
  responseType: Annotation<ResponseType | undefined>,
})

/** Combined internal state that flows between graph nodes (superset of input + output). */
export const OverallStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
  }),
  userInput: Annotation<string>,
  userId: Annotation<string>,
  guildId: Annotation<string>,
  images: Annotation<ImageResponse[]>,
  message: Annotation<HumanMessage>(),
  responseType: Annotation<ResponseType>,
})
