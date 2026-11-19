export function Explanations() {
  return (
    <>
      <details className="data-info">
        <summary>Scoring & data</summary>
        <p>
          Each revealed pick contributes its role-specific normalized matchup or
          synergy delta. Effects are adjusted by games ÷ (games + 1,000),
          multiplied by your Settings role weights, then added. Unknown slots
          contribute nothing. Candidates with missing active pair data are left
          unranked. A 0× role weight ignores that slot. “Include base WR” adds
          the candidate's overall win rate above 50%.
        </p>
        <p>
          Team draft edge adds each unique allied synergy pair once and every
          ally-versus-enemy matchup. It includes the selected preview or your
          locked pick, plus each ally?s base strength when enabled. Synergy
          pairs use the average of their two role weights. Missing active data
          leaves the team total unavailable.
        </p>
        <p>
          This score ranks draft fit. Adding pair effects has not been validated
          as a prediction of game win probability. Pair samples overlap, and the
          fixed sample adjustment is a conservative setting rather than a fitted
          model.
        </p>
        <p>
          Blindability ranks counterpick safety from 0 to 100 within your role.
          Negative enemy matchup deltas are adjusted by sample size, multiplied
          by opponent pick-rate share within each role, then added across five
          enemy roles. Rare picks count less. Base win rate, positive bonuses,
          and teammate synergy do not affect this score. It is independent of
          draft edge. Hover its number for matchup and synergy graphs. The
          graphs show observed deltas and a noise-corrected spread, which is
          separate from the score.
        </p>
        <p id="data-details">
          Draft stats come from a saved, non-live snapshot.
        </p>
      </details>
      <footer>
        <div className="footer-meta">
          <span>DraftEdge</span>
          <span>
            Champion art © Riot Games ·{' '}
            <a href="mailto:contact@draftedge.website">Contact</a> ·{' '}
            <a href="privacy.html">Privacy</a>
          </span>
        </div>
        <p className="riot-legal">
          DraftEdge isn't endorsed by Riot Games and doesn't reflect the views
          or opinions of Riot Games or anyone officially involved in producing
          or managing Riot Games properties. Riot Games, and all associated
          properties are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </footer>
    </>
  );
}

export function MetricHelp() {
  return (
    <>
      <div id="ranking-metrics-help" popover="auto">
        <dl>
          <dt>Blindability</dt>
          <dd id="metric-blindability">
            How safe a champion is to pick before you know the enemy team.
            Higher means less risk from common counters.
          </dd>
          <dt>Sample Δ</dt>
          <dd id="metric-sample">
            How much Draft Edge could shift because the matchup stats are based
            on a limited number of games.
          </dd>
          <dt>Draft Edge</dt>
          <dd id="metric-score">
            How well a champion fits the picks on the board, based on synergy
            with allies and matchups against enemies.
          </dd>
        </dl>
      </div>
    </>
  );
}

export function CounterMethod() {
  return (
    <>
      <div
        id="remaining-counter-method"
        className="remaining-counter-method"
        popover="auto"
      >
        <p>
          We rank available picks by how common they are in their role, giving
          extra weight to tougher matchups.
        </p>
        <p>
          Cards show sample-adjusted effects. Minimum 5,000 matchup games and
          0.5% role pick share.
        </p>
      </div>
    </>
  );
}
