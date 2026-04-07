import { describe, it, expect } from 'vitest';
import { resolveRelationship, normalizePath, computeAllRelationships } from './kinship.js';

const minimalRules = {
  states: {
    self:       { te: 'nenu' },
    nanna:      { te: 'nanna' },
    amma:       { te: 'amma' },
    anna:       { te: 'anna' },
    tammudu:    { te: 'tammudu' },
    akka:       { te: 'akka' },
    chelli:     { te: 'chelli' },
    peddananna: { te: 'peddananna' },
    chinnanna:  { te: 'babai' },
    peddamma:   { te: 'peddamma' },
    pinni:      { te: 'pinni' },
    koduku:     { te: 'koduku' },
    vadhina:    { te: 'vadhina' },
    maradhalu:  { te: 'maradhalu' },
  },
  equivalences: {
    peddananna: 'nanna',
    chinnanna:  'nanna',
    peddamma:   'amma',
    pinni:      'amma',
  },
  transitions: [
    { from: 'self',  hop: 'parent',  gender: 'M', age: null,      to: 'nanna' },
    { from: 'self',  hop: 'parent',  gender: 'F', age: null,      to: 'amma' },
    { from: 'self',  hop: 'sibling', gender: 'M', age: 'elder',   to: 'anna' },
    { from: 'self',  hop: 'sibling', gender: 'M', age: 'younger', to: 'tammudu' },
    { from: 'self',  hop: 'sibling', gender: 'F', age: 'elder',   to: 'akka' },
    { from: 'self',  hop: 'sibling', gender: 'F', age: 'younger', to: 'chelli' },
    { from: 'self',  hop: 'child',   gender: 'M', age: null,      to: 'koduku' },
    { from: 'nanna', hop: 'sibling', gender: 'M', age: 'elder',   to: 'peddananna' },
    { from: 'nanna', hop: 'sibling', gender: 'M', age: 'younger', to: 'chinnanna' },
    { from: 'nanna', hop: 'sibling', gender: 'F', age: 'elder',   to: 'peddamma' },
    { from: 'nanna', hop: 'sibling', gender: 'F', age: 'younger', to: 'pinni' },
    { from: 'nanna', hop: 'child',   gender: 'M', age: 'elder',   to: 'anna' },
    { from: 'nanna', hop: 'child',   gender: 'M', age: 'younger', to: 'tammudu' },
    { from: 'nanna', hop: 'child',   gender: 'F', age: 'elder',   to: 'akka' },
    { from: 'nanna', hop: 'child',   gender: 'F', age: 'younger', to: 'chelli' },
    { from: 'amma',  hop: 'child',   gender: 'M', age: 'elder',   to: 'anna' },
    { from: 'amma',  hop: 'child',   gender: 'M', age: 'younger', to: 'tammudu' },
    { from: 'amma',  hop: 'child',   gender: 'F', age: 'elder',   to: 'akka' },
    { from: 'amma',  hop: 'child',   gender: 'F', age: 'younger', to: 'chelli' },
    { from: 'anna',  hop: 'spouse',  gender: 'F', age: null,      to: 'vadhina' },
    { from: 'tammudu', hop: 'spouse', gender: 'F', age: null,     to: 'maradhalu' },
    { from: 'peddananna', hop: 'spouse', gender: 'F', age: null,  to: 'peddamma' },
  ],
};

function makePerson(id, gender, birthday) {
  return { id, data: { gender, birthday }, rels: {} };
}

function makePersonMap(...people) {
  const map = new Map();
  for (const p of people) map.set(p.id, p);
  return map;
}

describe('resolveRelationship — equivalences', () => {
  const kamal = makePerson('kamal', 'M', '1993-03-29');
  const father = makePerson('father', 'M', '1965-01-01');
  const uncle_elder = makePerson('uncle_elder', 'M', '1960-01-01');
  const uncle_younger = makePerson('uncle_younger', 'M', '1970-01-01');
  const aunt_elder = makePerson('aunt_elder', 'F', '1960-01-01');
  const cousin_elder = makePerson('cousin_elder', 'M', '1990-01-01');
  const cousin_younger = makePerson('cousin_younger', 'M', '1995-01-01');
  const cousin_f_elder = makePerson('cousin_f_elder', 'F', '1990-01-01');
  const cousin_wife = makePerson('cousin_wife', 'F', '1991-01-01');

  const personMap = makePersonMap(
    kamal, father, uncle_elder, uncle_younger, aunt_elder,
    cousin_elder, cousin_younger, cousin_f_elder, cousin_wife,
  );

  it('resolves peddananna child(M, elder) → anna via equivalence', () => {
    const path = [
      { hop: 'parent', personId: 'father' },
      { hop: 'sibling', personId: 'uncle_elder' },
      { hop: 'child', personId: 'cousin_elder' },
    ];
    const result = resolveRelationship(path, personMap, minimalRules, 'kamal');
    expect(result.te).toBe('anna');
    expect(result.stateKey).toBe('anna');
  });

  it('resolves chinnanna child(M, younger) → tammudu via equivalence', () => {
    const path = [
      { hop: 'parent', personId: 'father' },
      { hop: 'sibling', personId: 'uncle_younger' },
      { hop: 'child', personId: 'cousin_younger' },
    ];
    const result = resolveRelationship(path, personMap, minimalRules, 'kamal');
    expect(result.te).toBe('tammudu');
    expect(result.stateKey).toBe('tammudu');
  });

  it('resolves peddamma child(F, elder) → akka via equivalence', () => {
    const path = [
      { hop: 'parent', personId: 'father' },
      { hop: 'sibling', personId: 'aunt_elder' },
      { hop: 'child', personId: 'cousin_f_elder' },
    ];
    const result = resolveRelationship(path, personMap, minimalRules, 'kamal');
    expect(result.te).toBe('akka');
    expect(result.stateKey).toBe('akka');
  });

  it('explicit transition wins over equivalence', () => {
    const path = [
      { hop: 'parent', personId: 'father' },
      { hop: 'sibling', personId: 'uncle_elder' },
      { hop: 'spouse', personId: 'cousin_wife' },
    ];
    const result = resolveRelationship(path, personMap, minimalRules, 'kamal');
    expect(result.te).toBe('peddamma');
    expect(result.stateKey).toBe('peddamma');
  });

  it('chains equivalence + further transitions correctly', () => {
    const path = [
      { hop: 'parent', personId: 'father' },
      { hop: 'sibling', personId: 'uncle_elder' },
      { hop: 'child', personId: 'cousin_elder' },
      { hop: 'spouse', personId: 'cousin_wife' },
    ];
    const result = resolveRelationship(path, personMap, minimalRules, 'kamal');
    expect(result.te).toBe('vadhina');
    expect(result.stateKey).toBe('vadhina');
  });

  it('falls back to composeFallbackLabel when no equivalence matches either', () => {
    const stranger = makePerson('stranger', 'M', '1990-01-01');
    const pm = makePersonMap(kamal, stranger);
    const rulesNoEq = { ...minimalRules, equivalences: {} };
    const path = [{ hop: 'spouse', personId: 'stranger' }];
    const result = resolveRelationship(path, pm, rulesNoEq, 'kamal');
    expect(result.stateKey).toBeNull();
    expect(result.te).toContain('nenu');
  });

  it('works without equivalences defined (backward compat)', () => {
    const rulesNoEq = { ...minimalRules };
    delete rulesNoEq.equivalences;
    const path = [
      { hop: 'parent', personId: 'father' },
      { hop: 'sibling', personId: 'uncle_elder' },
    ];
    const result = resolveRelationship(path, personMap, rulesNoEq, 'kamal');
    expect(result.te).toBe('peddananna');
    expect(result.stateKey).toBe('peddananna');
  });
});

