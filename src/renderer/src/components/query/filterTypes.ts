// Shared filter-builder types. Extracted from QueryBuilder so the tab store can
// hold a per-tab snapshot of the builder UI (FilterBuilderState) and restore the
// exact visual rows when a tab is revisited — rather than reconstructing JSON.

export type FieldType = 'String' | 'Number' | 'Boolean' | 'Date' | 'ObjectId' | 'Auto'
export type MatchMode = '$and' | '$or'

export interface FilterRow {
  id: string
  field: string
  operator: string
  value: string
  type: FieldType
}

// A full snapshot of the QueryBuilder's filter UI for one tab. Persisted so that
// switching away and back restores the visual rows / raw-JSON view intact.
export interface FilterBuilderState {
  rows: FilterRow[]
  matchMode: MatchMode
  rawMode: boolean
  rawJson: string
  expanded: boolean
}
