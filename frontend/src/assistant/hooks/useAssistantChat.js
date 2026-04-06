import { useState } from 'react'

/**
 * Manages assistant panel chat state.
 */
export function useAssistantChat() {
  const [inputValue, setInputValue] = useState('')

  return { inputValue, setInputValue }
}
