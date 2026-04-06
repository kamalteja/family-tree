/**
 * Compute a line-by-line diff using the LCS (Longest Common Subsequence) approach.
 * Returns an array of { type: 'same' | 'add' | 'remove', line: string } entries.
 */
export function computeDiff(oldLines, newLines) {
  const m = oldLines.length;
  const n = newLines.length;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result = [];
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && oldLines[i] === newLines[j]) {
      result.push({ type: 'same', line: oldLines[i] });
      i++;
      j++;
    } else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) {
      result.push({ type: 'add', line: newLines[j] });
      j++;
    } else {
      result.push({ type: 'remove', line: oldLines[i] });
      i++;
    }
  }

  return result;
}
