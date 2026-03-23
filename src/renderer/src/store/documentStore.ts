import { create } from 'zustand'

interface DocumentStore {
  selectedDocument: Record<string, unknown> | null
  editorContent: string
  isDirty: boolean

  selectDocument: (doc: Record<string, unknown> | null) => void
  setEditorContent: (content: string) => void
  clearSelection: () => void
}

export const useDocumentStore = create<DocumentStore>((set) => ({
  selectedDocument: null,
  editorContent: '',
  isDirty: false,

  selectDocument: (doc) => {
    set({
      selectedDocument: doc,
      editorContent: doc ? JSON.stringify(doc, null, 2) : '',
      isDirty: false
    })
  },

  setEditorContent: (content) => {
    set({ editorContent: content, isDirty: true })
  },

  clearSelection: () => {
    set({ selectedDocument: null, editorContent: '', isDirty: false })
  }
}))
