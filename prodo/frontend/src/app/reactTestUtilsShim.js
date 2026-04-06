import { act } from 'react'
export { act }

// Simulate object stub for compatibility (deprecated in React 19)
export const Simulate = new Proxy(
  {},
  {
    get: (target, prop) => {
      return (element, eventData) => {
        const eventName = prop.toLowerCase()
        const event = new Event(eventName, { bubbles: true, cancelable: true })
        Object.assign(event, eventData)
        element.dispatchEvent(event)
      }
    },
  }
)

// Default export for CommonJS compatibility
export default { act, Simulate }
