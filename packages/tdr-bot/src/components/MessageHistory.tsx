'use client'

import { cns } from '@lilnas/utils/cns'

import { MessageState } from 'src/api/api.types'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'src/components/Card'
import { useMessages } from 'src/queries/useMessages'
import { ImageResponse } from 'src/schemas/graph'

const MOCK_MESSAGES: MessageState[] = [
  {
    id: 'system-init-1',
    content:
      'TDR Bot initialized. Ready to assist with image generation, media requests, and general questions.',
    type: 'system',
    kwargs: {},
  },
  {
    id: 'human-1',
    content: 'Hey TDR! Can you generate an image for me?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-1',
    content:
      "Hello! Of course, I'd be happy to generate an image for you. What would you like me to create?",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 42,
        completion_tokens: 24,
        total_tokens: 66,
      },
    },
  },
  {
    id: 'human-2',
    content: 'Create an image of a serene sunset over the ocean',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-2',
    content:
      "I'll generate a beautiful sunset over the ocean image for you using DALL-E.",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-1',
    content:
      'Image generated successfully: A serene sunset over the ocean with vibrant orange and pink colors reflecting on calm waters.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img001',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-3',
    content: 'Here is your serene sunset over the ocean! 🌅',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 98,
        completion_tokens: 18,
        total_tokens: 116,
      },
    },
    images: [
      {
        title: 'Serene Sunset Over Ocean',
        url: 'https://picsum.photos/seed/sunset1/800/600',
        parentId: 'ai-3',
      },
    ],
  },
  {
    id: 'human-3',
    content: "That's beautiful! Can you make a futuristic cityscape?",
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-4',
    content:
      "Absolutely! I'll create a futuristic cityscape with towering buildings and neon lights.",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-2',
    content:
      'Image generated: A futuristic cityscape with gleaming skyscrapers, flying vehicles, and vibrant neon lighting illuminating the night sky.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img002',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-5',
    content:
      'Here is your futuristic cityscape! A cyberpunk-inspired vision of tomorrow. 🌃',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 145,
        completion_tokens: 22,
        total_tokens: 167,
      },
    },
    images: [
      {
        title: 'Futuristic Cityscape',
        url: 'https://picsum.photos/seed/city1/800/600',
        parentId: 'ai-5',
      },
    ],
  },
  {
    id: 'human-4',
    content: 'Wow! Can you also generate a cozy coffee shop interior?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-6',
    content: "I'll generate a warm and inviting coffee shop interior for you.",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-3',
    content:
      'Image generated: A cozy coffee shop interior with wooden furniture, warm lighting, plants, and steaming cups on tables.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img003',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-7',
    content:
      'Here is your cozy coffee shop! Perfect atmosphere for relaxing with a warm drink. ☕',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 189,
        completion_tokens: 21,
        total_tokens: 210,
      },
    },
    images: [
      {
        title: 'Cozy Coffee Shop Interior',
        url: 'https://picsum.photos/seed/coffee1/800/600',
        parentId: 'ai-7',
      },
    ],
  },
  {
    id: 'system-2',
    content:
      'Model configuration updated: Temperature 0.7, Max tokens: 4000, Model: gpt-4',
    type: 'system',
    kwargs: {
      config_change: {
        temperature: 0.7,
        max_tokens: 4000,
        model: 'gpt-4',
        timestamp: '2025-10-19T10:15:00Z',
      },
    },
  },
  {
    id: 'human-5',
    content: 'What capabilities does DALL-E have?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-8',
    content:
      'DALL-E is an AI image generation model that can create diverse images from text descriptions. It can:\n\n- Generate photorealistic images\n- Create artistic and stylized artwork\n- Combine multiple concepts creatively\n- Render objects in various styles\n- Produce detailed scenes and landscapes\n\nI use DALL-E to bring your visual ideas to life!',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 215,
        completion_tokens: 72,
        total_tokens: 287,
      },
    },
  },
  {
    id: 'human-6',
    content:
      'Can you generate an image of a dragon flying over a medieval castle?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-9',
    content:
      "I'll create an epic scene of a dragon soaring over a medieval castle for you!",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-4',
    content:
      'Image generated: A majestic dragon with scales glinting in the sunlight, flying over an ancient medieval castle with tall towers and stone walls.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img004',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-10',
    content:
      'Behold! Your dragon soaring majestically over the medieval castle. 🐉🏰',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 267,
        completion_tokens: 19,
        total_tokens: 286,
      },
    },
    images: [
      {
        title: 'Dragon Flying Over Medieval Castle',
        url: 'https://picsum.photos/seed/dragon1/800/600',
        parentId: 'ai-10',
      },
    ],
  },
  {
    id: 'human-7',
    content: 'Generate two images: a tropical beach and a snowy mountain peak',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-11',
    content:
      "Great idea! I'll generate both a tropical beach and a snowy mountain peak for you.",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-5',
    content:
      'Images generated: (1) A pristine tropical beach with turquoise waters and palm trees, (2) A majestic snow-covered mountain peak against a clear blue sky.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img005',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-12',
    content:
      'Here are both images - tropical paradise and alpine majesty! 🏖️⛰️',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 312,
        completion_tokens: 24,
        total_tokens: 336,
      },
    },
    images: [
      {
        title: 'Tropical Beach Paradise',
        url: 'https://picsum.photos/seed/beach1/800/600',
        parentId: 'ai-12',
      },
      {
        title: 'Snowy Mountain Peak',
        url: 'https://picsum.photos/seed/mountain1/800/600',
        parentId: 'ai-12',
      },
    ],
  },
  {
    id: 'human-8',
    content: 'Awesome! How about a steampunk robot?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-13',
    content:
      "I'll create a steampunk robot with gears, brass, and Victorian-era aesthetics!",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-6',
    content:
      'Image generated: A detailed steampunk robot with brass plating, exposed gears, copper pipes, and Victorian design elements.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img006',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-14',
    content:
      'Here is your steampunk robot! A magnificent blend of Victorian engineering and mechanical artistry. 🤖⚙️',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 358,
        completion_tokens: 26,
        total_tokens: 384,
      },
    },
    images: [
      {
        title: 'Steampunk Robot',
        url: 'https://picsum.photos/seed/robot1/800/600',
        parentId: 'ai-14',
      },
    ],
  },
  {
    id: 'human-9',
    content: 'Can you explain how the image generation process works?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-15',
    content:
      "When you request an image, here's what happens:\n\n1. I parse your description and optimize it for DALL-E\n2. The prompt is sent to DALL-E's API\n3. DALL-E generates the image using its neural network\n4. The image URL is returned\n5. I display it in our conversation\n\nThe entire process typically takes 5-15 seconds depending on complexity!",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 378,
        completion_tokens: 89,
        total_tokens: 467,
      },
    },
  },
  {
    id: 'human-10',
    content: 'Generate an image of an astronaut floating in space',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-16',
    content:
      "I'll create an image of an astronaut gracefully floating in the vastness of space.",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-7',
    content:
      'Image generated: An astronaut in a white spacesuit floating peacefully in space with Earth visible in the background and stars scattered across the darkness.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img007',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-17',
    content:
      'Here is your astronaut floating in space! A breathtaking view of humanity among the stars. 🚀✨',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 445,
        completion_tokens: 24,
        total_tokens: 469,
      },
    },
    images: [
      {
        title: 'Astronaut Floating in Space',
        url: 'https://picsum.photos/seed/space1/800/600',
        parentId: 'ai-17',
      },
    ],
  },
  {
    id: 'system-3',
    content: 'Image generation quota: 243 remaining today',
    type: 'system',
    kwargs: {
      quota_info: {
        remaining: 243,
        reset_time: '2025-10-20T00:00:00Z',
      },
    },
  },
  {
    id: 'human-11',
    content: 'Create an image of a magical forest with glowing mushrooms',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-18',
    content:
      "I'll generate an enchanting magical forest scene with bioluminescent mushrooms!",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-8',
    content:
      'Image generated: A mystical forest with towering trees, glowing blue and purple mushrooms illuminating the forest floor, and ethereal mist weaving between the trunks.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img008',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-19',
    content:
      'Here is your magical forest! A mystical realm with glowing mushrooms lighting the way. 🍄✨',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 512,
        completion_tokens: 23,
        total_tokens: 535,
      },
    },
    images: [
      {
        title: 'Magical Forest with Glowing Mushrooms',
        url: 'https://picsum.photos/seed/forest1/800/600',
        parentId: 'ai-19',
      },
    ],
  },
  {
    id: 'human-12',
    content: 'How long have you been able to generate images?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-20',
    content:
      "I've had DALL-E integration since my latest update! It's one of my favorite features because it lets me help bring your creative visions to life. Whether you need concept art, visualizations, or just something fun, I can generate it for you.",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 532,
        completion_tokens: 54,
        total_tokens: 586,
      },
    },
  },
  {
    id: 'human-13',
    content: 'Generate an abstract art piece with vibrant colors',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-21',
    content:
      "I'll create an abstract art piece with bold, vibrant colors for you!",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-9',
    content:
      'Image generated: An abstract composition featuring bold brushstrokes in electric blue, magenta, yellow, and orange, creating dynamic energy and movement.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img009',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-22',
    content:
      'Here is your abstract art piece! A vibrant explosion of colors and forms. 🎨',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 578,
        completion_tokens: 20,
        total_tokens: 598,
      },
    },
    images: [
      {
        title: 'Abstract Art - Vibrant Colors',
        url: 'https://picsum.photos/seed/abstract1/800/600',
        parentId: 'ai-22',
      },
    ],
  },
  {
    id: 'human-14',
    content:
      'Can you make an image of a cat wearing a wizard hat reading a spell book?',
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-23',
    content:
      "That's adorable! I'll generate a wizard cat studying magic for you.",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      tool_invoked: 'generate_image',
    },
  },
  {
    id: 'tool-10',
    content:
      'Image generated: A cute fluffy cat wearing a purple wizard hat with stars, sitting at a wooden table reading an ancient spell book with glowing runes.',
    type: 'tool',
    kwargs: {
      tool_call_id: 'call_img010',
      tool_name: 'generate_image',
    },
  },
  {
    id: 'ai-24',
    content:
      'Here is your wizard cat! Looks like this little mage is learning some powerful spells. 🐱‍👤📖✨',
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 638,
        completion_tokens: 26,
        total_tokens: 664,
      },
    },
    images: [
      {
        title: 'Wizard Cat Reading Spell Book',
        url: 'https://picsum.photos/seed/wizardcat/800/600',
        parentId: 'ai-24',
      },
    ],
  },
  {
    id: 'human-15',
    content: "That's perfect! Thanks for all these amazing images!",
    type: 'human',
    kwargs: {},
  },
  {
    id: 'ai-25',
    content:
      "You're very welcome! I'm glad you enjoyed them. Feel free to ask for more images anytime - I love bringing creative ideas to life! 😊",
    type: 'ai',
    kwargs: {
      model_name: 'gpt-4',
      usage: {
        prompt_tokens: 654,
        completion_tokens: 32,
        total_tokens: 686,
      },
    },
  },
]

