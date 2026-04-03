import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { AllCommunityModule, ModuleRegistry, themeAlpine } from 'ag-grid-community'
import type { ColDef, RowClickedEvent } from 'ag-grid-community'
import { RefreshCw, Trash2, Play, Square, Copy, ExternalLink, Activity } from 'lucide-react'
import { trpc } from '@renderer/lib/trpc'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useTabStore } from '@renderer/store/tabStore'
import type { ProfilerEntry } from '@shared/types'

ModuleRegistry.registerModules([AllCommunityModule])

interface QueryProfilerProps {
  database: string
}

type ProfilingLevel = 0 | 1 | 2
type AutoRefresh = 'off' | '5s' | '10s' | '30s'
type ProfilerMode = 'native' | 'currentOp' | 'loading'

const LEVEL_LABELS: Record<ProfilingLevel, string> = {
  0: 'Off',
  1: 'Slow Ops Only',
  2: 'All Operations'
}

const REFRESH_INTERVALS: Record<AutoRefresh, number | null> = {
  off: null,
  '5s': 5000,
  '10s': 10000,
  '30s': 30000
}

// Module-level cache for state persistence across tab switches
interface ProfilerCache {
  level: ProfilingLevel
  slowms: number
  autoRefresh: AutoRefresh
  entries: ProfilerEntry[]
  selectedEntry: ProfilerEntry | null
  mode: ProfilerMode
  status: { was: number; slowms: number } | null
}
const stateCache = new Map<string, ProfilerCache>()

