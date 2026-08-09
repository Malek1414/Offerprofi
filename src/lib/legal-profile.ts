/** Operator facts for public legal pages. No legal identity is invented in source. */
export interface LegalProfile {
  companyName: string | null
  representative: string | null
  street: string | null
  postalCode: string | null
  city: string | null
  country: string
  email: string | null
  phone: string | null
  registerCourt: string | null
  registerNumber: string | null
  vatId: string | null
  privacyContact: string | null
  complete: boolean
}

const value = (name: string): string | null => process.env[name]?.trim() || null

export function legalProfile(): LegalProfile {
  const profile = {
    companyName: value('LEGAL_COMPANY_NAME'),
    representative: value('LEGAL_REPRESENTATIVE'),
    street: value('LEGAL_STREET'),
    postalCode: value('LEGAL_POSTAL_CODE'),
    city: value('LEGAL_CITY'),
    country: value('LEGAL_COUNTRY') ?? 'Deutschland',
    email: value('LEGAL_EMAIL'),
    phone: value('LEGAL_PHONE'),
    registerCourt: value('LEGAL_REGISTER_COURT'),
    registerNumber: value('LEGAL_REGISTER_NUMBER'),
    vatId: value('LEGAL_VAT_ID'),
    privacyContact: value('PRIVACY_CONTACT_EMAIL'),
  }

  return {
    ...profile,
    complete: Boolean(
      profile.companyName &&
        profile.representative &&
        profile.street &&
        profile.postalCode &&
        profile.city &&
        profile.email,
    ),
  }
}
