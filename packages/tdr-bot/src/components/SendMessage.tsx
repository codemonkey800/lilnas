'use client'

import { cns } from '@lilnas/utils/cns'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from 'src/components/Button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'src/components/Card'
import { Label } from 'src/components/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'src/components/Select'
import { TextArea } from 'src/components/TextArea'
import { useChannels } from 'src/queries/useChannels'
import { useSendMessage } from 'src/queries/useSendMessage'

const MAX_MESSAGE_LENGTH = 2000

export function SendMessage() {
  const [selectedChannelId, setSelectedChannelId] = useState<string>('')
  const [message, setMessage] = useState<string>('')

  const { data: channels, isLoading: isLoadingChannels } = useChannels()
  const { mutate: sendMessage, isPending } = useSendMessage()

  const characterCount = message.length
  const isOverLimit = characterCount > MAX_MESSAGE_LENGTH
  const canSend =
    selectedChannelId && message.trim().length > 0 && !isOverLimit && !isPending

  const handleSend = () => {
    if (!canSend) return

    sendMessage(
      { channelId: selectedChannelId, content: message },
      {
        onSuccess: () => {
          setMessage('')
          toast.success('Message sent successfully!')
        },
        onError: error => {
          toast.error((error as Error).message)
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send Message</CardTitle>
        <CardDescription>
          Send a message to a Discord channel from the admin panel
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="channel-select">Channel</Label>
          <Select
            value={selectedChannelId}
            onValueChange={setSelectedChannelId}
            disabled={isLoadingChannels}
          >
            <SelectTrigger id="channel-select">
              <SelectValue
                placeholder={
                  isLoadingChannels ? 'Loading channels...' : 'Select a channel'
                }
              />
            </SelectTrigger>
            <SelectContent className="max-h-96">
              {channels?.map(channel => (
                <SelectItem key={channel.id} value={channel.id}>
                  #{channel.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="message-textarea">Message</Label>
            <span
              className={cns(
                'text-xs',
                isOverLimit
                  ? 'text-red-500 dark:text-red-400'
                  : 'text-neutral-500 dark:text-neutral-400',
              )}
            >
              {characterCount}/{MAX_MESSAGE_LENGTH}
            </span>
          </div>
          <TextArea
            id="message-textarea"
            placeholder="Type your message here..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            disabled={isPending}
            rows={5}
            className={cns(
              isOverLimit &&
                'border-red-500 focus-visible:ring-red-500 dark:border-red-400',
            )}
          />
          {isOverLimit && (
            <p className="text-xs text-red-500 dark:text-red-400">
              Message exceeds Discord&apos;s {MAX_MESSAGE_LENGTH} character
              limit
            </p>
          )}
        </div>

        <Button
          onClick={handleSend}
          disabled={!canSend}
          className="w-full"
          size="lg"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span
                className={cns(
                  'animate-spin rounded-full h-4 w-4',
                  'border-b-2 border-white',
                )}
              />
              Sending...
            </span>
          ) : (
            'Send Message'
          )}
        </Button>
      </CardContent>
    </Card>
  )
}
