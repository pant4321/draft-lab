import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { prepareCompanionSession } from './services/companion-session';
import { startAnalytics } from './services/analytics';
import { createCompanionClient } from './services/companion';
import type { CompanionConnector } from './services/companion';
import './draft.css';
import './champion-build.css';

const root = document.getElementById('root');
if (!root) throw Error('The DraftEdge application root is missing.');
const session = prepareCompanionSession();
startAnalytics();
const connect: CompanionConnector | null = session
  ? (onChange) => createCompanionClient(session, onChange)
  : null;
createRoot(root).render(<StrictMode><App connect={connect} /></StrictMode>);
