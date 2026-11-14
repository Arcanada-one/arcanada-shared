// SPDX-License-Identifier: MIT
// Read-only browser inspection of the existing shared observation projections.
// This module performs no transport, parsing, reduction, authorization, downloads or commands.
// Bind the two shared projectors once, then pass ONE already-decoded reducer state.
// A reference is not a URL or an access grant.

const TEXT = {
  en: {
    inspect: 'Inspect', node: 'Node', edge: 'Edge', link: 'Crosslink', event: 'Event',
    evidence: 'Evidence reference', artifacts: 'Retained artifact records', emptyArtifacts: 'No artifact records retained in this view.',
    select: 'Select a node, connection, event or artifact to inspect its observed details.',
    emptyEvents: 'No applied events retained in this view.',
    retained: 'Only retained applied observations are listed. This is not a claim of complete run history.',
    noRead: 'Opening bytes requires current authorization and a byte check. No file reader is connected.',
    open: 'Open file', unresolved: 'No artifact record with this exact record ID is retained in this view. No relationship is inferred.',
    mode: 'View mode', connection: 'Connection', projection: 'Projection', stale: 'Stale observation',
    cursor: 'Cursor', plan: 'Plan revision', id: 'Record ID', kind: 'Kind', identity: 'Qualified identity',
    state: 'Observed native state', source: 'Source verdict', independent: 'Independent verdict',
    verified: 'Independently verified', basis: 'Acceptance basis', issues: 'Acceptance issues',
    from: 'From', to: 'To', association: 'Association reference', graph: 'Graph identity',
    access: 'Observed access', availability: 'Availability', storage: 'Storage identity', digests: 'Observed digests',
    acceptance: 'Acceptance projection', occurred: 'Producer occurrence time', observed: 'Observation time',
    recorded: 'Storage time', producer: 'Producer', sequence: 'Producer sequence',
    causation: 'Causation reference', correlation: 'Correlation reference',
    false: 'No', true: 'Yes', none: 'Not observed', missing: 'Selection is not retained in this view.',
    sourceOnly: 'These are observed records. Selecting one does not verify its contents, grant access or establish independent acceptance.',
  },
  ru: {
    inspect: 'Рассмотреть', node: 'Узел', edge: 'Связь', link: 'Межграфовая связь', event: 'Событие',
    evidence: 'Ссылка на свидетельство', artifacts: 'Сохранённые записи артефактов', emptyArtifacts: 'В этом представлении нет сохранённых записей артефактов.',
    select: 'Выберите узел, связь, событие или артефакт, чтобы изучить наблюдаемые сведения.',
    emptyEvents: 'В этом представлении нет сохранённых применённых событий.',
    retained: 'Показаны только сохранённые применённые наблюдения. Полнота истории запуска не утверждается.',
    noRead: 'Открытие байтов требует действующего разрешения и проверки байтов. Чтение файлов не подключено.',
    open: 'Открыть файл', unresolved: 'В этом представлении нет записи артефакта с точно таким ID записи. Связь не предполагается.',
    mode: 'Режим представления', connection: 'Соединение', projection: 'Проекция', stale: 'Устаревшее наблюдение',
    cursor: 'Курсор', plan: 'Версия плана', id: 'ID записи', kind: 'Тип', identity: 'Полная идентичность',
    state: 'Наблюдаемое нативное состояние', source: 'Вердикт источника', independent: 'Независимый вердикт',
    verified: 'Независимо подтверждено', basis: 'Основание приёмки', issues: 'Замечания к приёмке',
    from: 'Откуда', to: 'Куда', association: 'Ссылка на ассоциацию', graph: 'Идентичность графа',
    access: 'Наблюдаемый доступ', availability: 'Доступность', storage: 'Идентичность хранения', digests: 'Наблюдаемые хеши',
    acceptance: 'Проекция приёмки', occurred: 'Время события у производителя', observed: 'Время наблюдения',
    recorded: 'Время сохранения', producer: 'Производитель', sequence: 'Последовательность производителя',
    causation: 'Ссылка на причину', correlation: 'Ссылка на корреляцию',
    false: 'Нет', true: 'Да', none: 'Не наблюдалось', missing: 'Выбранный элемент не сохранён в этом представлении.',
    sourceOnly: 'Это наблюдаемые записи. Выбор записи не проверяет её содержимое, не предоставляет доступ и не подтверждает независимую приёмку.',
  },
  'zh-Hans': {
    inspect: '查看', node: '节点', edge: '边', link: '跨图关联', event: '事件',
    evidence: '证据引用', artifacts: '保留的制品记录', emptyArtifacts: '此视图未保留制品记录。',
    select: '选择节点、连接、事件或制品，查看其观测详情。',
    emptyEvents: '此视图未保留已应用的事件。',
    retained: '这里只列出保留的已应用观测，不代表完整的运行历史。',
    noRead: '打开文件字节需要当前授权和字节校验。尚未连接文件读取器。',
    open: '打开文件', unresolved: '此视图没有保留具有完全相同记录 ID 的制品记录，不推断关联。',
    mode: '视图模式', connection: '连接', projection: '投影', stale: '过期观测',
    cursor: '游标', plan: '计划版本', id: '记录 ID', kind: '类型', identity: '完整标识',
    state: '观测到的原生状态', source: '来源判定', independent: '独立判定',
    verified: '已独立验证', basis: '验收依据', issues: '验收问题',
    from: '起点', to: '终点', association: '关联引用', graph: '图标识',
    access: '观测到的访问权限', availability: '可用性', storage: '存储标识', digests: '观测到的摘要',
    acceptance: '验收投影', occurred: '生产者事件时间', observed: '观测时间',
    recorded: '存储时间', producer: '生产者', sequence: '生产者序列',
    causation: '因果引用', correlation: '相关引用',
    false: '否', true: '是', none: '未观测', missing: '此视图未保留所选项目。',
    sourceOnly: '这些是观测记录。选择记录不会验证其内容、授予访问权限或确立独立验收。',
  },
};

