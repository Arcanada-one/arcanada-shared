// SPDX-License-Identifier: MIT
// Exercise the real decoder/reducer/projectors using existing observation fixtures.
import { describe, expect, it } from 'vitest';
import { createReducerState, reduce, projectGraphPresentation, projectView } from './knowledge-observation.api.js';
import { caseMeta, records } from './knowledge-observation.harness.js';
import { createObservationInspectorMount } from '../browser/observation-inspector.js';
import { inspectorDocument } from './helpers/observation-inspector-dom.js';

const mount = createObservationInspectorMount({ projectGraph: projectGraphPresentation, projectView });
function stateFor(ids, change) {
  let state = createReducerState({ mode: 'fixture' });
  state = reduce(state, { kind: 'bind_trusted_projection', viewContext: caseMeta.default_view_context }).state;
  for (const id of ids) {
    const record = structuredClone(records[id]);
    if (change) change(record);
    const result = reduce(state, { kind: 'receive', record });
    expect(result.commands).toEqual([]);
    expect(result.outcome.disposition).not.toBe('rejected');
    expect(result.outcome.disposition).not.toBe('quarantined');
    state = result.state;
  }
  return state;
}

describe('read-only browser inspection through the shared projectors', () => {
  it('retains cursor order and distinct producer, observation and storage times', () => {
    const state = stateFor(['snapshot-A', 'event-1', 'event-2'], record => {
      // Alter existing event clocks before decoding. No new fixture file or runtime evidence.
      if (record.record_id === 'event-1') {
        record.data.occurred_at = '2000-01-01T00:01:00Z';
        record.observed_at = '2000-01-01T00:00:30Z';
        record.recorded_at = '2000-01-01T00:02:00Z';
      }
    });
    const projected = projectView(state);
    expect(projected.eventLedger.map(e => e.recordId)).toEqual(['event-1', 'event-2']);
    const surface = inspectorDocument(projectGraphPresentation(state));
    const controller = mount({ ...surface, state });
    const buttons = surface.timelineRoot.querySelectorAll('[data-lab-inspect-kind]');
    expect(buttons.map(button => button.textContent)).toEqual(projected.eventLedger.map(event => event.cursor + ' · ' + event.eventId));
    buttons[0].click();
    const shown = surface.inspectorRoot.textContent;
    expect(shown).toContain('9007199254740993');
    expect(shown).toContain('2000-01-01T00:01:00Z');
    expect(shown).toContain('2000-01-01T00:00:30Z');
    expect(shown).toContain('2000-01-01T00:02:00Z');
    expect(surface.timelineRoot.textContent).toContain('not a claim of complete run history');
    controller.destroy();
  });

  for (const id of ['receipt-captured-1', 'artifact-denied', 'artifact-missing']) {
    it('does not turn ' + id + ' metadata into permission to open bytes', () => {
      const state = stateFor(['snapshot-A', id]);
      const surface = inspectorDocument(projectGraphPresentation(state));
      const controller = mount({ ...surface, state });
      expect(controller.select('artifact', id)).toBe(true);
      const projected = projectView(state).artifacts.find(artifact => artifact.recordId === id);
      expect(surface.inspectorRoot.textContent).toContain(projected.access);
      expect(surface.inspectorRoot.textContent).toContain(projected.availability);
      const disabled = surface.inspectorRoot.querySelector('[disabled]');
      expect(disabled).not.toBeNull();
      expect(disabled.getAttribute('aria-disabled')).toBe('true');
      expect(surface.inspectorRoot.querySelectorAll('[href]')).toHaveLength(0);
      expect(surface.inspectorRoot.textContent).not.toContain('fixture-artifact:receipt-captured-1');
      controller.destroy();
    });
  }

  it('revocation clears retained artifact and event details using the actual reducer transition', () => {
    const state = stateFor(['snapshot-A', 'event-1', 'receipt-captured-1']);
    const surface = inspectorDocument(projectGraphPresentation(state));
    const controller = mount({ ...surface, state });
    expect(controller.select('artifact', 'receipt-captured-1')).toBe(true);
    const revoked = reduce(state, { kind: 'trusted_authorization_revoked', viewContext: caseMeta.default_view_context }).state;
    controller.update(revoked);
    expect(surface.inspectorRoot.textContent).not.toContain('receipt-captured-1');
    expect(surface.timelineRoot.textContent).not.toContain('event-1');
    expect(controller.select('artifact', 'receipt-captured-1')).toBe(false);
    expect(surface.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
    controller.destroy();
  });

  it('uses one reducer state for both projections on every update, even when cursor values match', () => {
    const first = stateFor(['snapshot-A']);
    const second = stateFor(['snapshot-colliding-ids']);
    expect(first.appliedCursor).toBe(second.appliedCursor);
    const seen = [];
    const scopedMount = createObservationInspectorMount({
      projectGraph: state => { seen.push(['graph', state]); return projectGraphPresentation(state); },
      projectView: state => { seen.push(['view', state]); return projectView(state); },
    });
    const surface = inspectorDocument(projectGraphPresentation(first));
    const controller = scopedMount({ ...surface, state: first });
    controller.update(second);
    expect(seen).toEqual([['graph', first], ['view', first], ['graph', second], ['view', second]]);
    expect(controller.select('node', projectGraphPresentation(first).nodes[0].key)).toBe(false);
    controller.destroy();
  });
});
