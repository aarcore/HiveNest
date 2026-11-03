import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from './i18n'
import { ThemeProvider } from './theme'
import { SettingsProvider } from './settings/SettingsContext'
import { ToastProvider } from './components/Toast'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <SettingsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SettingsProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
