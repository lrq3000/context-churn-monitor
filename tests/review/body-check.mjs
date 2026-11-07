import assert from 'node:assert/strict';

/** Shared installed/fixture QA assertion; a loaded marker alone must not certify retrieval. */
export async function assertRenderedBody(row, response) {
  assert.ok(response?.status >= 200 && response.status < 300, 'Activity body retrieval must succeed');
  const page = JSON.parse(response.body);
  assert.ok(typeof page.text === 'string' && page.text.length > 0, 'Activity body response must include captured text');
  await row.locator('.activity-body[data-loaded]').waitFor();
  assert.equal(await row.getByRole('button', { name: /Retry loading/ }).count(), 0, 'Body loading errors are not successful evidence');
  assert.ok(await row.locator('.activity-body pre').evaluateAll((elements, text) => elements.some(element => element.textContent === text), page.text), 'Captured response text must actually render');
}
