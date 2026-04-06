import * as api from '@/api/client'
import { useToast } from '@/components/core'
import { useCallback, useEffect, useState } from 'react'

/**
 * Manages SMTP settings state and save/test operations.
 */
export function useSmtpSettings() {
  const toast = useToast()
  const [smtp, setSmtp] = useState({
    host: '', port: 587, username: '', password: '', sender: '', use_tls: true,
  })
  const [smtpLoading, setSmtpLoading] = useState(false)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [showSmtpPassword, setShowSmtpPassword] = useState(false)

  const loadSmtpSettings = useCallback(async () => {
    try {
      const data = await api.getSmtpSettings()
      if (data) setSmtp((prev) => ({ ...prev, ...data }))
    } catch { /* silent */ }
  }, [])

  const handleSmtpSave = useCallback(async () => {
    setSmtpLoading(true)
    try {
      const result = await api.saveSmtpSettings(smtp)
      toast.show(result?.message || 'SMTP settings saved', 'success')
    } catch (err) {
      toast.show(err?.message || 'Failed to save SMTP settings', 'error')
    } finally {
      setSmtpLoading(false)
    }
  }, [smtp, toast])

  const handleSmtpTest = useCallback(async () => {
    setSmtpTesting(true)
    try {
      const result = await api.testSmtpConnection()
      toast.show(result?.message || 'SMTP test successful', 'success')
    } catch (err) {
      toast.show(err?.message || 'SMTP test failed', 'error')
    } finally {
      setSmtpTesting(false)
    }
  }, [toast])

  const handleSmtpChange = useCallback((field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setSmtp((prev) => ({ ...prev, [field]: value }))
  }, [])

  useEffect(() => { loadSmtpSettings() }, [loadSmtpSettings])

  return {
    smtp, setSmtp,
    smtpLoading, smtpTesting,
    showSmtpPassword, setShowSmtpPassword,
    handleSmtpSave, handleSmtpTest, handleSmtpChange,
  }
}
