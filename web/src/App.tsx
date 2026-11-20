import { useEffect, useRef, useState } from 'react';
import { Breakdown } from './components/Breakdown';
import { FloatingSlot, TeamBoard, useBoardDrag } from './components/DraftBoard';
import type { PickerTarget } from './components/DraftBoard';
import {
  ChampionPicker,
  PoolPicker,
  SettingsDialog,
} from './components/DraftDialogs';
import { Bans, TeamEdge } from './components/DraftTotals';
import { Recommendations } from './components/Recommendations';
import { useSpread } from './components/Spread';
import { Explanations } from './components/StaticContent';
import { CompanionDialog, Controls, Header } from './components/Toolbar';
import type { CompanionDialogMode } from './components/Toolbar';
import type { Role } from './domain/types';
import { createCompanionClient } from './services/companion';
import type { CompanionConnector } from './services/companion';
import { reconnectCompanion, rememberCompanionSession } from './services/companion-session';
import type { CompanionSessionFields } from './services/companion-session';
import { useDraftLab } from './useDraftLab';

function pairedConnector(value: CompanionSessionFields): CompanionConnector {
  const session = rememberCompanionSession(value);
  return (onChange) => createCompanionClient(session, onChange);
}

export function App({ connect }: { connect: CompanionConnector | null }) {
  const [pairedConnect, setPairedConnect] = useState<CompanionConnector | null>(
    null,
  );
  const lab = useDraftLab(pairedConnect ?? connect, pairedConnect !== null);
  const { state, selected, manual, blind } = lab;
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState<{
    target: PickerTarget | null;
    openings: number;
  }>({ target: null, openings: 0 });
  const [pool, setPool] = useState<{ role: Role | null; openings: number }>({
    role: null,
    openings: 0,
  });
  const [settings, setSettings] = useState(false);
  const [companionDialog, setCompanionDialog] =
    useState<CompanionDialogMode | null>(null);
  const reconnectAttempt = useRef<AbortController | null>(null);
  const spread = useSpread(blind, state.roster, state.draft.role);
  const drag = useBoardDrag(lab, spread.hide);

  useEffect(() => {
    if (connect || pairedConnect) return;
    const attempt = new AbortController();
    reconnectAttempt.current = attempt;
    void reconnectCompanion(attempt.signal).then((value) => {
      if (value && !attempt.signal.aborted) {
        const connector = pairedConnector(value);
        setPairedConnect(() => connector);
      }
    });
    return () => {
      attempt.abort();
      reconnectAttempt.current = null;
    };
  }, [connect, pairedConnect]);

  function openCompanionDialog(mode: CompanionDialogMode) {
    reconnectAttempt.current?.abort();
    spread.hide();
    setCompanionDialog(mode);
  }

  function openPicker(target: PickerTarget) {
    if (lab.pending || !lab.initialized) return;
    manual();
    spread.hide();
    setPicker((previous) => ({ target, openings: previous.openings + 1 }));
  }
  function changeRole(role: Role) {
    if (role === state.draft.role || lab.pending) return;
    spread.hide();
    setSearch('');
    manual({
      type: 'role',
      role,
      preview: state.clientOwnChampion ?? selected,
    });
  }

  return (
    <>
      <main>
        <Header
          lab={lab}
          onDownload={() => openCompanionDialog('open')}
        />
        <Controls
          lab={lab}
          hasCompanion={Boolean(pairedConnect ?? connect)}
          onCompanion={openCompanionDialog}
          settings={() => {
            spread.hide();
            setSettings(true);
          }}
          changeRole={changeRole}
          reset={() => {
            setSearch('');
            spread.hide();
            manual({ type: 'reset' });
          }}
        />
        <section className="draft-layout">
          <TeamBoard
            lab={lab}
            side="allies"
            openPicker={openPicker}
            drag={drag}
          />
          <Recommendations
            lab={lab}
            search={search}
            setSearch={setSearch}
            spread={spread}
            openPool={() => {
              spread.hide();
              setPool((previous) => ({
                role: state.draft.role,
                openings: previous.openings + 1,
              }));
            }}
          />
          <TeamBoard
            lab={lab}
            side="enemies"
            openPicker={openPicker}
            drag={drag}
          />
        </section>
        <Bans lab={lab} add={() => openPicker({ ban: true })} />
        <Breakdown lab={lab} spread={spread} />
        <TeamEdge lab={lab} />
        <div id="status" className="status" role="status">
          {lab.datasetError || lab.profileError || state.notice}
        </div>
        <Explanations />
      </main>
      <CompanionDialog
        mode={companionDialog}
        close={() => setCompanionDialog(null)}
        retryConnection={
          lab.companionState.control === 'Offline'
            ? () => lab.companion.current?.open()
            : undefined
        }
        onPaired={(value) => {
          lab.companion.current?.dispose();
          const connector = pairedConnector(value);
          setPairedConnect(() => connector);
          setCompanionDialog(null);
        }}
      />
      <SettingsDialog
        lab={lab}
        open={settings}
        close={() => setSettings(false)}
      />
      <ChampionPicker
        key={'champion-' + picker.openings}
        lab={lab}
        target={picker.target}
        close={() => setPicker((previous) => ({ ...previous, target: null }))}
      />
      <PoolPicker
        key={'pool-' + pool.openings}
        lab={lab}
        role={pool.role}
        close={() => setPool((previous) => ({ ...previous, role: null }))}
      />
      {spread.popup}
      <FloatingSlot preview={drag.preview} roster={state.roster} />
    </>
  );
}
