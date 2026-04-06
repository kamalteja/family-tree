/**
 * Compare two people's ages and return "elder" or "younger".
 * The comparison is: is `targetPerson` elder or younger than `referencePerson`?
 * Uses birthday year -- lower year = elder.
 */
export function resolveAge(referencePerson, targetPerson) {
  const refYear = parseInt(referencePerson.data.birthday, 10);
  const tgtYear = parseInt(targetPerson.data.birthday, 10);

  if (isNaN(refYear) || isNaN(tgtYear)) return 'elder';

  return tgtYear < refYear ? 'elder' : 'younger';
}

/**
 * Generic hop labels used when no specific transition rule exists.
 */
const GENERIC_HOP_LABELS = {
  parent: { M: { en: 'father', te: 'nanna' }, F: { en: 'mother', te: 'amma' } },
  child:  { M: { en: 'son',    te: 'koduku' }, F: { en: 'daughter', te: 'kuthuru' } },
  spouse: { M: { en: 'husband', te: 'bhartha' }, F: { en: 'wife', te: 'bharya' } },
  sibling: { M: { en: 'brother', te: 'brother' }, F: { en: 'sister', te: 'sister' } },
};

/**
 * Compose a fallback label when no transition rule matches.
 * Format: "currentLabel's hopLabel"
 * e.g. "thathayya's bharya"
 */
export function composeFallbackLabel(currentStateLabels, hopType, targetPerson) {
  const gender = targetPerson.data.gender;
  const hopLabels = GENERIC_HOP_LABELS[hopType]?.[gender];

  if (!hopLabels) {
    return {
      en: `${currentStateLabels.en}'s relative`,
      te: `${currentStateLabels.te} relative`,
    };
  }

  return {
    en: `${currentStateLabels.en}'s ${hopLabels.en}`,
    te: `${currentStateLabels.te} ${hopLabels.te}`,
  };
}
