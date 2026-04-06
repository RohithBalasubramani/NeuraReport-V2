import { useCallback, useState } from 'react'

/**
 * Manages the connection form (create/edit) state.
 */
export function useConnectionFormState(connection) {
  const [formData, setFormData] = useState({
    name: connection?.name || '',
    db_type: connection?.db_type || 'sqlite',
    connection_url: connection?.connection_url || '',
    host: connection?.host || '',
    port: connection?.port || '',
    database: connection?.database || '',
    username: connection?.username || '',
    password: '',
  })
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [error, setError] = useState(null)
  const [touched, setTouched] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const handleChange = useCallback((field) => (event) => {
    setFormData((prev) => ({ ...prev, [field]: event.target.value }))
    setTouched((prev) => ({ ...prev, [field]: true }))
    setError(null)
  }, [])

  const handleBlur = useCallback((field) => () => {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }, [])

  return {
    formData, setFormData,
    showAdvanced, setShowAdvanced,
    error, setError,
    touched, setTouched,
    fieldErrors, setFieldErrors,
    testing, setTesting,
    testResult, setTestResult,
    handleChange, handleBlur,
  }
}
