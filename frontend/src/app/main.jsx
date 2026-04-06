import * as Sentry from '@sentry/react'
import { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installGlobalFrontendErrorHandlers } from '@/api/monitoring'

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  release: import.meta.env.VITE_APP_VERSION,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  tracePropagationTargets: [/^\//],
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    /Loading chunk \d+ failed/,
  ],
  beforeSend(event) {
    if (event.request?.url) {
      event.request.url = event.request.url.replace(/token=[^&]+/, 'token=REDACTED')
    }
    return event
  },
})

// React 19 compatibility shim for react-dom/test-utils
export { act }
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

// App bootstrap

installGlobalFrontendErrorHandlers()

createRoot(document.getElementById('root'), {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
