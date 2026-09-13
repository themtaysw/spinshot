import React, { useCallback, useMemo, useState } from 'react'
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react'
import Viewport from './Viewport.jsx'
import Timeline from './Timeline.jsx'
import Panel, { PANEL_TITLES } from './Panel.jsx'
import ProjectPanel from './ProjectPanel.jsx'

// After-Effects-style dockable workspace: every editor surface is a tab that
// can be dragged into any split, tabbed with others, resized or closed.
export const PANELS = {
  viewer: 'Composition',
  timeline: 'Timeline',
  project: 'Project',
  ...PANEL_TITLES,
}

const STORAGE = 'spinshot.workspace.v1'

const tab = (id, extra = {}) => ({ type: 'tab', id: `tab-${id}`, name: PANELS[id], component: id, ...extra })

export const DEFAULT_LAYOUT = {
  global: {
    tabEnableClose: true,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetMinWidth: 160,
    tabSetMinHeight: 90,
    splitterSize: 5,
    splitterExtra: 4,
    tabSetTabStripHeight: 30,
    borderEnableAutoHide: true,
  },
  borders: [],
  layout: {
    type: 'row',
    children: [
      {
        type: 'row',
        weight: 76,
        children: [
          {
            type: 'row',
            weight: 66,
            children: [
              { type: 'tabset', weight: 22, children: [tab('project')] },
              { type: 'tabset', weight: 78, children: [tab('viewer', { enableClose: false })] },
            ],
          },
          { type: 'tabset', weight: 34, children: [tab('timeline', { enableClose: false })] },
        ],
      },
      {
        type: 'row',
        weight: 24,
        children: [
          { type: 'tabset', weight: 45, children: [tab('properties'), tab('ai')] },
          {
            type: 'tabset',
            weight: 55,
            children: [tab('device'), tab('camera'), tab('background'), tab('light'), tab('screen'), tab('music'), tab('export'), tab('exportvideo')],
          },
        ],
      },
    ],
  },
}

function loadModel() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null')
    if (saved) return Model.fromJson(saved)
  } catch {
    /* fall through */
  }
  return Model.fromJson(DEFAULT_LAYOUT)
}

// the workspace controller: lets the top bar open/focus panels and reset
export const workspace = { model: null, setModel: null }

export function openPanel(id) {
  const model = workspace.model
  if (!model) return
  let existing = null
  model.visitNodes((n) => {
    if (n.getType() === 'tab' && n.getComponent?.() === id) existing = n
  })
  if (existing) {
    model.doAction(Actions.selectTab(existing.getId()))
    return
  }
  const target = model.getActiveTabset() || model.getFirstTabSet()
  model.doAction(Actions.addNode({ type: 'tab', id: `tab-${id}-${Date.now().toString(36)}`, name: PANELS[id], component: id }, target.getId(), DockLocation.CENTER, -1, true))
}

export function resetWorkspace() {
  localStorage.removeItem(STORAGE)
  workspace.setModel?.(Model.fromJson(DEFAULT_LAYOUT))
}

export function openPanels() {
  const set = new Set()
  workspace.model?.visitNodes((n) => {
    if (n.getType() === 'tab') set.add(n.getComponent?.())
  })
  return set
}

export default function Workspace() {
  const [model, setModel] = useState(loadModel)
  workspace.model = model
  workspace.setModel = setModel

  const factory = useCallback((node) => {
    const c = node.getComponent()
    if (c === 'viewer') return <div className="dock-fill"><Viewport /></div>
    if (c === 'timeline') return <div className="dock-fill"><Timeline /></div>
    if (c === 'project') return <ProjectPanel />
    return <Panel only={c} />
  }, [])

  const onModelChange = useCallback((m) => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(m.toJson()))
    } catch {
      /* ignore */
    }
  }, [])

  const key = useMemo(() => Math.random(), [model])
  return (
    <div className="workspace">
      <Layout key={key} model={model} factory={factory} onModelChange={onModelChange} realtimeResize />
    </div>
  )
}
