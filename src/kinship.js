import { resolveAge, composeFallbackLabel } from './telugu-terms.js';

const MAX_EQUIVALENCE_DEPTH = 5;

/**
 * Build an adjacency representation from the family data for BFS traversal.
 * Each edge is typed: "parent", "child", "spouse".
 * "sibling" is not stored as a direct edge -- it's detected as parent→child (not self).
 */
export function buildGraph(familyData) {
  const personMap = new Map();
  familyData.forEach(p => personMap.set(p.id, p));

  const adj = new Map();
  familyData.forEach(p => adj.set(p.id, []));

  familyData.forEach(person => {
    const id = person.id;

    (person.rels.parents || []).forEach(parentId => {
      if (personMap.has(parentId)) {
        adj.get(id).push({ type: 'parent', target: parentId });
      }
    });

    (person.rels.children || []).forEach(childId => {
      if (personMap.has(childId)) {
        adj.get(id).push({ type: 'child', target: childId });
      }
    });

    (person.rels.spouses || []).forEach(spouseId => {
      if (personMap.has(spouseId)) {
        adj.get(id).push({ type: 'spouse', target: spouseId });
      }
    });
  });

  return { adj, personMap };
}

/**
 * BFS from principalId to find shortest path to every reachable person.
 * Returns a Map of personId → array of hops, where each hop is:
 *   { type: "parent"|"child"|"spouse", personId: string }
 *
 * The hop records the edge type taken AND the person arrived at.
 */
export function bfsFromPrincipal(principalId, adj) {
  const paths = new Map();
  paths.set(principalId, []);

  const queue = [principalId];
  const visited = new Set([principalId]);

  while (queue.length > 0) {
    const current = queue.shift();
    const currentPath = paths.get(current);
    const edges = adj.get(current) || [];

    for (const edge of edges) {
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);

      const newPath = [...currentPath, { type: edge.type, personId: edge.target }];
      paths.set(edge.target, newPath);
      queue.push(edge.target);
    }
  }

  return paths;
}

/**
 * Normalize a raw BFS path into a sequence of semantic hops.
 * Key transformation: detects the "sibling" pattern.
 *
 * A raw path like [parent, child] where the child is not the principal
 * is normalized to [sibling].
 *
 * Returns array of { hop: string, personId: string }
 */
export function normalizePath(rawPath, principalId, personMap) {
  const normalized = [];
  let i = 0;

  while (i < rawPath.length) {
    const step = rawPath[i];

    if (
      step.type === 'parent' &&
      i + 1 < rawPath.length &&
      rawPath[i + 1].type === 'child' &&
      rawPath[i + 1].personId !== principalId
    ) {
      normalized.push({ hop: 'sibling', personId: rawPath[i + 1].personId });
      i += 2;
    } else {
      normalized.push({ hop: step.type, personId: step.personId });
      i += 1;
    }
  }

  return normalized;
}

/**
 * Walk the state machine to resolve the relationship label for a target person.
 *
 * @param {Array} normalizedPath - output of normalizePath
 * @param {Map} personMap - id → person data
 * @param {Object} rules - parsed kinship-rules.json
 * @param {string} principalId - the principal person's id
 * @returns {{ stateKey: string, en: string, te: string }}
 */
export function resolveRelationship(normalizedPath, personMap, rules, principalId) {
  if (normalizedPath.length === 0) {
    const selfState = rules.states['self'];
    return { stateKey: 'self', te: selfState.te, path: [{ type: 'state', label: 'nenu' }] };
  }

  let currentState = 'self';
  const principal = personMap.get(principalId);
  const pathTe = [{ type: 'state', label: 'nenu' }];

  for (let i = 0; i < normalizedPath.length; i++) {
    const step = normalizedPath[i];
    const targetPerson = personMap.get(step.personId);
    const targetGender = targetPerson.data.gender;

    let ageContext = null;

    if (step.hop === 'sibling') {
      if (currentState === 'self') {
        ageContext = resolveAge(principal, targetPerson);
      } else {
        const prevPersonId = i > 0 ? normalizedPath[i - 1].personId : principalId;
        const prevPerson = personMap.get(prevPersonId);
        ageContext = resolveAge(prevPerson, targetPerson);
      }
    } else if (step.hop === 'child') {
      ageContext = resolveAge(principal, targetPerson);
    }

    let transition = findTransition(rules.transitions, currentState, step.hop, targetGender, ageContext);

    if (!transition && rules.equivalences) {
      let eq = currentState;
      for (let depth = 0; depth < MAX_EQUIVALENCE_DEPTH && !transition; depth++) {
        eq = rules.equivalences[eq];
        if (!eq) break;
        transition = findTransition(rules.transitions, eq, step.hop, targetGender, ageContext);
      }
    }

    if (transition) {
      currentState = transition.to;
      pathTe.push({ type: 'hop', label: step.hop });
      const stateLabel = rules.states[transition.to];
      if (stateLabel) pathTe.push({ type: 'state', label: stateLabel.te });
    } else {
      const currentLabel = rules.states[currentState];
      const fallback = composeFallbackLabel(currentLabel, step.hop, targetPerson);
      return {
        stateKey: null,
        te: fallback.te,
        path: pathTe,
      };
    }
  }

  const finalState = rules.states[currentState];
  return {
    stateKey: currentState,
    te: finalState ? finalState.te : currentState,
    path: pathTe,
  };
}

/**
 * Find a matching transition rule.
 * Tries exact age match first, then falls back to age=null (any age) rules.
 */
function findTransition(transitions, fromState, hop, gender, ageContext) {
  let exactMatch = null;
  let nullAgeMatch = null;

  for (const t of transitions) {
    if (t.from !== fromState || t.hop !== hop || t.gender !== gender) continue;

    if (t.age === ageContext) {
      exactMatch = t;
      break;
    }
    if (t.age === null) {
      nullAgeMatch = t;
    }
  }

  return exactMatch || nullAgeMatch;
}

/**
 * Compute relationship labels for ALL people relative to a principal person.
 *
 * @param {string} principalId
 * @param {Array} familyData - the raw family.json array
 * @param {Object} rules - parsed kinship-rules.json
 * @returns {Map<string, { en: string, te: string }>}  personId → labels
 */
export function computeAllRelationships(principalId, familyData, rules) {
  const { adj, personMap } = buildGraph(familyData);
  const rawPaths = bfsFromPrincipal(principalId, adj);
  const results = new Map();

  for (const [personId, rawPath] of rawPaths) {
    const normalizedPath = normalizePath(rawPath, principalId, personMap);
    const label = resolveRelationship(normalizedPath, personMap, rules, principalId);
    results.set(personId, label);
  }

  return results;
}
