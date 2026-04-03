import Editor from '@monaco-editor/react'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { AggregationStage } from '@shared/types'

interface StageEditorProps {
  stage: AggregationStage | null
  onChange: (content: string) => void
}

export function StageEditor({ stage, onChange }: StageEditorProps) {
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)

  if (!stage) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Select a stage to edit
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          Stage Editor &mdash; {stage.type}
        </span>
      </div>
      <div className="flex-1">
        <Editor
          key={stage.id}
          height="100%"
          defaultLanguage="json"
          defaultValue={stage.content}
          onChange={(value) => onChange(value ?? '')}
          theme={effectiveTheme === 'dark' ? 'vs-dark' : 'light'}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'off',
            scrollBeyondLastLine: false,
            fontSize: 12,
            tabSize: 2,
            wordWrap: 'on',
            automaticLayout: true,
            bracketPairColorization: { enabled: true }
          }}
        />
      </div>
    </div>
  )
}
