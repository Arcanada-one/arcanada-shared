// SPDX-License-Identifier: MIT
// Exercise the real decoder/reducer/projectors using existing observation fixtures.
import { describe, expect, it } from 'vitest';
import { createReducerState, reduce, projectGraphPresentation, projectView } from './knowledge-observation.api.js';
import { caseMeta, records } from './knowledge-observation.harness.js';
import { createObservationInspectorMount } from '../browser/observation-inspector.js';
import { inspectorDocument, inspectorRegions } from './helpers/observation-inspector-dom.js';

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

const evidenceByKind = {
  node: ['receipt-captured-1', 'receipt-captured', 'receipt-captured-1-extra', 'fixture:node-only'],
  edge: ['receipt-captured-1', 'fixture:edge-only'],
  link: ['receipt-captured-1', 'fixture:link-only'],
};

function evidenceState() {
  return stateFor(['snapshot-colliding-ids', 'receipt-captured-1'], record => {
    if (record.record_id !== 'snapshot-colliding-ids') return;
    const work = record.data.graphs.find(graph => graph.graph_kind === 'work');
    work.nodes[0].evidence_refs = evidenceByKind.node;
    const other = structuredClone(work.nodes[0]);
    other.ref.local_id = 'task-2';
    other.node_type = 'leaf';
    other.evidence_refs = [];
    work.nodes.push(other);
    work.edges.push({
      edge_id: 'fixture-work-edge', kind: 'depends_on',
      from: structuredClone(work.nodes[0].ref), to: structuredClone(other.ref),
      evidence_refs: evidenceByKind.edge,
    });
    record.data.crosslinks[0].evidence_refs = evidenceByKind.link;
  });
}

function allElements(root) {
  return [root, ...root.children.flatMap(allElements)];
}

