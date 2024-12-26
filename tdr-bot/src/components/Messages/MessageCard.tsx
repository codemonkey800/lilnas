import { MessageState } from 'src/api/api.types'
import { MessageResponseSchema } from 'src/schemas/messages'
import { formatJsonString, isJson } from 'src/utils/json'

export function MessageCard({ message }: { message: MessageState }) {
  const toolsCalls = message.kwargs.tool_calls ?? []
  const response = isJson(message.content)
    ? MessageResponseSchema.safeParse(JSON.parse(message.content)).data
    : undefined

  return (
    <div className="bg-gray-800 rounded-lg p-6 flex flex-col gap-3 text-white">
      {message.id && <p className="text-lg font-bold">ID: {message.id}</p>}
      <p className="text-lg font-medium">Type: {message.type}</p>

      {toolsCalls.length > 0 && (
        <div>
          <p className="mb-2">Tools called:</p>

          <ul className="pl-3 flex flex-col gap-y-8">
            {toolsCalls.map((toolsCall) => (
              <li key={toolsCall.id}>
                <p>ID: {toolsCall.id}</p>
                <p>Function: {toolsCall.function.name}</p>
                <pre className="w-full overflow-auto">
                  {formatJsonString(toolsCall.function.arguments)}
                </pre>
              </li>
            ))}
          </ul>
        </div>
      )}

      {response ? (
        <div>
          <p>{response.content}</p>

          {response.images.length > 0 && (
            <div className="flex flex-wrap mt-8">
              {response.images.map((image) => (
                <img
                  className="max-w-[400px]"
                  key={image.title}
                  src={image.url}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <pre className="w-full overflow-auto">
          {isJson(message.content)
            ? formatJsonString(message.content)
            : message.content}
        </pre>
      )}
    </div>
  )
}
