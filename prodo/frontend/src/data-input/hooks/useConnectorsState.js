import { useState } from 'react'

/**
 * Manages connectors page state.
 */
export function useConnectorsState() {
  const [activeTab, setActiveTab] = useState(0)
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const [selectedConnector, setSelectedConnector] = useState(null)
  const [connectionName, setConnectionName] = useState('')
  const [connectionConfig, setConnectionConfig] = useState({})
  const [queryDialogOpen, setQueryDialogOpen] = useState(false)
  const [queryText, setQueryText] = useState('')
  const [schemaDialogOpen, setSchemaDialogOpen] = useState(false)

  return {
    activeTab, setActiveTab,
    connectDialogOpen, setConnectDialogOpen,
    selectedConnector, setSelectedConnector,
    connectionName, setConnectionName,
    connectionConfig, setConnectionConfig,
    queryDialogOpen, setQueryDialogOpen,
    queryText, setQueryText,
    schemaDialogOpen, setSchemaDialogOpen,
  }
}
