'use client'

/**
 * S16/S17 — the catalogue list and its editor (F2.9, F2.11).
 *
 * List and form on one surface, holding the list in client state and appending on
 * save. Five services is the onboarding target, and five round trips through a detail
 * page is where the fifteen-minute budget goes.
 *
 * Two decisions worth stating, because both look like oversights:
 *
 *   - **The form does not clear the driver, unit or VAT rate after a save.** An
 *     agency's services cluster: a florist enters four flat-rate 19% items in a row.
 *     Resetting those three fields every time means twelve extra interactions to
 *     enter five services. Name, description and prices clear, because those are
 *     genuinely different each time.
 *   - **The floor price is shown on every list row**, not hidden behind an edit
 *     click. It is the number that decides how far the agent may go on the owner's
 *     behalf while she is asleep, and she should be able to audit all of them at once.
 */

import { useState } from 'react'

import styles from './catalogue.module.css'
import {
  defaultUnit,
  driverLabel,
  formatEuroInput,
  QUANTITY_DRIVERS,
  type CatalogueProblem,
} from '../../../onboarding/catalogue-form'
import { formatCents, type Cents } from '../../../domain/money'
import type { QuantityDriver } from '../../../domain/catalogue'

export interface EditorItem {
  id: string
  name: string
  description: string
  unit: string
  unitPrice: number
  floorPrice: number
  vatRate: number
  quantityDriver: QuantityDriver
  priceRuleCount: number
}

const MESSAGES: Record<string, string> = {
  'name.missing': 'Bitte geben Sie der Leistung einen Namen.',
  'name.too_long': 'Dieser Name ist zu lang.',
  'description.too_long': 'Diese Beschreibung ist zu lang.',
  'unit.missing': 'Bitte geben Sie eine Einheit an.',
  'unit.too_long': 'Diese Einheit ist zu lang.',
  'unitPrice.missing': 'Bitte geben Sie einen Preis an.',
  'unitPrice.unparseable': 'Das konnten wir nicht als Betrag lesen. Zum Beispiel: 1.180,00',
  'unitPrice.zero': 'Ein Preis von 0 € ergibt kein Angebot.',
  'unitPrice.too_large': 'Dieser Betrag sieht nach einem Tippfehler aus.',
  'floorPrice.unparseable': 'Das konnten wir nicht als Betrag lesen. Zum Beispiel: 950,00',
  'floorPrice.above_unit_price': 'Der Mindestpreis darf nicht über dem Preis liegen.',
  'floorPrice.too_large': 'Dieser Betrag sieht nach einem Tippfehler aus.',
  'vatRate.invalid': 'Bitte wählen Sie einen Steuersatz.',
  'quantityDriver.invalid': 'Bitte wählen Sie, wonach Sie abrechnen.',
}

interface Props {
  initialItems: EditorItem[]
}

const EMPTY = { name: '', description: '', unitPrice: '', floorPrice: '' }

