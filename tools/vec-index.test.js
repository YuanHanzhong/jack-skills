import { expect, test } from 'bun:test';

test('vec-index --stats prints index stats without requiring a directory', async () => {
  const proc = Bun.spawn(['bun', 'tools/vec-index.js', '--stats'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(`${stdout}\n${stderr}`).not.toContain('Usage: bun tools/vec-index.js');
  expect(exitCode).toBe(0);
  expect(stdout).toContain('chunks');
  expect(stdout).toContain('embedded');
});
