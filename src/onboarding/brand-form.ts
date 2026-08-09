export type BrandProblem = { field: 'colorPrimary'; code: 'invalid' }

export type BrandValidation =
  | { ok: true; value: { colorPrimary: string } }
  | { ok: false; problems: BrandProblem[] }

export function validateBrand(input: { colorPrimary: string }): BrandValidation {
  const raw = input.colorPrimary.trim()
  const expanded = /^#[0-9a-f]{3}$/i.test(raw)
    ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
    : raw

  if (!/^#[0-9a-f]{6}$/i.test(expanded)) {
    return { ok: false, problems: [{ field: 'colorPrimary', code: 'invalid' }] }
  }

  return { ok: true, value: { colorPrimary: expanded.toUpperCase() } }
}
