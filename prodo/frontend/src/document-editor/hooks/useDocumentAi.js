import { useState } from 'react'

const LANGUAGE_OPTIONS = [
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Italian', label: 'Italian' },
  { value: 'Portuguese', label: 'Portuguese' },
  { value: 'Chinese', label: 'Chinese (Simplified)' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Korean', label: 'Korean' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'Hindi', label: 'Hindi' },
]

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional', description: 'Formal and business-appropriate' },
  { value: 'casual', label: 'Casual', description: 'Friendly and conversational' },
  { value: 'formal', label: 'Formal', description: 'Very formal and official' },
  { value: 'simplified', label: 'Simplified', description: 'Easy to understand, plain language' },
  { value: 'persuasive', label: 'Persuasive', description: 'Compelling and convincing' },
  { value: 'empathetic', label: 'Empathetic', description: 'Warm and understanding' },
]

export function useDocumentAi() {
  const [aiMenuAnchor, setAiMenuAnchor] = useState(null)
  const [selectedText, setSelectedText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [translateDialogOpen, setTranslateDialogOpen] = useState(false)
  const [toneDialogOpen, setToneDialogOpen] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState('Spanish')
  const [selectedTone, setSelectedTone] = useState('professional')

  return {
    LANGUAGE_OPTIONS, TONE_OPTIONS,
    aiMenuAnchor, setAiMenuAnchor,
    selectedText, setSelectedText,
    aiLoading, setAiLoading,
    translateDialogOpen, setTranslateDialogOpen,
    toneDialogOpen, setToneDialogOpen,
    selectedLanguage, setSelectedLanguage,
    selectedTone, setSelectedTone,
  }
}
