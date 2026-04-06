import { useState } from 'react'

/**
 * Manages spreadsheet page UI state (creation dialog, cell reference, etc.)
 */
export function useSpreadsheetPageState() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newSpreadsheetName, setNewSpreadsheetName] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [currentCellRef, setCurrentCellRef] = useState('A1')
  const [currentCellValue, setCurrentCellValue] = useState('')
  const [currentCellFormula, setCurrentCellFormula] = useState(null)

  return {
    createDialogOpen, setCreateDialogOpen,
    newSpreadsheetName, setNewSpreadsheetName,
    selectedConnectionId, setSelectedConnectionId,
    currentCellRef, setCurrentCellRef,
    currentCellValue, setCurrentCellValue,
    currentCellFormula, setCurrentCellFormula,
  }
}
