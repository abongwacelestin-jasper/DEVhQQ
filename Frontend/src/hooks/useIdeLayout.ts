import { useCallback, useState } from 'react';
import { useResizable } from './useResizable';
import type { IdeSettings, IdeView, PanelTab } from '../types/ide';

const KEY = 'devhq.ide.settings';
const defaults: IdeSettings = {
  theme: 'dark',
  fontSize: 13,
  wordWrap: false,
  minimap: true,
  formatOnSave: true,
};

function readSettings(): IdeSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<IdeSettings>;
    return {
      theme: v.theme === 'light' ? 'light' : 'dark',
      fontSize:
        typeof v.fontSize === 'number' && v.fontSize >= 10 && v.fontSize <= 22
          ? v.fontSize
          : defaults.fontSize,
      wordWrap: typeof v.wordWrap === 'boolean' ? v.wordWrap : defaults.wordWrap,
      minimap: typeof v.minimap === 'boolean' ? v.minimap : defaults.minimap,
      formatOnSave: typeof v.formatOnSave === 'boolean' ? v.formatOnSave : defaults.formatOnSave,
    };
  } catch {
    return defaults;
  }
}

/** Workbench layout: which views/panels are open, their sizes, quick-open state and persisted editor settings. */
export function useIdeLayout() {
  const wide = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const [view, setView] = useState<IdeView>('explorer');
  const [sideOpen, setSideOpen] = useState(wide >= 768);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelMax, setPanelMax] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('terminal');
  const [chatOpen, setChatOpen] = useState(wide >= 1280);
  const [quick, setQuick] = useState<string | null>(null);
  const [settings, setSettings] = useState<IdeSettings>(readSettings);
  const side = useResizable({ axis: 'x', initial: 260, min: 180, max: 520 });
  const panel = useResizable({
    axis: 'y',
    initial: wide >= 768 ? 250 : 190,
    min: 110,
    max: 700,
    invert: true,
  });
  const chat = useResizable({ axis: 'x', initial: 360, min: 280, max: 600, invert: true });

  const setSetting = useCallback(<K extends keyof IdeSettings>(key: K, value: IdeSettings[K]) => {
    setSettings((s) => {
      const next = { ...s, [key]: value };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const selectView = (v: IdeView) => {
    if (v === view && sideOpen) setSideOpen(false);
    else {
      setView(v);
      setSideOpen(true);
    }
  };
  const showView = (v: IdeView) => {
    setView(v);
    setSideOpen(true);
  };
  const showPanel = (t: PanelTab) => {
    setPanelTab(t);
    setPanelOpen(true);
  };
  const togglePanelTab = (t: PanelTab) => {
    if (panelOpen && panelTab === t) setPanelOpen(false);
    else showPanel(t);
  };

  return {
    view,
    sideOpen,
    panelOpen,
    panelMax,
    panelTab,
    chatOpen,
    quick,
    settings,
    side,
    panel,
    chat,
    setSetting,
    selectView,
    showView,
    showPanel,
    togglePanelTab,
    setPanelTab,
    setSideOpen,
    toggleSide: () => setSideOpen((v) => !v),
    togglePanel: () => setPanelOpen((v) => !v),
    toggleMax: () => setPanelMax((v) => !v),
    closePanel: () => {
      setPanelOpen(false);
      setPanelMax(false);
    },
    toggleChat: () => setChatOpen((v) => !v),
    openQuick: (prefix: string) => setQuick(prefix),
    closeQuick: () => setQuick(null),
  };
}
