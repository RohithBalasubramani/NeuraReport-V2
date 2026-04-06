import { useState } from 'react'

/**
 * Manages schedule create/edit dialog state.
 */
export function useScheduleDialogState() {
  const [form, setForm] = useState({
    template_id: '',
    connection_id: '',
    frequency: 'daily',
    cron_expression: '',
    active: true,
    email_recipients: '',
    start_date: '',
    end_date: '',
    key_values: '',
    batch_ids: '',
    output_docx: false,
    output_xlsx: false,
  })
  const [saving, setSaving] = useState(false)

  return { form, setForm, saving, setSaving }
}