export function CatalogueEditor({ initialItems }: Props) {
  const [items, setItems] = useState<EditorItem[]>(initialItems)
  const [fields, setFields] = useState(EMPTY)
  // Sticky between saves — see the header note.
  const [driver, setDriver] = useState<QuantityDriver>('flat')
  const [unit, setUnit] = useState(defaultUnit('flat'))
  const [vatRate, setVatRate] = useState('19')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [problems, setProblems] = useState<CatalogueProblem[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const errorFor = (field: string): string | undefined => {
    const problem = problems.find((p) => p.field === field)
    return problem && MESSAGES[`${problem.field}.${problem.code}`]
  }

  function reset() {
    setFields(EMPTY)
    setEditingId(null)
    setProblems([])
    setFormError(null)
  }

  function startEditing(item: EditorItem) {
    setEditingId(item.id)
    setFields({
      name: item.name,
      description: item.description,
      unitPrice: formatEuroInput(item.unitPrice as Cents),
      floorPrice: formatEuroInput(item.floorPrice as Cents),
    })
    setDriver(item.quantityDriver)
    setUnit(item.unit)
    setVatRate(String(item.vatRate))
    setProblems([])
    setSaved(null)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setProblems([])
    setFormError(null)
    setSaved(null)

    const payload = {
      ...fields,
      unit,
      vatRate,
      quantityDriver: driver,
      ...(editingId ? { id: editingId } : {}),
    }

    try {
      const response = await fetch('/api/catalogue', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()

      if (result.status === 'created' || result.status === 'updated') {
        const item: EditorItem = normalise(result.item)
        setItems((current) =>
          editingId ? current.map((i) => (i.id === item.id ? item : i)) : [...current, item],
        )
        setSaved(item.name)
        // Name, description and prices clear; driver, unit and VAT stay, because an
        // agency's services cluster and resetting them costs twelve interactions
        // across five entries.
        setFields(EMPTY)
        setEditingId(null)
        return
      }
      if (result.status === 'invalid') {
        setProblems(result.problems ?? [])
        return
      }
      if (result.status === 'unauthenticated') {
        window.location.assign('/login?next=/onboarding/catalogue')
        return
      }
      setFormError('Das konnte gerade nicht gespeichert werden. Bitte versuchen Sie es erneut.')
    } catch {
      setFormError('Keine Verbindung. Bitte prüfen Sie Ihr Netz und versuchen Sie es erneut.')
    } finally {
      setBusy(false)
    }
  }

  async function retire(item: EditorItem) {
    setBusy(true)
    try {
      const response = await fetch(`/api/catalogue?id=${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      })
      if (response.ok) setItems((current) => current.filter((i) => i.id !== item.id))
      else setFormError('Das konnte gerade nicht entfernt werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {items.length === 0 ? (
        <p className={styles.empty}>
          Noch keine Leistungen. Legen Sie unten Ihre erste an — Name, Preis, fertig.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <span className={styles.itemName}>{item.name}</span>
              <span className={`${styles.itemPrice} ${styles.money}`}>
                {formatCents(item.unitPrice as Cents)}
              </span>
              <span className={styles.itemMeta}>
                <span>{driverLabel(item.quantityDriver)}</span>
                <span>·</span>
                <span>{item.vatRate} % MwSt.</span>
                <span>·</span>
                <span className={styles.itemFloor}>
                  Mindestpreis {formatCents(item.floorPrice as Cents)}
                </span>
                <span>·</span>
                <button type="button" className={styles.secondary} onClick={() => startEditing(item)}>
                  Bearbeiten
                </button>
                <button type="button" className={styles.secondary} onClick={() => retire(item)}>
                  Entfernen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <h2 className={styles.formTitle}>
          {editingId ? 'Leistung bearbeiten' : 'Leistung hinzufügen'}
          {/* Announced, not only shown: the list this refers to is above the form, so
              a screen-reader user gets no other signal that the save worked. */}
          <span className={styles.saved} role="status" aria-live="polite">
            {saved && !editingId ? `„${saved}" gespeichert.` : ''}
          </span>
        </h2>

        {formError && (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        )}

        <label className={styles.field}>
          <span className={styles.label}>Name der Leistung</span>
          <input
            className={styles.input}
            value={fields.name}
            onChange={(e) => setFields({ ...fields, name: e.target.value })}
            placeholder="z. B. Florale Dekoration"
            aria-invalid={Boolean(errorFor('name'))}
            required
          />
          {errorFor('name') && <span className={styles.fieldError}>{errorFor('name')}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            Beschreibung
            <span className={styles.hint}>Steht so auf dem Angebot. Optional.</span>
          </span>
          <textarea
            className={styles.textarea}
            value={fields.description}
            onChange={(e) => setFields({ ...fields, description: e.target.value })}
            placeholder="Trauung, Tischdekoration und Raumkonzept, saisonale Blumen"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>Wonach rechnen Sie ab?</span>
          <select
            className={styles.select}
            value={driver}
            onChange={(e) => {
              const next = e.target.value as QuantityDriver
              setDriver(next)
              // Follow the driver only while the owner has not overridden it. Once
              // she has typed "Gedeck", changing the driver must not overwrite it.
              if (unit === defaultUnit(driver)) setUnit(defaultUnit(next))
            }}
          >
            {QUANTITY_DRIVERS.map((d) => (
              <option key={d} value={d}>
                {driverLabel(d)}
              </option>
            ))}
          </select>
        </label>

        <div className={`${styles.row} ${styles.rowSplit}`}>
          <label className={styles.field}>
            <span className={styles.label}>
              Preis
              <span className={styles.hint}>Netto, ohne MwSt.</span>
            </span>
            <input
              className={`${styles.input} ${styles.money}`}
              value={fields.unitPrice}
              onChange={(e) => setFields({ ...fields, unitPrice: e.target.value })}
              inputMode="decimal"
              placeholder="1.180,00"
              aria-invalid={Boolean(errorFor('unitPrice'))}
              required
            />
            {errorFor('unitPrice') && (
              <span className={styles.fieldError}>{errorFor('unitPrice')}</span>
            )}
          </label>

          <label className={styles.field}>
            <span className={styles.label}>
              Einheit
              <span className={styles.hint}>Steht hinter der Menge.</span>
            </span>
            <input
              className={styles.input}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              aria-invalid={Boolean(errorFor('unit'))}
              required
            />
            {errorFor('unit') && <span className={styles.fieldError}>{errorFor('unit')}</span>}
          </label>
        </div>

        <div className={`${styles.row} ${styles.rowSplit}`}>
          <label className={styles.field}>
            <span className={styles.label}>
              Mindestpreis
              <span className={styles.hint}>
                Darunter geht der Assistent nie. Leer lassen heißt: gar kein Nachlass.
              </span>
            </span>
            <input
              className={`${styles.input} ${styles.money}`}
              value={fields.floorPrice}
              onChange={(e) => setFields({ ...fields, floorPrice: e.target.value })}
              inputMode="decimal"
              placeholder="950,00"
              aria-invalid={Boolean(errorFor('floorPrice'))}
            />
            {errorFor('floorPrice') && (
              <span className={styles.fieldError}>{errorFor('floorPrice')}</span>
            )}
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Mehrwertsteuer</span>
            <select
              className={styles.select}
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              aria-invalid={Boolean(errorFor('vatRate'))}
            >
              <option value="19">19 % — der Regelsatz</option>
              <option value="7">7 % — ermäßigt, z. B. Speisen</option>
              <option value="0">0 % — steuerfrei</option>
            </select>
            {errorFor('vatRate') && (
              <span className={styles.fieldError}>{errorFor('vatRate')}</span>
            )}
          </label>
        </div>

        <div className={styles.actions}>
          <button className={styles.submit} type="submit" disabled={busy}>
            {editingId ? 'Änderungen speichern' : 'Leistung speichern'}
          </button>
          {editingId && (
            <button type="button" className={styles.secondary} onClick={reset}>
              Abbrechen
            </button>
          )}
        </div>
      </form>
    </>
  )
}

function normalise(raw: Record<string, unknown>): EditorItem {
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: String(raw.description ?? ''),
    unit: String(raw.unit),
    unitPrice: Number(raw.unitPrice),
    floorPrice: Number(raw.floorPrice),
    vatRate: Number(raw.vatRate),
    quantityDriver: String(raw.quantityDriver) as QuantityDriver,
    priceRuleCount: Number(raw.priceRuleCount ?? 0),
  }
}