export function QueryProfiler({ database }: QueryProfilerProps) {
  const effectiveTheme = useSettingsStore((s) => s.effectiveTheme)
  const openTab = useTabStore((s) => s.openTab)
  const tabs = useTabStore((s) => s.tabs)

  const cached = stateCache.get(database)

  const [level, setLevel] = useState<ProfilingLevel>(cached?.level ?? 0)
  const [slowms, setSlowms] = useState(cached?.slowms ?? 100)
  const [status, setStatus] = useState<{ was: number; slowms: number } | null>(cached?.status ?? null)
  const [applyLoading, setApplyLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState<AutoRefresh>(cached?.autoRefresh ?? 'off')
  const [mode, setMode] = useState<ProfilerMode>(cached?.mode ?? 'loading')

  const [entries, setEntries] = useState<ProfilerEntry[]>(cached?.entries ?? [])
  const [loading, setLoading] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<ProfilerEntry | null>(cached?.selectedEntry ?? null)
  const [clearLoading, setClearLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Save state to cache on every change
  useEffect(() => {
    stateCache.set(database, { level, slowms, autoRefresh, entries, selectedEntry, mode, status })
  }, [database, level, slowms, autoRefresh, entries, selectedEntry, mode, status])

  // Detect mode on mount
  useEffect(() => {
    if (cached?.mode && cached.mode !== 'loading') return
    trpc.profiler.getStatus.query({ database })
      .then((s) => {
        setStatus({ was: s.was, slowms: s.slowms })
        setMode(s.mode as ProfilerMode)
        if (s.mode === 'native') {
          setLevel(s.was as ProfilingLevel)
          setSlowms(s.slowms)
        } else {
          // currentOp mode — auto-refresh makes sense
          setAutoRefresh('5s')
        }
        setError(null)
      })
      .catch(() => {
        setMode('currentOp')
        setAutoRefresh('5s')
      })
  }, [database])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      if (mode === 'currentOp') {
        const data = await trpc.profiler.getCurrentOps.query({ database, limit: 100 })
        setEntries(data as ProfilerEntry[])
      } else if (mode === 'native') {
        const data = await trpc.profiler.getData.query({ database, limit: 100 })
        setEntries(data as ProfilerEntry[])
      }
    } catch (err) {
      const msg = (err as Error).message ?? String(err)
      if (msg.includes('not authorized') || msg.includes('not allowed'))
        setError('Insufficient permissions to read profiling data.')
      else if (!msg.includes('ns not found'))
        setError(`Failed to fetch data: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [database, mode])

  // Initial data fetch
  useEffect(() => {
    if (mode === 'loading') return
    if (!cached?.entries?.length) fetchData()
  }, [mode])

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    const ms = REFRESH_INTERVALS[autoRefresh]
    if (ms !== null && mode !== 'loading') {
      intervalRef.current = setInterval(fetchData, ms)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRefresh, fetchData, mode])

  const handleApply = async () => {
    if (mode !== 'native') return
    setApplyLoading(true)
    try {
      await trpc.profiler.setLevel.mutate({ database, level, slowms: level === 1 ? slowms : undefined })
      const s = await trpc.profiler.getStatus.query({ database })
      setStatus({ was: s.was, slowms: s.slowms })
      setError(null)
      if (level > 0 && autoRefresh === 'off') setAutoRefresh('5s')
    } catch (err) {
      const msg = (err as Error).message ?? String(err)
      setError(`Failed to set profiling level: ${msg}`)
    } finally {
      setApplyLoading(false)
    }
  }

  const handleStop = async () => {
    if (mode !== 'native') return
    setApplyLoading(true)
    try {
      await trpc.profiler.setLevel.mutate({ database, level: 0 })
      const s = await trpc.profiler.getStatus.query({ database })
      setStatus({ was: s.was, slowms: s.slowms })
      setLevel(0)
      setAutoRefresh('off')
      setError(null)
    } catch (err) {
      const msg = (err as Error).message ?? String(err)
      setError(`Failed to stop profiling: ${msg}`)
    } finally {
      setApplyLoading(false)
    }
  }

  const handleClear = async () => {
    if (mode === 'currentOp') {
      setEntries([])
      setSelectedEntry(null)
      return
    }
    setClearLoading(true)
    try {
      await trpc.profiler.clear.mutate({ database })
      setEntries([])
      setSelectedEntry(null)
    } catch (err) {
      console.error('Failed to clear profiling data:', err)
    } finally {
      setClearLoading(false)
    }
  }

  const handleCopyQuery = () => {
    if (!selectedEntry) return
    navigator.clipboard.writeText(JSON.stringify(selectedEntry.command, null, 2))
  }

  const handleOpenCollection = () => {
    if (!selectedEntry) return
    const parts = selectedEntry.ns.split('.')
    if (parts.length >= 2) {
      const connId = tabs.find((t) => t.database === database)?.connectionId
      const collectionName = parts.slice(1).join('.')
      if (connId) openTab(connId, database, collectionName)
    }
  }

  const activeSlowms = status?.slowms ?? slowms
  const isActive = mode === 'native' && (status?.was ?? 0) > 0

  const columnDefs = useMemo<ColDef<ProfilerEntry>[]>(() => [
    {
      headerName: 'Timestamp', field: 'ts', width: 180,
      valueFormatter: (p) => {
        if (!p.value) return ''
        try { return new Date(p.value as string).toLocaleTimeString() }
        catch { return p.value as string }
      }
    },
    { headerName: 'Op', field: 'op', width: 80 },
    { headerName: 'Namespace', field: 'ns', flex: 1, minWidth: 150 },
    {
      headerName: 'Duration (ms)', field: 'millis', width: 120, sort: 'desc',
      cellStyle: (params) => {
        const ms = params.value as number
        if (ms > activeSlowms && activeSlowms > 0) return { color: '#f87171' }
        if (ms > 50) return { color: '#fbbf24' }
        return { color: '#34d399' }
      }
    },
    {
      headerName: 'Plan Summary', field: 'planSummary', flex: 1, minWidth: 120,
      cellStyle: (params) => {
        const plan = String(params.value ?? '')
        if (plan.includes('COLLSCAN')) return { color: '#f87171' }
        if (!plan) return {}
        return { color: '#34d399' }
      }
    },
    { headerName: 'Docs Examined', field: 'docsExamined', width: 130 },
    { headerName: 'Keys Examined', field: 'keysExamined', width: 130 },
    { headerName: 'Returned', field: 'nreturned', width: 100 }
  ], [activeSlowms])

  const gridTheme = useMemo(() => {
    return themeAlpine.withParams({
      backgroundColor: effectiveTheme === 'dark' ? '#1a1a2e' : '#ffffff',
      foregroundColor: effectiveTheme === 'dark' ? '#e2e8f0' : '#1e293b',
      headerBackgroundColor: effectiveTheme === 'dark' ? '#16213e' : '#f8fafc',
      oddRowBackgroundColor: effectiveTheme === 'dark' ? '#1e2a3a' : '#f8fafc',
      rowHoverColor: effectiveTheme === 'dark' ? '#2d3748' : '#f1f5f9',
      borderColor: effectiveTheme === 'dark' ? '#2d3748' : '#e2e8f0',
      fontSize: 12
    })
  }, [effectiveTheme])

  const onRowClicked = (event: RowClickedEvent<ProfilerEntry>) => {
    setSelectedEntry(event.data ?? null)
  }

  return (
    <div className="flex h-full flex-col min-h-0">
      {/* Controls bar */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 flex-wrap">
        <Activity className="h-4 w-4 text-amber-400 shrink-0" />

        {mode === 'currentOp' ? (
          <>
            <span className="text-xs font-medium text-muted-foreground">Live Operations</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-blue-500/20 text-blue-400">
              currentOp mode
            </span>
          </>
        ) : (
          <>
            <span className="text-xs font-medium text-muted-foreground shrink-0">Profiling:</span>
            <select
              className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              value={level}
              onChange={(e) => setLevel(Number(e.target.value) as ProfilingLevel)}
            >
              <option value={0}>{LEVEL_LABELS[0]}</option>
              <option value={1}>{LEVEL_LABELS[1]}</option>
              <option value={2}>{LEVEL_LABELS[2]}</option>
            </select>

            {level === 1 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Threshold:</span>
                <input
                  type="number"
                  className="h-7 w-20 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  value={slowms}
                  min={0}
                  onChange={(e) => setSlowms(Number(e.target.value))}
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            )}

            <button
              className="flex h-7 items-center gap-1.5 rounded border border-input bg-background px-2 text-xs hover:bg-accent disabled:opacity-50"
              onClick={handleApply}
              disabled={applyLoading}
            >
              <Play className="h-3 w-3" />
              Apply
            </button>

            {isActive && (
              <button
                className="flex h-7 items-center gap-1.5 rounded border border-destructive/50 bg-background px-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                onClick={handleStop}
                disabled={applyLoading}
              >
                <Square className="h-3 w-3" />
                Stop
              </button>
            )}

            {status && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                status.was === 0
                  ? 'bg-muted text-muted-foreground'
                  : status.was === 1
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                Active: {LEVEL_LABELS[status.was as ProfilingLevel] ?? `Level ${status.was}`}
                {status.was === 1 && ` (>${status.slowms}ms)`}
              </span>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground shrink-0">Auto-refresh:</span>
          <select
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.value as AutoRefresh)}
          >
            <option value="off">Off</option>
            <option value="5s">5s</option>
            <option value="10s">10s</option>
            <option value="30s">30s</option>
          </select>

          <button
            className="flex h-7 items-center gap-1.5 rounded border border-input bg-background px-2 text-xs hover:bg-accent disabled:opacity-50"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            className="flex h-7 items-center gap-1.5 rounded border border-input bg-background px-2 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
            onClick={handleClear}
            disabled={clearLoading}
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <Activity className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button className="shrink-0 text-amber-400 hover:text-amber-200" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Grid */}
      <div className={`min-h-0 ${selectedEntry ? 'flex-[3]' : 'flex-1'}`}>
        <AgGridReact<ProfilerEntry>
          theme={gridTheme}
          rowData={entries}
          columnDefs={columnDefs}
          onRowClicked={onRowClicked}
          rowSelection="single"
          defaultColDef={{ resizable: true, sortable: true }}
          suppressCellFocus
        />
      </div>

      {/* Detail panel */}
      {selectedEntry && (
        <div className="flex-[2] min-h-0 border-t border-border flex flex-col bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-foreground">{selectedEntry.op}</span>
            <span className="text-xs text-muted-foreground">{selectedEntry.ns}</span>
            <span className={`text-xs font-medium ${
              selectedEntry.millis > activeSlowms && activeSlowms > 0 ? 'text-red-400'
                : selectedEntry.millis > 50 ? 'text-amber-400'
                : 'text-emerald-400'
            }`}>
              {selectedEntry.millis}ms
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                className="flex h-6 items-center gap-1 rounded border border-input bg-background px-2 text-xs hover:bg-accent"
                onClick={handleOpenCollection}
              >
                <ExternalLink className="h-3 w-3" />
                Open Collection
              </button>
              <button
                className="flex h-6 items-center gap-1 rounded border border-input bg-background px-2 text-xs hover:bg-accent"
                onClick={handleCopyQuery}
              >
                <Copy className="h-3 w-3" />
                Copy Query
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-3">
            <pre className="text-xs text-foreground font-mono whitespace-pre-wrap break-all">
              {JSON.stringify(selectedEntry.rawDoc, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
