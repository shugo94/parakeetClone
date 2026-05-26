import React from 'react'
import { useAppStore } from '../store/appStore'

interface SubMode {
  id: string
  label: string
}

interface ModeConfig {
  id: string
  emoji: string
  label: string
  defaultSub?: string   // auto-selected sub-mode when parent is clicked
  subModes?: SubMode[]
}

const MODES: ModeConfig[] = [
  { id: 'dsa',  emoji: '🧠', label: 'DSA' },
  { id: 'java', emoji: '☕', label: 'Java' },
  {
    id: 'design', emoji: '🏗', label: 'Design', defaultSub: 'design-app',
    subModes: [
      { id: 'design-app',          label: 'Application'   },
      { id: 'design-selenium',     label: 'Selenium FW'   },
      { id: 'design-restassured',  label: 'RestAssured FW'},
      { id: 'design-appium',       label: 'Appium FW'     },
    ]
  },
  {
    id: 'qa', emoji: '🔬', label: 'QA', defaultSub: 'qa-selenium',
    subModes: [
      { id: 'qa-selenium',     label: 'Selenium'    },
      { id: 'qa-restassured',  label: 'RestAssured' },
      { id: 'qa-appium2',      label: 'Appium 2'    },
      { id: 'qa-appium1',      label: 'Appium 1'    },
    ]
  },
  { id: 'hr', emoji: '💼', label: 'HR' },
]

export function ModeBar() {
  const { interviewMode, setInterviewMode } = useAppStore()

  // Determine active parent category from the current mode
  const activeParent = MODES.find((m) =>
    interviewMode === m.id || m.subModes?.some((s) => s.id === interviewMode)
  )

  const activeSubModes = activeParent?.subModes ?? []

  const handleMainClick = (mode: ModeConfig) => {
    if (mode.subModes) {
      // Click on parent with sub-modes → jump straight to default sub
      setInterviewMode(mode.defaultSub ?? mode.subModes[0].id)
    } else {
      setInterviewMode(mode.id)
    }
  }

  return (
    <div className="mode-bar-wrapper">
      {/* Main mode row */}
      <div className="mode-bar">
        {MODES.map((m) => {
          const isActive = activeParent?.id === m.id
          return (
            <button
              key={m.id}
              className={`mode-btn${isActive ? ' mode-active' : ''}`}
              onClick={() => handleMainClick(m)}
            >
              <span className="mode-emoji">{m.emoji}</span>
              <span className="mode-label">{m.label}</span>
            </button>
          )
        })}
      </div>

      {/* Sub-mode row — only visible when active parent has sub-modes */}
      {activeSubModes.length > 0 && (
        <div className="sub-mode-bar">
          {activeSubModes.map((s) => (
            <button
              key={s.id}
              className={`sub-mode-btn${interviewMode === s.id ? ' sub-active' : ''}`}
              onClick={() => setInterviewMode(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
