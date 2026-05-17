import React from 'react'
import ReactDOM from 'react-dom/client'
import { ModuleRegistry, AllCommunityModule } from 'ag-grid-community'
import App from './App'
import './styles/globals.css'
import './store/settingsStore' // Initialize theme on load

// AG Grid 35+ no longer auto-registers Community modules — register once here
// so every <AgGridReact> in the app gets the full Community feature set.
ModuleRegistry.registerModules([AllCommunityModule])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
