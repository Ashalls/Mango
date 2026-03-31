# Connection Safety Toggles & Truncate Collection

**Date:** 2026-03-31

## Overview

Add two new connection-level safety toggles ("Protect from Drop & Truncate" and "Read Only") to the Edit Connection dialog, and add a "Truncate Collection" action to the collection context menu. Both Drop and Truncate get type-to-confirm safety dialogs.

## New Connection Settings

Two new boolean fields on `ConnectionProfile`:

- **`protectDropTruncate`** — When `true`, hides Drop Collection and Truncate Collection from the collection context menu. Default: `false`.
- **`isReadOnly`** — When `true`, greys out all manual write operations across the UI and forces Claude AI Access to "Read Only". Default: `false`.

### Toggle Behavior

All three safety toggles (Production, Protect from Drop & Truncate, Read Only) are **fully independent**. They can be combined in any way the user wants.

### Defaults

- **New connections:** Both toggles OFF (full access, no restrictions).
- **Existing connections (migration):** Both toggles default to `false`, preserving current behavior.

## Edit Connection Dialog Changes

Both new toggles appear as flat toggle cards at the same visual level as the existing Production toggle. Order from top to bottom:

1. Production (existing)
2. Protect from Drop & Truncate (new)
3. Read Only (new)
4. Claude AI Access (existing)

### Toggle Styling

Each toggle is a bordered card with an icon, title, subtitle, and toggle switch — matching the existing Production toggle style.

- **Protect from Drop & Truncate:** Amber/orange accent color. Subtitle: "Hide drop and truncate options from collection context menu".
- **Read Only:** Blue accent color. Subtitle: "Prevent all manual write operations on this connection".

### Read Only and Claude AI Access Interaction

When Read Only is toggled ON, Claude AI Access is forced to "Read Only" (same pattern as Production toggle forcing Claude to readonly). The Claude Access buttons should reflect this — the "Read & Write" button becomes unclickable while Read Only is active.

## Truncate Collection

### Context Menu

A new "Truncate Collection" item appears in the collection right-click context menu, positioned next to "Drop Collection". Both are hidden when `protectDropTruncate` is `true`.

### Confirmation Dialog

Truncate Collection uses a **type-the-collection-name** confirmation dialog. The user must type the exact collection name to confirm. This prevents accidental truncation.

### Drop Collection Confirmation Upgrade

Drop Collection currently has a simple confirmation. It gets upgraded to the same **type-the-collection-name** pattern for consistency.

### MongoDB Operation

Truncate is implemented as `deleteMany({})` on the collection, which removes all documents but preserves the collection, its indexes, and its metadata.

## Read Only Enforcement

### UI Enforcement

When `isReadOnly` is `true` on a connection, the following context menu items are **visible but greyed out** (disabled, not hidden):

- Insert Documents
- Import JSON
- Rename Collection
- Drop Collection
- Truncate Collection
- Drop Database

**Precedence note:** If both `protectDropTruncate` and `isReadOnly` are true, Drop/Truncate are **hidden** (protectDropTruncate takes precedence — hiding is stricter than greying out).

Inline cell editing in the data grid is also disabled.

A tooltip or visual indicator should communicate that the connection is read-only.

### Backend Enforcement

Write operations on the main process side should check `isReadOnly` and reject with an error message (e.g., "This connection is read-only. Disable Read Only in connection settings to allow writes.").

Operations to enforce:
- Insert documents
- Update documents (cell edits)
- Delete documents
- Drop collection
- Truncate collection (deleteMany)
- Rename collection
- Drop database
- Import JSON/CSV
- Database copy/paste (target)

### Claude AI Enforcement

When `isReadOnly` is `true`, Claude AI Access is forced to `'readonly'`. The `checkWriteAccess` function in `src/main/mcp/tools.ts` should also check the `isReadOnly` flag.

## Affected Files

| Area | File |
|------|------|
| Connection type definition | `src/shared/types.ts` |
| Edit Connection dialog UI | `src/renderer/src/components/explorer/ConnectionDialog.tsx` |
| Collection context menu | `src/renderer/src/components/explorer/DatabaseTree.tsx` |
| Connection save logic | `src/main/actions/connection.ts` |
| Connection store | `src/renderer/src/store/connectionStore.ts` |
| MCP write access check | `src/main/mcp/tools.ts` |
| Import protection | `src/main/actions/exportImport.ts` |
| Copy/paste protection | `src/main/actions/migration.ts` |
| Claude system prompt | `src/main/services/claude.ts` |
| Sidebar (paste protection) | `src/renderer/src/components/layout/Sidebar.tsx` |
