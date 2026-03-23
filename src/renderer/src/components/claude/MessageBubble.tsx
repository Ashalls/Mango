import Markdown from 'react-markdown'
import { cn } from '@renderer/lib/utils'
import type { ChatMessage } from '@shared/types'

interface MessageBubbleProps {
  message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  if (!isUser && !message.content) return null

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground'
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              code: ({ children, className }) => {
                const isBlock = className?.includes('language-')
                return isBlock ? (
                  <pre className="my-2 overflow-x-auto rounded bg-background/50 p-2 text-xs">
                    <code>{children}</code>
                  </pre>
                ) : (
                  <code className="rounded bg-background/50 px-1 py-0.5 text-xs font-mono">{children}</code>
                )
              },
              pre: ({ children }) => <>{children}</>,
              ul: ({ children }) => <ul className="mb-2 ml-4 list-disc last:mb-0">{children}</ul>,
              ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal last:mb-0">{children}</ol>,
              li: ({ children }) => <li className="mb-0.5">{children}</li>,
              h1: ({ children }) => <h1 className="mb-1 text-base font-bold">{children}</h1>,
              h2: ({ children }) => <h2 className="mb-1 text-sm font-bold">{children}</h2>,
              h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold">{children}</h3>,
              blockquote: ({ children }) => (
                <blockquote className="my-1 border-l-2 border-muted-foreground/30 pl-2 italic">{children}</blockquote>
              ),
              hr: () => <hr className="my-2 border-border" />
            }}
          >
            {message.content}
          </Markdown>
        )}
      </div>
    </div>
  )
}
