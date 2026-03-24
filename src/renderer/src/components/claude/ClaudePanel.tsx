import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Trash2, StopCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { useTabStore } from '@renderer/store/tabStore'
import { useConnectionStore } from '@renderer/store/connectionStore'
import { MessageBubble } from './MessageBubble'
import { ToolCallCard } from './ToolCallCard'
import { trpc } from '@renderer/lib/trpc'
import type { ChatMessage, ToolCallInfo } from '@shared/types'

export function ClaudePanel() {
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [sessions, setSessions] = useState<
    { id: string; createdAt: number; updatedAt: number; preview: string; messageCount: number }[]
  >([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const tab = useTabStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const { addMessage, updateMessage, setStreaming, clearMessages, startNewChat, executeQuery } =
    useTabStore()

  const profiles = useConnectionStore((s) => s.profiles)
  const activeConnection = useConnectionStore((s) => s.activeConnection)

  const messages = tab?.messages ?? []
  const isStreaming = tab?.isStreaming ?? false

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  // IPC event listeners
  useEffect(() => {
    const electron = window.electron

    const handleStreamStart = (_: unknown, data: { messageId: string }) => {
      const store = useTabStore.getState()
      store.setStreaming(true)
      store.addMessage({
        id: data.messageId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: Date.now()
      })
    }

    const handleTextDelta = (_: unknown, data: { messageId: string; text: string }) => {
      useTabStore.getState().updateMessage(data.messageId, { content: data.text })
    }

    const handleToolUse = (_: unknown, data: { messageId: string; toolCall: ToolCallInfo }) => {
      const store = useTabStore.getState()
      const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
      const msg = activeTab?.messages.find((m) => m.id === data.messageId)
      const existing = msg?.toolCalls ?? []
      if (!existing.find((tc) => tc.id === data.toolCall.id)) {
        store.updateMessage(data.messageId, { toolCalls: [...existing, data.toolCall] })
      }
    }

    const handleToolResult = (_: unknown, data: { messageId: string; toolUseId: string; result: string; status: string }) => {
      const store = useTabStore.getState()
      const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
      const msg = activeTab?.messages.find((m) => m.id === data.messageId)
      if (msg?.toolCalls) {
        const toolCall = msg.toolCalls.find((tc) => tc.id === data.toolUseId)
        const updatedCalls = msg.toolCalls.map((tc) =>
          tc.id === data.toolUseId
            ? { ...tc, result: data.result, status: data.status as ToolCallInfo['status'] }
            : tc
        )
        store.updateMessage(data.messageId, { toolCalls: updatedCalls })

        // Push mongo_find results directly to the document table
        const isFindTool = toolCall?.name?.includes('find') ||
          toolCall?.name?.includes('mongo_find')
        console.log('[DEBUG tool-result]', { toolCallName: toolCall?.name, isFindTool, hasResult: !!data.result, scope: activeTab?.scope, resultPreview: data.result?.slice(0, 200) })
        if (activeTab && activeTab.scope === 'collection' && isFindTool && data.result) {
          try {
            // Result may be raw JSON or wrapped in MCP content array
            let resultStr = data.result
            try {
              const outer = JSON.parse(resultStr)
              if (Array.isArray(outer) && outer[0]?.text) {
                resultStr = outer[0].text
              }
            } catch { /* already a plain string */ }
            const parsed = JSON.parse(resultStr)
            if (parsed.documents && Array.isArray(parsed.documents)) {
              store.updateTab(activeTab.id, {
                results: { documents: parsed.documents, totalCount: parsed.totalCount ?? parsed.documents.length },
                loading: false
              })
            }
          } catch { /* not valid JSON, ignore */ }
        }
      }
    }

    const handleStreamEnd = (_: unknown, data: { messageId: string; text: string; lastFindInput?: { database?: string; collection?: string; filter?: Record<string, unknown> } }) => {
      const store = useTabStore.getState()
      store.setStreaming(false)
      if (data.text) {
        store.updateMessage(data.messageId, { content: data.text })
      }
      // Mark all pending tools as success
      const activeTab = store.tabs.find((t) => t.id === store.activeTabId)
      const msg = activeTab?.messages.find((m) => m.id === data.messageId)
      if (msg?.toolCalls?.length) {
        const updatedCalls = msg.toolCalls.map((tc) =>
          tc.status === 'pending' || tc.status === 'running'
            ? { ...tc, status: 'success' as const }
            : tc
        )
        store.updateMessage(data.messageId, { toolCalls: updatedCalls })
      }
      // If Claude ran a mongo_find, update the tab filter to match and re-query
      if (data.lastFindInput?.filter && activeTab?.scope === 'collection') {
        store.updateTab(activeTab.id, { filter: data.lastFindInput.filter, page: 0 })
      }
      // Refresh data with the (potentially updated) filter
      store.executeQuery()
      // Auto-save chat session (re-read state to capture tool status updates)
      const currentTab = useTabStore.getState().tabs.find((t) => t.id === useTabStore.getState().activeTabId)
      if (currentTab && currentTab.messages.length > 0) {
        trpc.chatHistory.save
          .mutate({
            tabId: currentTab.id,
            sessionId: currentTab.chatSessionId,
            messages: currentTab.messages
          })
          .catch(() => {})
      }
    }

    electron.ipcRenderer.on('claude:stream-start', handleStreamStart)
    electron.ipcRenderer.on('claude:text-delta', handleTextDelta)
    electron.ipcRenderer.on('claude:tool-use', handleToolUse)
    electron.ipcRenderer.on('claude:tool-result', handleToolResult)
    electron.ipcRenderer.on('claude:stream-end', handleStreamEnd)

    return () => {
      electron.ipcRenderer.removeAllListeners('claude:stream-start')
      electron.ipcRenderer.removeAllListeners('claude:text-delta')
      electron.ipcRenderer.removeAllListeners('claude:tool-use')
      electron.ipcRenderer.removeAllListeners('claude:tool-result')
      electron.ipcRenderer.removeAllListeners('claude:stream-end')
    }
  }, [])

  // Load most recent session when tab switches
  useEffect(() => {
    if (!tab) return
    // If tab has no messages, try to load the most recent session
    if (tab.messages.length === 0) {
      trpc.chatHistory.list
        .query({ tabId: tab.id })
        .then((sessionList) => {
          if (sessionList.length > 0) {
            trpc.chatHistory.load.query({ sessionId: sessionList[0].id }).then((session) => {
              if (session && session.messages.length > 0) {
                const store = useTabStore.getState()
                // Sanitize any stale running/pending tool statuses from previous sessions
                const messages = session.messages.map((m) => {
                  if (!m.toolCalls?.length) return m
                  return {
                    ...m,
                    toolCalls: m.toolCalls.map((tc) =>
                      tc.status === 'pending' || tc.status === 'running'
                        ? { ...tc, status: 'success' as const }
                        : tc
                    )
                  }
                })
                store.updateTab(tab.id, {
                  messages,
                  chatSessionId: session.id
                })
              }
            })
          }
        })
        .catch(() => {})
    }
  }, [tab?.id])

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming || !tab) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now()
    }
    addMessage(userMessage)
    setInput('')

    const activeProfile = profiles.find((p) => p.id === activeConnection?.profileId)

    try {
      await trpc.claude.sendMessage.mutate({
        message: userMessage.content,
        context: {
          connectionName: activeProfile?.name,
          database: tab.database || undefined,
          collection: tab.collection || undefined,
          currentFilter: Object.keys(tab.filter).length > 0 ? tab.filter : undefined,
          resultCount: tab.results?.documents.length,
          page: tab.page + 1,
          totalPages: tab.results ? Math.ceil(tab.results.totalCount / tab.pageSize) : 1,
          openDocumentId: tab.selectedDocument?._id ? String(tab.selectedDocument._id) : undefined
        }
      })
    } catch (err) {
      console.error('Failed to send message:', err)
      setStreaming(false)
    }
  }, [input, isStreaming, tab, profiles, activeConnection])

  const handleAbort = async () => {
    await trpc.claude.abort.mutate()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Claude</span>
          {tab && (
            <span className="text-[10px] text-muted-foreground">
              {tab.scope === 'connection'
                ? 'Connection'
                : tab.scope === 'database'
                  ? tab.database
                  : `${tab.database}.${tab.collection}`}
            </span>
          )}
          {isStreaming && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              thinking...
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={async () => {
              if (tab) {
                const list = await trpc.chatHistory.list.query({ tabId: tab.id })
                setSessions(list)
                setShowHistory(!showHistory)
              }
            }}
          >
            History
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={startNewChat}>
            New Chat
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={clearMessages}
            title="Clear chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* History dropdown */}
      {showHistory && (
        <div className="border-b border-border bg-muted/50 max-h-48 overflow-y-auto">
          {sessions.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
              No saved chats
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className="flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left hover:bg-accent/50"
                onClick={async () => {
                  const session = await trpc.chatHistory.load.query({ sessionId: s.id })
                  if (session) {
                    const store = useTabStore.getState()
                    // Sanitize any stale running/pending tool statuses from previous sessions
                    const messages = session.messages.map((m) => {
                      if (!m.toolCalls?.length) return m
                      return {
                        ...m,
                        toolCalls: m.toolCalls.map((tc) =>
                          tc.status === 'pending' || tc.status === 'running'
                            ? { ...tc, status: 'success' as const }
                            : tc
                        )
                      }
                    })
                    store.updateTab(tab!.id, {
                      messages,
                      chatSessionId: session.id
                    })
                  }
                  setShowHistory(false)
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-xs text-foreground">{s.preview}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {new Date(s.updatedAt).toLocaleDateString()} &middot; {s.messageCount} messages
                  </div>
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={async (e) => {
                    e.stopPropagation()
                    await trpc.chatHistory.delete.mutate({ sessionId: s.id })
                    setSessions((prev) => prev.filter((x) => x.id !== s.id))
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </button>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      <ScrollArea className="flex-1 p-3">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-sm text-muted-foreground">
              {tab ? (
                tab.scope === 'connection' ? (
                  <>
                    Ask Claude about this connection
                    <br />
                    <span className="text-xs">e.g. "List all databases" or "What collections exist?"</span>
                  </>
                ) : tab.scope === 'database' ? (
                  <>
                    Ask Claude about <span className="text-foreground">{tab.database}</span>
                    <br />
                    <span className="text-xs">e.g. "What collections are in this database?" or "Show schema for users"</span>
                  </>
                ) : (
                  <>
                    Ask Claude about <span className="text-foreground">{tab.collection}</span>
                    <br />
                    <span className="text-xs">e.g. "Show me all records from July 2019"</span>
                  </>
                )
              ) : (
                'Open a collection to chat with Claude'
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => (
              <div key={msg.id}>
                {msg.role === 'assistant' && msg.toolCalls?.length ? (
                  <>
                    {msg.toolCalls.map((tc) => (
                      <ToolCallCard key={tc.id} toolCall={tc} />
                    ))}
                    <MessageBubble message={msg} />
                  </>
                ) : (
                  <>
                    <MessageBubble message={msg} />
                    {msg.toolCalls?.map((tc) => (
                      <ToolCallCard key={tc.id} toolCall={tc} />
                    ))}
                  </>
                )}
              </div>
            ))}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2">
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                  <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex gap-2">
          <textarea
            className="flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            placeholder={tab ? (tab.scope === 'connection' ? 'Ask about this connection...' : tab.scope === 'database' ? `Ask about ${tab.database}...` : `Ask about ${tab.collection}...`) : 'Ask Claude...'}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!tab}
          />
          {isStreaming ? (
            <Button size="icon" variant="destructive" className="h-auto" onClick={handleAbort}>
              <StopCircle className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" className="h-auto" onClick={handleSend} disabled={!input.trim() || !tab}>
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