function element(doc, tag, attrs = {}, text) {
  const out = doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) out.setAttribute(key, String(value));
  if (text !== undefined) out.append(doc.createTextNode(String(text)));
  return out;
}

function isolated(doc, value) {
  const out = element(doc, 'bdi', { dir: 'auto' });
  out.append(doc.createTextNode(String(value)));
  return out;
}

function printable(value, words) {
  if (value === null || value === undefined || value === '') return words.none;
  if (value === true) return words.true;
  if (value === false) return words.false;
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

/**
 * Attach read-only selection and a retained-event timeline to an existing graph rendering.
 *
 * graphRoot contains data-node-key/data-edge-key/data-link-id elements, as in Agent Runs.
 * timelineRoot and inspectorRoot are the existing sections, whose headings are preserved.
 * data-lab-placeholder marks only the text that may be hidden while inspection is mounted.
 *
 * update() must receive both projections from the same fresh reducer state. It clears the
 * previous selection, buttons and private detail text on every call, including scope/session
 * changes. destroy() clears all mounted details. Neither function changes execution controls,
 * the page's mode, its authorization status, or the graph reducer.
 */
function mountProjectedInspector({
  document: doc, graphRoot, timelineRoot, inspectorRoot, graph, view,
  locale = doc.documentElement?.lang || 'en', idPrefix = 'lab-observation',
}) {
  if (!graphRoot || !timelineRoot || !inspectorRoot || !/^[a-z][a-z0-9-]*$/.test(idPrefix)) {
    throw new Error('observation-inspector-mount-unavailable');
  }
  const words = TEXT[locale] || TEXT.en;
  const timeline = element(doc, 'div', { 'data-lab-observation-timeline': '', class: 'lab-observation' });
  const inspector = element(doc, 'div', { 'data-lab-observation-inspector': '', class: 'lab-observation' });
  const details = element(doc, 'div', { id: idPrefix + '-detail', tabindex: '-1' });
  const placeholders = [...timelineRoot.querySelectorAll('[data-lab-placeholder]'),
    ...inspectorRoot.querySelectorAll('[data-lab-placeholder]')].map(node => ({ node, hidden: node.hasAttribute('hidden') }));
  let current = null;
  let generation = 0;
  let disposed = false;
  let buttons = [];
  timelineRoot.append(timeline);
  inspectorRoot.append(inspector);
  for (const { node } of placeholders) node.setAttribute('hidden', '');

  const clearChildren = node => { while (node.firstChild) node.removeChild(node.firstChild); };
  const row = (list, label, value) => {
    const term = element(doc, 'dt', {}, label);
    const description = element(doc, 'dd');
    description.append(isolated(doc, printable(value, words)));
    list.append(term, description);
  };
  const rows = entries => {
    const list = element(doc, 'dl', { class: 'lab-observation-fields' });
    for (const [label, value] of entries) row(list, label, value);
    return list;
  };
  const button = (parent, kind, key, label) => {
    const b = element(doc, 'button', {
      type: 'button', class: 'lab-observation-select', 'data-lab-inspect-kind': kind,
      'aria-controls': details.id, 'aria-pressed': 'false',
    });
    b.append(isolated(doc, label));
    const ownGeneration = generation;
    const handler = () => {
      if (!disposed && generation === ownGeneration) select(kind, key, true);
    };
    b.addEventListener('click', handler);
    parent.append(b);
    buttons.push({ b, kind, key, handler });
    return b;
  };
  const evidence = refs => {
    const section = element(doc, 'section');
    section.append(element(doc, 'h4', {}, words.evidence));
    if (!refs.length) section.append(element(doc, 'p', {}, words.none));
    else {
      const list = element(doc, 'ul');
      for (const ref of refs) {
        const item = element(doc, 'li');
        button(item, 'evidence', ref, ref);
        list.append(item);
      }
      section.append(list);
    }
    return section;
  };
  const acceptance = value => rows([
    [words.source, value.sourceVerdict], [words.independent, value.independentVerdict],
    [words.basis, value.independentBasis], [words.verified, value.independentlyVerified],
    [words.issues, value.issues],
  ]);

  function artifactDetails(record) {
    const fragment = element(doc, 'div');
    // projectKnowledgeObservation already redacts denied digests and locators.
    // Do not render locators at all: they may hold private paths or expiring URLs.
    fragment.append(rows([
      [words.id, record.recordId], [words.identity, record.artifactKey], [words.access, record.access],
      [words.availability, record.availability], [words.storage, record.storageIdentity],
      [words.acceptance, record.acceptance],
    ]));
    if (record.access === 'allowed') fragment.append(rows([[words.digests, record.digests]]));
    fragment.append(element(doc, 'p', {}, words.noRead));
    fragment.append(element(doc, 'button', {
      type: 'button', disabled: '', 'aria-disabled': 'true', class: 'lab-observation-open',
    }, words.open));
    return fragment;
  }

  function select(kind, key, focus = false) {
    if (disposed || current === null) return false;
    const { graph: g, view: v } = current;
    // Dispose controls created by the previous detail panel; repeated selection stays bounded.
    buttons = buttons.filter(item => {
      if (!details.contains(item.b)) return true;
      item.b.removeEventListener('click', item.handler);
      item.b.remove();
      return false;
    });
    clearChildren(details);
    let title;
    let content = null;
    let found = false;
    if (kind === 'node') {
      const n = g.nodes.find(n => n.key === key);
      if (n) {
        found = true; title = words.node;
        content = element(doc, 'div');
        content.append(rows([[words.identity, n.key], [words.kind, n.nodeType], [words.state, n.nativeState]]),
          acceptance(n.acceptance), evidence(n.evidenceRefs));
      }
    } else if (kind === 'edge' || kind === 'link') {
      const e = kind === 'edge' ? g.edges.find(e => e.edgeKey === key) : g.crosslinks.find(e => e.linkId === key);
      if (e) {
        found = true; title = kind === 'edge' ? words.edge : words.link;
        content = element(doc, 'div');
        content.append(rows([[words.id, kind === 'edge' ? e.edgeId : e.linkId], [words.kind, e.kind],
          [words.from, e.from.key], [words.to, e.to.key],
          ...(kind === 'edge'
            ? [[words.graph, [e.graphKind, e.graphAuthority, e.graphRevision]]]
            : [[words.association, e.associationRef]])]), evidence(e.evidenceRefs));
      }
    } else if (kind === 'event') {
      const e = v.eventLedger.find(e => e.recordId === key);
      if (e) {
        found = true; title = words.event;
        content = rows([[words.id, e.recordId], [words.event, e.eventId], [words.cursor, e.cursor],
          [words.plan, e.planRevision], [words.producer, e.producer], [words.sequence, e.sourceSequence],
          [words.occurred, e.occurredAt], [words.observed, e.observedAt], [words.recorded, e.recordedAt],
          [words.causation, e.causationRef], [words.correlation, e.correlationRef]]);
      }
    } else if (kind === 'artifact' || kind === 'evidence') {
      const a = v.artifacts.find(a => a.recordId === key);
      title = kind === 'artifact' ? words.artifacts : words.evidence;
      if (a) { found = true; content = artifactDetails(a); }
      else if (kind === 'evidence') {
        // Only references explicitly present in the current graph may be selected.
        const retained = [...g.nodes, ...g.edges, ...g.crosslinks].some(x => x.evidenceRefs.includes(key));
        if (retained) {
          found = true;
          content = element(doc, 'div');
          content.append(rows([[words.evidence, key]]), element(doc, 'p', {}, words.unresolved));
        }
      }
    }
    if (!found) {
      details.append(element(doc, 'p', { role: 'status' }, words.missing));
    } else {
      details.append(element(doc, 'h3', {}, title), content, element(doc, 'p', { class: 'lab-observation-note' }, words.sourceOnly));
    }
    for (const item of buttons) item.b.setAttribute('aria-pressed', String(found && item.kind === kind && item.key === key));
    if (focus) details.focus();
    return found;
  }

  function removeBindings() {
    for (const { b, handler } of buttons) {
      b.removeEventListener('click', handler);
      b.remove();
    }
    buttons = [];
  }

  function update(next) {
    if (disposed) return false;
    generation += 1;
    current = null;
    removeBindings();
    clearChildren(timeline);
    clearChildren(inspector);
    clearChildren(details);
    const g = next.graph, v = next.view;
    // This is a consistency fence, not authentication. Only the caller can bind a trusted view.
    if (!g || !v || ['viewKind', 'projection', 'appliedCursor', 'currentPlan', 'stale'].some(k => g[k] !== v[k])) {
      throw new Error('observation-projections-mismatch');
    }
    current = { graph: g, view: v };
    timeline.append(rows([[words.mode, g.viewKind], [words.connection, v.dimensions.connection],
      [words.projection, g.projection], [words.stale, g.stale], [words.cursor, g.appliedCursor]]));
    timeline.append(element(doc, 'p', { class: 'lab-observation-note' }, words.retained));
    if (!v.eventLedger.length) timeline.append(element(doc, 'p', {}, words.emptyEvents));
    else {
      const list = element(doc, 'ol', { 'data-lab-event-ledger': '' });
      // Keep reducer order and all three clocks; no client clock, synthetic timing or timestamp sort.
      for (const event of v.eventLedger) {
        const item = element(doc, 'li');
        button(item, 'event', event.recordId, event.cursor + ' · ' + event.eventId);
        list.append(item);
      }
      timeline.append(list);
    }
    const artifactList = element(doc, 'div');
    artifactList.append(element(doc, 'h3', {}, words.artifacts));
    if (!v.artifacts.length) artifactList.append(element(doc, 'p', {}, words.emptyArtifacts));
    else {
      const list = element(doc, 'ul');
      for (const artifact of v.artifacts) {
        const item = element(doc, 'li');
        button(item, 'artifact', artifact.recordId, artifact.recordId);
        list.append(item);
      }
      artifactList.append(list);
    }
    details.append(element(doc, 'p', { role: 'status' }, words.select));
    inspector.append(artifactList, details);
    for (const [attribute, kind, entries, key] of [
      ['data-node-key', 'node', g.nodes, 'key'],
      ['data-edge-key', 'edge', g.edges, 'edgeKey'],
      ['data-link-id', 'link', g.crosslinks, 'linkId'],
    ]) {
      for (const host of graphRoot.querySelectorAll('[' + attribute + ']')) {
        const identity = host.getAttribute(attribute);
        if (entries.some(item => item[key] === identity)) {
          button(host, kind, identity, words.inspect + ' · ' + words[kind]);
        }
      }
    }
    return true;
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    current = null;
    removeBindings();
    clearChildren(details);
    timeline.remove();
    inspector.remove();
    for (const { node, hidden } of placeholders) if (!hidden) node.removeAttribute('hidden');
  }

  try { update({ graph, view }); } catch (error) { destroy(); throw error; }
  return { select, update, destroy };
}

/**
 * Bind the existing shared package projectors, not a data-supplied callback. Both projections
 * are then created synchronously from one reducer state on every mount/update: callers cannot
 * accidentally mix graph and detail projections belonging to different scopes with equal cursors.
 * This preserves an adapter's scope binding; it does not create or authenticate that binding.
 */
export function createObservationInspectorMount({ projectGraph, projectView }) {
  if (typeof projectGraph !== 'function' || typeof projectView !== 'function') {
    throw new Error('observation-projectors-unavailable');
  }
  const project = state => ({ graph: projectGraph(state), view: projectView(state) });
  return function mountObservationInspector({ state, ...options }) {
    const controller = mountProjectedInspector({ ...options, ...project(state) });
    return {
      select: controller.select,
      destroy: controller.destroy,
      update(nextState) {
        try { return controller.update(project(nextState)); }
        catch (error) {
          // A failed projection must not leave private details from the previous view mounted.
          controller.destroy();
          throw error;
        }
      },
    };
  };
}
