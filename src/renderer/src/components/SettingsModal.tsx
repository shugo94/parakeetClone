import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import type { Config } from '../types'

const ANTHROPIC_MODELS = [
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-haiku-20240307'
]

const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']

// Free tier models
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-4-scout-17b-16e-instruct',
  'llama-4-maverick-17b-128e-instruct',
  'llama-3.1-8b-instant',
  'llama-3.2-11b-vision-preview',
  'llama-3.2-3b-preview',
  'deepseek-r1-distill-llama-70b',
  'qwen-qwq-32b',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'compound-beta'
]

const GEMINI_MODELS = [
  'gemini-2.5-flash-preview-05-20',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b'
]

// OpenRouter free models (all have :free suffix — no cost, no card needed)
const OPENROUTER_MODELS = [
  'deepseek/deepseek-chat-v3-0324:free',
  'deepseek/deepseek-r1-0528:free',
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'google/gemma-3-27b-it:free',
  'google/gemma-3-12b-it:free',
  'mistralai/mistral-7b-instruct:free',
  'qwen/qwen3-8b:free',
  'qwen/qwen3-14b:free',
  'qwen/qwen3-30b-a3b:free',
  'microsoft/phi-3-mini-128k-instruct:free',
  'microsoft/phi-3-medium-128k-instruct:free',
  'nvidia/llama-3.1-nemotron-70b-instruct:free'
]

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ANTHROPIC_MODELS,
  openai: OPENAI_MODELS,
  groq: GROQ_MODELS,
  gemini: GEMINI_MODELS,
  openrouter: OPENROUTER_MODELS
}

const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  anthropic: ANTHROPIC_MODELS[0],
  openai: OPENAI_MODELS[0],
  groq: GROQ_MODELS[0],
  gemini: GEMINI_MODELS[0],
  openrouter: OPENROUTER_MODELS[0]
}

const PROVIDER_KEY_HINT: Record<string, string> = {
  anthropic: 'console.anthropic.com',
  openai: 'platform.openai.com',
  groq: 'console.groq.com — FREE tier',
  gemini: 'aistudio.google.com — FREE tier',
  openrouter: 'openrouter.ai — FREE models (no card needed)'
}

export function SettingsModal() {
  const { config, setConfig, setShowSettings, contentProtection } = useAppStore()
  const [form, setForm] = useState<Config>({
    apiKey: '',
    provider: 'groq',
    model: GROQ_MODELS[0],
    contentProtection: true
  })
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (config) setForm(config)
  }, [config])

  const models = PROVIDER_MODELS[form.provider] ?? []

  const handleProviderChange = (provider: Config['provider']) => {
    setForm({ ...form, provider, model: PROVIDER_DEFAULT_MODEL[provider] })
  }

  const handleSave = async () => {
    const updated = { ...form, contentProtection }
    await window.api.saveConfig(updated as unknown as Record<string, unknown>)
    setConfig(updated)
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      setShowSettings(false)
    }, 900)
  }

  return (
    <div className="settings-backdrop" onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}>
      <div className="settings-modal" role="dialog" aria-label="Settings">
        {/* Header */}
        <div className="sm-header">
          <span>⚙ Settings</span>
          <button className="sm-close" onClick={() => setShowSettings(false)}>✕</button>
        </div>

        {/* Body */}
        <div className="sm-body">
          {/* Provider */}
          <div className="sm-field">
            <label className="sm-label">AI Provider</label>
            <div className="sm-radio-group">
              {(
                [
                  { id: 'groq', label: '🆓 Groq (Free)' },
                  { id: 'gemini', label: '🆓 Gemini (Free)' },
                  { id: 'openrouter', label: '🆓 OpenRouter (Free)' },
                  { id: 'anthropic', label: '🔷 Claude (Anthropic)' },
                  { id: 'openai', label: '🟢 OpenAI GPT' }
                ] as { id: Config['provider']; label: string }[]
              ).map(({ id, label }) => (
                <label key={id} className={`sm-radio${form.provider === id ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="provider"
                    checked={form.provider === id}
                    onChange={() => handleProviderChange(id)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Model */}
          <div className="sm-field">
            <label className="sm-label">Model</label>
            <select
              className="sm-select"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* API Key */}
          <div className="sm-field">
            <label className="sm-label">
              API Key
              <span className="sm-hint"> — {PROVIDER_KEY_HINT[form.provider]}</span>
            </label>
            <div className="sm-input-row">
              <input
                type={showKey ? 'text' : 'password'}
                className="sm-input"
                placeholder="paste your api key..."
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="sm-eye"
                type="button"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide' : 'Show'}
              >
                {showKey ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {/* Content protection note */}
          <div className="sm-info">
            🛡 Screen protection is toggled via the shield icon in the main overlay.
            When ON, this window appears black in Zoom, Meet, Teams, OBS.
          </div>
        </div>

        {/* Footer */}
        <div className="sm-footer">
          <button
            className={`sm-save${saved ? ' saved' : ''}`}
            onClick={handleSave}
            disabled={saved}
          >
            {saved ? '✓ Saved!' : 'Save & Close'}
          </button>
        </div>
      </div>
    </div>
  )
}
