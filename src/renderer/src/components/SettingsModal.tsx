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

export function SettingsModal() {
  const { config, setConfig, setShowSettings, contentProtection } = useAppStore()
  const [form, setForm] = useState<Config>({
    apiKey: '',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    contentProtection: true
  })
  const [saved, setSaved] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (config) setForm(config)
  }, [config])

  const models = form.provider === 'anthropic' ? ANTHROPIC_MODELS : OPENAI_MODELS

  // When provider changes, reset model
  const handleProviderChange = (provider: 'anthropic' | 'openai') => {
    setForm({
      ...form,
      provider,
      model: provider === 'anthropic' ? ANTHROPIC_MODELS[0] : OPENAI_MODELS[0]
    })
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
              {(['anthropic', 'openai'] as const).map((p) => (
                <label key={p} className={`sm-radio${form.provider === p ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name="provider"
                    checked={form.provider === p}
                    onChange={() => handleProviderChange(p)}
                  />
                  {p === 'anthropic' ? '🔷 Claude (Anthropic)' : '🟢 OpenAI GPT'}
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
              <span className="sm-hint">
                {form.provider === 'anthropic'
                  ? ' — console.anthropic.com'
                  : ' — platform.openai.com'}
              </span>
            </label>
            <div className="sm-input-row">
              <input
                type={showKey ? 'text' : 'password'}
                className="sm-input"
                placeholder={`sk-${form.provider === 'anthropic' ? 'ant-' : ''}...`}
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
