import { describe, it, expect } from 'vitest';
import { buildFamilyGraph, findPathBFS, findRootOf } from './viewer.js';

/*
  Test family structure:

  grandpa ── grandma
      │
  ┌───┴───┐
  father  uncle
  │
  father ── mother
      │
  ┌───┴───┐
  kamal   akhil ── snehala

  mother ── m_grandpa (mother's father)
*/

const testFamily = [
  { id: 'grandpa', data: {}, rels: { spouses: ['grandma'], children: ['father', 'uncle'] } },
  { id: 'grandma', data: {}, rels: { spouses: ['grandpa'], children: ['father', 'uncle'] } },
  { id: 'father', data: {}, rels: { parents: ['grandpa', 'grandma'], spouses: ['mother'], children: ['kamal', 'akhil'] } },
  { id: 'uncle', data: {}, rels: { parents: ['grandpa', 'grandma'] } },
  { id: 'mother', data: {}, rels: { parents: ['m_grandpa'], spouses: ['father'], children: ['kamal', 'akhil'] } },
  { id: 'm_grandpa', data: {}, rels: { children: ['mother', 'aunt'] } },
  { id: 'aunt', data: {}, rels: { parents: ['m_grandpa'] } },
  { id: 'kamal', data: {}, rels: { parents: ['father', 'mother'] } },
  { id: 'akhil', data: {}, rels: { parents: ['father', 'mother'], spouses: ['snehala'] } },
  { id: 'snehala', data: {}, rels: { spouses: ['akhil'] } },
];

describe('buildFamilyGraph', () => {
  it('creates bidirectional edges for all relationships', () => {
    const graph = buildFamilyGraph(testFamily);

    expect(graph.get('father').has('grandpa')).toBe(true);
    expect(graph.get('grandpa').has('father')).toBe(true);

    expect(graph.get('father').has('mother')).toBe(true);
    expect(graph.get('mother').has('father')).toBe(true);

    expect(graph.get('father').has('kamal')).toBe(true);
    expect(graph.get('kamal').has('father')).toBe(true);
  });

  it('includes all people in the graph', () => {
    const graph = buildFamilyGraph(testFamily);
    expect(graph.size).toBe(testFamily.length);
  });

  it('handles person with no relationships', () => {
    const data = [{ id: 'solo', data: {}, rels: {} }];
    const graph = buildFamilyGraph(data);
    expect(graph.has('solo')).toBe(true);
    expect(graph.get('solo').size).toBe(0);
  });
});

describe('findPathBFS', () => {
  it('returns single-element path when from === to', () => {
    expect(findPathBFS('kamal', 'kamal', testFamily)).toEqual(['kamal']);
  });

  it('finds direct parent-child path', () => {
    const path = findPathBFS('kamal', 'father', testFamily);
    expect(path).toEqual(['kamal', 'father']);
  });

  it('finds path through siblings', () => {
    const path = findPathBFS('kamal', 'akhil', testFamily);
    expect(path).not.toBeNull();
    expect(path[0]).toBe('kamal');
    expect(path[path.length - 1]).toBe('akhil');
    expect(path.length).toBeLessThanOrEqual(3);
  });

  it('finds path to spouse of sibling (sister-in-law)', () => {
    const path = findPathBFS('kamal', 'snehala', testFamily);
    expect(path).not.toBeNull();
    expect(path[0]).toBe('kamal');
    expect(path[path.length - 1]).toBe('snehala');
  });

  it('finds path across maternal and paternal sides', () => {
    const path = findPathBFS('uncle', 'aunt', testFamily);
    expect(path).not.toBeNull();
    expect(path[0]).toBe('uncle');
    expect(path[path.length - 1]).toBe('aunt');
  });

  it('finds path from grandchild to maternal grandparent', () => {
    const path = findPathBFS('kamal', 'm_grandpa', testFamily);
    expect(path).not.toBeNull();
    expect(path[0]).toBe('kamal');
    expect(path[path.length - 1]).toBe('m_grandpa');
    expect(path).toContain('mother');
  });

  it('returns null for disconnected people', () => {
    const data = [
      { id: 'a', data: {}, rels: {} },
      { id: 'b', data: {}, rels: {} },
    ];
    expect(findPathBFS('a', 'b', data)).toBeNull();
  });

  it('returns shortest path (BFS guarantee)', () => {
    const path = findPathBFS('kamal', 'grandpa', testFamily);
    expect(path).toEqual(['kamal', 'father', 'grandpa']);
  });
});

describe('findRootOf', () => {
  it('returns the topmost ancestor following parents[0]', () => {
    expect(findRootOf('kamal', testFamily)).toBe('grandpa');
  });

  it('returns person themselves if they have no parents', () => {
    expect(findRootOf('grandpa', testFamily)).toBe('grandpa');
  });

  it('follows maternal line when starting from mother side', () => {
    expect(findRootOf('aunt', testFamily)).toBe('m_grandpa');
  });

  it('traces mother to maternal root', () => {
    expect(findRootOf('mother', testFamily)).toBe('m_grandpa');
  });

  it('handles person not in dataset', () => {
    expect(findRootOf('nobody', testFamily)).toBe('nobody');
  });
});

describe('path includes spouse parents (trace completeness)', () => {
  it('path from kamal to snehala goes through a shared parent', () => {
    const path = findPathBFS('kamal', 'snehala', testFamily);
    const pathSet = new Set(path);
    const hasParent = pathSet.has('father') || pathSet.has('mother');
    expect(hasParent || pathSet.has('akhil')).toBe(true);
  });

  it('trace from distant relative includes connecting family members', () => {
    const path = findPathBFS('grandma', 'snehala', testFamily);
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThanOrEqual(3);
  });
});
