/**
 * F0.11's acceptance criterion: "No model call exists outside the wrapper."
 *
 * The lint rule in eslint.config.mjs is the first enforcement. This is the second,
 * because the lint rule only sees import statements, and because a boundary that
 * is only checked by a linter is a boundary that gets checked when someone
 * remembers to run the linter.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SEARCHED = ['src', 'tests', 'scripts']
const WRAPPER = join('src', 'agent', 'client.ts')

/**
 * Assembled rather than written out, so this file is not itself a hit. Excluding
 * the test from its own search would work too, and would leave a named exemption
 * in the boundary that the next exemption could be added next to.
 */
const SDK_PACKAGE = ['@anthropic-ai', 'sdk'].join('/')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return /\.(ts|tsx|mjs|js)$/.test(entry) ? [full] : []
  })
}

describe('the model-call boundary', () => {
  const files = SEARCHED.flatMap((dir) => walk(join(ROOT, dir)))

  it('finds the files it claims to be checking', () => {
    // Guards against the walk silently matching nothing and the test passing for
    // the wrong reason.
    expect(files.length).toBeGreaterThan(50)
  })

  it('is crossed by exactly one file', () => {
    const importers = files
      .filter((file) => readFileSync(file, 'utf8').includes(SDK_PACKAGE))
      .map((file) => relative(ROOT, file))

    expect(importers).toEqual([WRAPPER.split(sep).join(sep)])
  })
})
