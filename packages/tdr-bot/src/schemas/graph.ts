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
  Start = '__start__',
  Tools = 'tools',
  TrimMessages = 'trimMessages',
}

export enum ResponseType {
  Default = 'default',
  Image = 'image',
  Math = 'math',
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

export const InputStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>,
  userInput: Annotation<string>,
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
})
