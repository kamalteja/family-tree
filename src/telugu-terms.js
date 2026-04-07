/**
 * Compare two people's ages and return "elder" or "younger".
 * The comparison is: is `targetPerson` elder or younger than `referencePerson`?
 * Uses birthday year -- lower year = elder.
 */
export function resolveAge(referencePerson, targetPerson) {
  const refDate = new Date(referencePerson.data.birthday);
  const tgtDate = new Date(targetPerson.data.birthday);

  if (isNaN(refDate.getTime()) || isNaN(tgtDate.getTime())) return 'elder';

  return tgtDate < refDate ? 'elder' : 'younger';
}

/**
 * Generic hop labels used when no specific transition rule exists.
 */
const GENERIC_HOP_LABELS = {
  parent:  { M: 'nanna',   F: 'amma' },
  child:   { M: 'koduku',  F: 'kuthuru' },
  spouse:  { M: 'bhartha', F: 'bharya' },
  sibling: { M: 'brother', F: 'sister' },
};

/**
 * Compose a fallback label when no transition rule matches.
 * Format: "currentLabel's hopLabel"
 * e.g. "thathayya's bharya"
 */
export function composeFallbackLabel(currentStateLabels, hopType, targetPerson) {
  const gender = targetPerson.data.gender;
  const hopLabel = GENERIC_HOP_LABELS[hopType]?.[gender];

  if (!hopLabel) {
    return {
      te: `${currentStateLabels.te} relative`,
    };
  }

  return {
    te: `${currentStateLabels.te} ${hopLabel}`,
  };
}
