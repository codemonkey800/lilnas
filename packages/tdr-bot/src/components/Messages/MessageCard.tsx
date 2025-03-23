import { formatJsonString } from '@lilnas/utils/json'
import { Paper } from '@mui/material'

import { MessageState } from 'src/api/api.types'

export function MessageCard({ message }: { message: MessageState }) {
  const toolsCalls = message.kwargs.tool_calls ?? []

  return (
    <Paper
      className="rounded-lg p-6 flex flex-col gap-3 text-white"
      elevation={2}
    >
      {message.id && <p className="text-lg font-bold">ID: {message.id}</p>}
      <p className="text-lg font-medium">Type: {message.type}</p>

      {toolsCalls.length > 0 && (
        <div>
          <p className="mb-2">Tools called:</p>

          <ul className="pl-3 flex flex-col gap-y-8">
            {toolsCalls.map(toolsCall => (
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

      <div>
        <pre className="max-w-full overflow-scroll">{message.content}</pre>

        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap mt-8">
            {message.images.map(image => (
              <img
                className="max-w-[400px]"
                key={image.title}
                src={image.url}
              />
            ))}
          </div>
        )}
      </div>
    </Paper>
  )
}