describe('inspector lifetime and exact evidence boundaries', () => {
  it('a captured old click cannot change the new selection or focus after update', () => {
    const state = stateFor(['snapshot-A', 'receipt-captured-1']);
    const surface = inspectorDocument(projectGraphPresentation(state));
    const controller = mount({ ...surface, state });
    const oldButton = surface.graphRoot.querySelector('[data-lab-inspect-kind="node"]');
    // Model a callback that was already captured before listener removal.
    const [queuedClick] = [...oldButton.handlers.get('click')];
    expect(typeof queuedClick).toBe('function');
    expect(controller.update(state)).toBe(true); // Same key still exists in the new generation.
    expect(oldButton.handlers.get('click').size).toBe(0);
    expect(controller.select('artifact', 'receipt-captured-1')).toBe(true);
    const shown = surface.inspectorRoot.textContent;
    surface.document.activeElement = surface.graphRoot;
    queuedClick({ target: oldButton });
    expect(surface.inspectorRoot.textContent).toBe(shown);
    expect(surface.document.activeElement).toBe(surface.graphRoot);
    controller.destroy();
  });

  it('destroy is terminal for selection, update and retained callbacks', () => {
    const state = stateFor(['snapshot-A', 'event-1', 'receipt-captured-1']);
    const surface = inspectorDocument(projectGraphPresentation(state));
    const controller = mount({ ...surface, state });
    const oldButton = surface.timelineRoot.querySelector('[data-lab-inspect-kind="event"]');
    const [queuedClick] = [...oldButton.handlers.get('click')];
    expect(controller.select('artifact', 'receipt-captured-1')).toBe(true);
    controller.destroy();
    const after = surface.document.body.textContent;
    surface.document.activeElement = surface.graphRoot;
    queuedClick({ target: oldButton });
    expect(controller.select('artifact', 'receipt-captured-1')).toBe(false);
    expect(controller.update(state)).toBe(false);
    expect(surface.document.body.textContent).toBe(after);
    expect(surface.document.activeElement).toBe(surface.graphRoot);
    expect(surface.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
    expect(surface.timelineRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
    expect(surface.inspectorRoot.querySelectorAll('[data-lab-observation-inspector]')).toHaveLength(0);
    expect(surface.inspectorRoot.querySelector('[data-lab-placeholder]').hasAttribute('hidden')).toBe(false);
    controller.destroy(); // Repeat disposal does not change the restored host regions.
    expect(surface.document.body.textContent).toBe(after);
  });

  for (const failingProjector of ['graph', 'view', 'inconsistent-view']) {
    it('destroys prior private details when the ' + failingProjector + ' projection fails', () => {
      const state = stateFor(['snapshot-A', 'receipt-captured-1']);
      const rejectedState = {};
      const project = createObservationInspectorMount({
        projectGraph: candidate => {
          if (candidate === rejectedState && failingProjector === 'graph') throw new Error('synthetic-projector-failure');
          return projectGraphPresentation(state);
        },
        projectView: candidate => {
          if (candidate === rejectedState && failingProjector === 'view') throw new Error('synthetic-projector-failure');
          const view = projectView(state);
          return candidate === rejectedState && failingProjector === 'inconsistent-view'
            ? { ...view, stale: !view.stale } : view;
        },
      });
      const surface = inspectorDocument(projectGraphPresentation(state));
      const controller = project({ ...surface, state });
      expect(controller.select('artifact', 'receipt-captured-1')).toBe(true);
      expect(surface.inspectorRoot.textContent).toContain('receipt-captured-1');
      expect(() => controller.update(rejectedState)).toThrow();
      expect(surface.inspectorRoot.textContent).not.toContain('receipt-captured-1');
      expect(surface.timelineRoot.querySelectorAll('[data-lab-observation-timeline]')).toHaveLength(0);
      expect(surface.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
      expect(controller.select('artifact', 'receipt-captured-1')).toBe(false);
      expect(controller.update(state)).toBe(false);
      expect(surface.inspectorRoot.querySelector('[data-lab-placeholder]').hasAttribute('hidden')).toBe(false);
      controller.destroy();
    });
  }

  for (const kind of ['node', 'edge', 'link']) {
    it('shows and opens exactly the retained ' + kind + ' evidence references', () => {
      const state = evidenceState();
      const graph = projectGraphPresentation(state);
      const key = kind === 'node' ? graph.nodes.find(node => node.nodeType === 'task').key
        : kind === 'edge' ? graph.edges[0].edgeKey : graph.crosslinks[0].linkId;
      const surface = inspectorDocument(graph);
      const controller = mount({ ...surface, state });
      expect(controller.select(kind, key)).toBe(true);
      const controls = surface.inspectorRoot.querySelectorAll('[data-lab-inspect-kind="evidence"]');
      expect(controls).toHaveLength(evidenceByKind[kind].length);
      expect(controls.map(control => control.textContent)).toEqual(expect.arrayContaining(evidenceByKind[kind]));

      for (const ref of evidenceByKind[kind]) {
        expect(controller.select(kind, key)).toBe(true);
        const selected = surface.inspectorRoot.querySelectorAll('[data-lab-inspect-kind="evidence"]')
          .find(control => control.textContent === ref);
        expect(selected).toBeDefined();
        selected.click();
        if (ref === 'receipt-captured-1') {
          const open = surface.inspectorRoot.querySelector('[disabled]');
          expect(open).not.toBeNull();
          expect(open.getAttribute('aria-disabled')).toBe('true');
          expect(surface.inspectorRoot.textContent).toContain('immutable');
          expect(surface.inspectorRoot.textContent).not.toContain('No artifact record with this exact record ID');
        } else {
          expect(surface.inspectorRoot.textContent).toContain(ref);
          expect(surface.inspectorRoot.textContent).toContain('No artifact record with this exact record ID');
          expect(surface.inspectorRoot.querySelector('[disabled]')).toBeNull();
          expect(surface.inspectorRoot.textContent).not.toContain('Observed digests');
        }
        expect(surface.inspectorRoot.querySelectorAll('[href]')).toHaveLength(0);
      }
      controller.destroy();
    });
  }

  it('does not resolve an unrelated or formerly retained evidence reference', () => {
    const state = evidenceState();
    const surface = inspectorDocument(projectGraphPresentation(state));
    const controller = mount({ ...surface, state });
    expect(controller.select('evidence', 'fixture:node-only')).toBe(true);
    expect(surface.inspectorRoot.textContent).toContain('No artifact record with this exact record ID');
    expect(controller.select('evidence', 'fixture:never-referenced')).toBe(false);
    expect(surface.inspectorRoot.textContent).toContain('Selection is not retained');
    expect(surface.inspectorRoot.textContent).not.toContain('fixture:never-referenced');
    expect(controller.update(stateFor(['snapshot-A']))).toBe(true);
    expect(controller.select('evidence', 'fixture:node-only')).toBe(false);
    expect(surface.inspectorRoot.textContent).not.toContain('fixture:node-only');
    controller.destroy();
  });

  it('treats hostile record text as inert text through the real decoder and projectors', () => {
    for (const payload of [
      '<img src=x onerror="globalThis.pwned=true">',
      'javascript:alert(1)',
      '" data-forged="yes" onclick="alert(1)',
    ]) {
      const state = stateFor(['snapshot-A'], record => {
        const node = record.data.graphs.find(graph => graph.graph_kind === 'work').nodes[0];
        node.node_type = payload;
        node.native_state.reason = payload;
      });
      const graph = projectGraphPresentation(state);
      const surface = inspectorDocument(graph);
      const controller = mount({ ...surface, state });
      expect(controller.select('node', graph.nodes[0].key)).toBe(true);
      expect(surface.inspectorRoot.textContent).toContain(payload);
      const elements = allElements(surface.document.body);
      expect(elements.some(node => ['script', 'img', 'iframe', 'svg', 'a'].includes(node.tag))).toBe(false);
      for (const node of elements) {
        expect(Object.keys(node.attrs).some(name => /^(?:on|href$|src$|style$|data-forged$)/i.test(name))).toBe(false);
      }
      controller.destroy();
    }
  });
});

describe('inspector mount identity', () => {
  it('rejects invalid prefixes before changing host regions and still accepts valid neighbours', () => {
    const state = stateFor(['snapshot-A']);
    const graph = projectGraphPresentation(state);
    const invalid = ['', 'a b', 'A', '-a', 'a_detail', 'a" onclick="x', '__proto__', null, 7, {}, ['a']];
    for (const idPrefix of invalid) {
      const surface = inspectorDocument(graph);
      const placeholders = [surface.timelineRoot, surface.inspectorRoot].map(root => root.querySelector('[data-lab-placeholder]'));
      expect(() => mount({ ...surface, state, idPrefix })).toThrow();
      expect(surface.document.querySelectorAll('[id]')).toHaveLength(0);
      expect(surface.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
      expect(placeholders.every(node => !node.hasAttribute('hidden'))).toBe(true);
    }
    for (const idPrefix of ['a', 'a-b', 'reader-2']) {
      const surface = inspectorDocument(graph);
      const controller = mount({ ...surface, state, idPrefix });
      expect(surface.document.getElementById(idPrefix + '-detail')).not.toBeNull();
      for (const button of surface.graphRoot.querySelectorAll('[data-lab-inspect-kind]')) {
        expect(button.getAttribute('aria-controls')).toBe(idPrefix + '-detail');
      }
      controller.destroy();
    }
  });

  it('refuses a duplicate detail id across different roots without damaging the first mount', () => {
    const state = stateFor(['snapshot-A']);
    const graph = projectGraphPresentation(state);
    const first = inspectorDocument(graph);
    const second = inspectorRegions(graph, first.document);
    const controller = mount({ ...first, state, idPrefix: 'reader' });
    expect(controller.select('node', graph.nodes[0].key)).toBe(true);
    const shown = first.inspectorRoot.textContent;
    expect(() => mount({ ...second, state, idPrefix: 'reader' })).toThrow();
    expect(first.inspectorRoot.textContent).toBe(shown);
    expect(first.document.querySelectorAll('[id]')).toHaveLength(1);
    expect(second.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
    expect(second.inspectorRoot.querySelector('[data-lab-placeholder]').hasAttribute('hidden')).toBe(false);
    controller.destroy();
    const replacement = mount({ ...second, state, idPrefix: 'reader' });
    expect(replacement.select('node', graph.nodes[0].key)).toBe(true);
    replacement.destroy();
    expect(first.document.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('preserves a pre-existing host id and refuses an inspector that would collide with it', () => {
    const state = stateFor(['snapshot-A']);
    const surface = inspectorDocument(projectGraphPresentation(state));
    const owned = surface.document.createElement('p');
    owned.setAttribute('id', 'reader-detail');
    owned.append(surface.document.createTextNode('host-owned-content'));
    surface.document.body.append(owned);
    expect(() => mount({ ...surface, state, idPrefix: 'reader' })).toThrow();
    expect(surface.document.getElementById('reader-detail')).toBe(owned);
    expect(owned.textContent).toBe('host-owned-content');
    expect(surface.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
    expect(surface.inspectorRoot.querySelector('[data-lab-placeholder]').hasAttribute('hidden')).toBe(false);
  });

  for (const sharedRoot of ['graphRoot', 'timelineRoot', 'inspectorRoot']) {
    it('refuses simultaneous controllers sharing ' + sharedRoot + ' even with different prefixes', () => {
      const state = stateFor(['snapshot-A']);
      const graph = projectGraphPresentation(state);
      const first = inspectorDocument(graph);
      const second = inspectorRegions(graph, first.document);
      second[sharedRoot] = first[sharedRoot];
      const controller = mount({ ...first, state, idPrefix: 'first' });
      expect(controller.select('node', graph.nodes[0].key)).toBe(true);
      const shown = first.inspectorRoot.textContent;
      expect(() => mount({ ...second, state, idPrefix: 'second' })).toThrow();
      expect(first.inspectorRoot.textContent).toBe(shown);
      expect(first.document.querySelectorAll('[id]')).toHaveLength(1);
      controller.destroy();
    });
  }

  it('refuses nested regions without letting a second controller lose its visible inspector', () => {
    const state = stateFor(['snapshot-A', 'receipt-captured-1']);
    const graph = projectGraphPresentation(state);
    const first = inspectorDocument(graph);
    const controller = mount({ ...first, state, idPrefix: 'first' });
    expect(controller.select('node', graph.nodes[0].key)).toBe(true);
    const shown = first.inspectorRoot.textContent;
    const controls = first.graphRoot.querySelectorAll('[data-lab-inspect-kind]');
    // Both descendant and ancestor roots would let one controller remove the
    // other's visible details while its separate graph controls remain live.
    for (const inspectorRoot of [first.document.getElementById('first-detail'), first.document.body]) {
      const second = inspectorRegions(graph, first.document);
      expect(() => mount({ ...second, inspectorRoot, state, idPrefix: 'second' })).toThrow();
      expect(first.inspectorRoot.textContent).toBe(shown);
      expect(first.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toEqual(controls);
      expect(first.document.querySelectorAll('[id]')).toHaveLength(1);
      expect(second.graphRoot.querySelectorAll('[data-lab-inspect-kind]')).toHaveLength(0);
    }
    expect(controller.select('artifact', 'receipt-captured-1')).toBe(true);
    controller.destroy();
  });

  it('supports distinct roots and prefixes in one document and independent documents', () => {
    const state = stateFor(['snapshot-A']);
    const graph = projectGraphPresentation(state);
    const first = inspectorDocument(graph);
    const second = inspectorRegions(graph, first.document);
    const third = inspectorDocument(graph);
    const controllers = [
      mount({ ...first, state, idPrefix: 'a' }),
      mount({ ...second, state, idPrefix: 'a-b' }),
      mount({ ...third, state, idPrefix: 'a' }),
    ];
    expect(first.document.querySelectorAll('[id]').map(node => node.id).sort()).toEqual(['a-b-detail', 'a-detail']);
    expect(third.document.querySelectorAll('[id]').map(node => node.id)).toEqual(['a-detail']);
    for (const controller of controllers) {
      expect(controller.select('node', graph.nodes[0].key)).toBe(true);
      controller.destroy();
    }
    expect(first.document.querySelectorAll('[id]')).toHaveLength(0);
    expect(third.document.querySelectorAll('[id]')).toHaveLength(0);
  });

  it('releases a failed initial mount so the same host regions and prefix remain usable', () => {
    const state = stateFor(['snapshot-A']);
    const surface = inspectorDocument(projectGraphPresentation(state));
    const inconsistentMount = createObservationInspectorMount({
      projectGraph: projectGraphPresentation,
      projectView: candidate => ({ ...projectView(candidate), appliedCursor: 'different-cursor' }),
    });
    expect(() => inconsistentMount({ ...surface, state, idPrefix: 'reader' })).toThrow();
    expect(surface.document.querySelectorAll('[id]')).toHaveLength(0);
    expect(surface.inspectorRoot.querySelector('[data-lab-placeholder]').hasAttribute('hidden')).toBe(false);
    const controller = mount({ ...surface, state, idPrefix: 'reader' });
    expect(controller.select('node', projectGraphPresentation(state).nodes[0].key)).toBe(true);
    controller.destroy();
  });

  it('restores visible, hidden and until-found placeholders exactly after disposal', () => {
    const state = stateFor(['snapshot-A']);
    const surface = inspectorDocument(projectGraphPresentation(state));
    const visible = surface.timelineRoot.querySelector('[data-lab-placeholder]');
    const hidden = surface.inspectorRoot.querySelector('[data-lab-placeholder]');
    hidden.setAttribute('hidden', '');
    const untilFound = surface.document.createElement('p');
    untilFound.setAttribute('data-lab-placeholder', '');
    untilFound.setAttribute('hidden', 'until-found');
    surface.inspectorRoot.append(untilFound);
    const placeholders = [visible, hidden, untilFound];
    const original = placeholders.map(node => node.getAttribute('hidden'));
    expect(original).toEqual([null, '', 'until-found']);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const controller = mount({ ...surface, state });
      expect(placeholders.every(node => node.hasAttribute('hidden'))).toBe(true);
      controller.destroy();
      expect(placeholders.map(node => node.getAttribute('hidden'))).toEqual(original);
    }
  });

  it('falls back to English for prototype names and preserves explicit supported locales', () => {
    const state = stateFor(['snapshot-A']);
    const graph = projectGraphPresentation(state);
    for (const locale of ['__proto__', 'constructor', 'toString', 'unknown-locale']) {
      const surface = inspectorDocument(graph, locale);
      const controller = mount({ ...surface, state });
      expect(surface.inspectorRoot.textContent).toContain('Select a node, connection');
      expect(surface.document.body.textContent).not.toContain('undefined');
      expect(surface.document.body.textContent).not.toContain('[object Object]');
      controller.destroy();
    }
    for (const [locale, text] of [['ru', 'Выберите узел'], ['zh-Hans', '选择节点']]) {
      const surface = inspectorDocument(graph, locale);
      const controller = mount({ ...surface, state });
      expect(surface.inspectorRoot.textContent).toContain(text);
      controller.destroy();
    }
  });
});