export function MessageHistory() {
  // TODO move data to const declaration after testing is done
  let { data: messages, isLoading, error } = useMessages()

  error = null
  isLoading = false

  // Use mock data for testing
  messages = MOCK_MESSAGES

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat History</CardTitle>
        <CardDescription>
          Real-time view of TDR Bot conversation messages
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div
            className={cns(
              'flex items-center justify-center py-8',
              'text-neutral-500 dark:text-neutral-400',
            )}
          >
            <div
              className={cns(
                'animate-spin rounded-full h-8 w-8',
                'border-b-2 border-neutral-900 dark:border-neutral-100',
              )}
            />
          </div>
        )}

        {error && (
          <div
            className={cns(
              'flex items-center justify-center py-8',
              'text-red-500 dark:text-red-400',
              'text-sm',
            )}
          >
            Error loading messages: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && messages && messages.length === 0 && (
          <div
            className={cns(
              'flex items-center justify-center py-8',
              'text-neutral-500 dark:text-neutral-400',
              'text-sm',
            )}
          >
            No messages yet
          </div>
        )}

        {!isLoading && !error && messages && messages.length > 0 && (
          <div
            className={cns(
              'space-y-3',
              'max-h-[600px] overflow-y-auto',
              'pr-2',
            )}
          >
            {messages.map((message, index) => (
              <MessageItem
                key={message.id || `message-${index}`}
                message={message}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MessageTypeBadge({ type }: { type: string }) {
  const colors = {
    human: cns(
      'bg-blue-100 text-blue-800',
      'dark:bg-blue-950 dark:text-blue-300',
    ),
    ai: cns(
      'bg-purple-100 text-purple-800',
      'dark:bg-purple-950 dark:text-purple-300',
    ),
    system: cns(
      'bg-neutral-100 text-neutral-800',
      'dark:bg-neutral-800 dark:text-neutral-300',
    ),
    function: cns(
      'bg-green-100 text-green-800',
      'dark:bg-green-950 dark:text-green-300',
    ),
  }

  const color = colors[type as keyof typeof colors] || colors.system

  return (
    <span
      className={cns(
        'inline-flex items-center rounded-full px-2.5 py-0.5',
        'text-xs font-medium',
        color,
      )}
    >
      {type.toUpperCase()}
    </span>
  )
}

function MessageItem({
  message,
}: {
  message: {
    id?: string
    content: string
    type: string
    kwargs: Record<string, unknown>
    images?: unknown[]
  }
}) {
  const hasKwargs = Object.keys(message.kwargs).length > 0
  const hasImages = message.images && message.images.length > 0

  return (
    <div
      className={cns(
        'border rounded-lg p-4',
        'border-neutral-200 dark:border-neutral-800',
        'bg-neutral-50 dark:bg-neutral-900',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <MessageTypeBadge type={message.type} />
        {message.id && (
          <span
            className={cns(
              'text-xs text-neutral-500 dark:text-neutral-400',
              'truncate',
            )}
          >
            {message.id}
          </span>
        )}
      </div>

      <div
        className={cns(
          'text-sm mb-3',
          'text-neutral-900 dark:text-neutral-100',
          'break-words whitespace-pre-wrap',
        )}
      >
        {message.content}
      </div>

      {hasKwargs && (
        <div className="mt-3">
          <div
            className={cns(
              'text-xs font-medium mb-1',
              'text-neutral-700 dark:text-neutral-300',
            )}
          >
            Additional Data:
          </div>
          <pre
            className={cns(
              'text-xs p-2 rounded',
              'bg-neutral-100 dark:bg-neutral-800',
              'text-neutral-800 dark:text-neutral-200',
              'overflow-x-auto',
            )}
          >
            {JSON.stringify(message.kwargs, null, 2)}
          </pre>
        </div>
      )}

      {hasImages && message.images && (
        <div className="mt-3">
          <div
            className={cns(
              'text-xs font-medium mb-2',
              'text-neutral-700 dark:text-neutral-300',
            )}
          >
            Images: {message.images.length}
          </div>
          <div
            className={cns(
              'grid gap-3',
              message.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
            )}
          >
            {(message.images as ImageResponse[]).map((image, idx) => (
              <div
                key={`${message.id}-img-${idx}`}
                className={cns(
                  'rounded-lg overflow-hidden',
                  'border border-neutral-200 dark:border-neutral-700',
                  'bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                <img
                  src={image.url}
                  alt={image.title}
                  className={cns('w-full h-auto object-cover', 'max-h-64')}
                  loading="lazy"
                  onError={e => {
                    const target = e.target as HTMLImageElement
                    target.src =
                      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23ddd" width="400" height="300"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3EImage unavailable%3C/text%3E%3C/svg%3E'
                  }}
                />
                {image.title && (
                  <div
                    className={cns(
                      'px-3 py-2',
                      'text-xs text-neutral-700 dark:text-neutral-300',
                      'bg-neutral-50 dark:bg-neutral-900',
                    )}
                  >
                    {image.title}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