describe('resolveRelationship — path tracking', () => {
  const kamal = makePerson('kamal', 'M', '1993-03-29');
  const father = makePerson('father', 'M', '1965-01-01');
  const uncle_elder = makePerson('uncle_elder', 'M', '1960-01-01');
  const cousin_elder = makePerson('cousin_elder', 'M', '1990-01-01');
  const personMap = makePersonMap(kamal, father, uncle_elder, cousin_elder);

  it('returns path with interleaved state and hop entries', () => {
    const path = [
      { hop: 'parent', personId: 'father' },
      { hop: 'sibling', personId: 'uncle_elder' },
      { hop: 'child', personId: 'cousin_elder' },
    ];
    const result = resolveRelationship(path, personMap, minimalRules, 'kamal');
    expect(result.path).toEqual([
      { type: 'state', label: 'nenu' },
      { type: 'hop', label: 'parent' },
      { type: 'state', label: 'nanna' },
      { type: 'hop', label: 'sibling' },
      { type: 'state', label: 'peddananna' },
      { type: 'hop', label: 'child' },
      { type: 'state', label: 'anna' },
    ]);
  });

  it('self path is just [nenu]', () => {
    const result = resolveRelationship([], personMap, minimalRules, 'kamal');
    expect(result.path).toEqual([{ type: 'state', label: 'nenu' }]);
  });
});

describe('resolveRelationship — multi-level equivalence chain', () => {
  const deepRules = {
    states: {
      self:   { te: 'nenu' },
      stateA: { te: 'A' },
      stateB: { te: 'B' },
      stateC: { te: 'C' },
      target: { te: 'target' },
    },
    equivalences: {
      stateA: 'stateB',
      stateB: 'stateC',
    },
    transitions: [
      { from: 'self',   hop: 'parent', gender: 'M', age: null, to: 'stateA' },
      { from: 'stateC', hop: 'child',  gender: 'M', age: null, to: 'target' },
    ],
  };

  it('follows equivalence chain A→B→C to find transition', () => {
    const person1 = makePerson('p1', 'M', '1965-01-01');
    const person2 = makePerson('p2', 'M', '1990-01-01');
    const me = makePerson('me', 'M', '1993-01-01');
    const pm = makePersonMap(me, person1, person2);

    const path = [
      { hop: 'parent', personId: 'p1' },
      { hop: 'child', personId: 'p2' },
    ];
    const result = resolveRelationship(path, pm, deepRules, 'me');
    expect(result.te).toBe('target');
  });
});

describe('computeAllRelationships with equivalences', () => {
  const familyData = [
    { id: 'kamal', data: { gender: 'M', birthday: '1993-03-29' }, rels: { parents: ['father'] } },
    { id: 'father', data: { gender: 'M', birthday: '1965-01-01' }, rels: { children: ['kamal', 'cousin_elder'] } },
    { id: 'uncle', data: { gender: 'M', birthday: '1960-01-01' }, rels: { parents: ['grandpa'], children: ['cousin_elder'] } },
    { id: 'grandpa', data: { gender: 'M', birthday: '1935-01-01' }, rels: { children: ['father', 'uncle'] } },
    { id: 'cousin_elder', data: { gender: 'M', birthday: '1990-01-01' }, rels: { parents: ['uncle'] } },
  ];

  it('resolves cousin via uncle equivalence in full pipeline', () => {
    const results = computeAllRelationships('kamal', familyData, minimalRules);
    const cousinLabel = results.get('cousin_elder');
    expect(cousinLabel).toBeDefined();
    expect(cousinLabel.te).toBe('anna');
  });
});
