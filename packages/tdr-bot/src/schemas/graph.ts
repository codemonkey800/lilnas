import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { Annotation } from '@langchain/langgraph'
import { z } from 'zod'

export enum GraphNode {
  AddTdrSystemPrompt = 'addTdrSystemPrompt',
  CheckResponseType = 'checkResponseType',
  End = '__end__',
  GetModelDefaultResponse = 'getModelDefaultResponse',
  GetModelImageResponse = 'getModelImageResponse',
  GetModelMathResponse = 'getModelMathResponse',
  GetModelMediaResponse = 'getModelMediaResponse',
  Start = '__start__',
  Tools = 'tools',
  TrimMessages = 'trimMessages',
}

export enum ResponseType {
  Default = 'default',
  Image = 'image',
  Math = 'math',
  Media = 'media',
}

export enum MediaRequestType {
  Movies = 'movies',
  Shows = 'shows',
  Both = 'both',
}

export enum SearchIntent {
  Library = 'library',
  External = 'external',
  Both = 'both',
  Delete = 'delete',
}

export const ImageQuerySchema = z.array(
  z.object({
    query: z.string(),
    title: z.string(),
  }),
)

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

export const InputStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>,
  userInput: Annotation<string>,
  userId: Annotation<string>,
})

export const OutputStateAnnotation = Annotation.Root({
  images: Annotation<ImageResponse[]>,
  messages: Annotation<BaseMessage[]>,
})

export const OverallStateAnnotation = Annotation.Root({
  ...InputStateAnnotation.spec,
  ...OutputStateAnnotation.spec,
  message: Annotation<HumanMessage>(),
  prevMessages: Annotation<BaseMessage[]>,
  responseType: Annotation<ResponseType>,
  userInput: Annotation<string>,
  userId: Annotation<string>,
})
