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
import {
  formatQuantity,
  supportsPriceBands,
  type PriceBandForm,
  type PriceBandProblem,
} from '../../../onboarding/price-band-form'
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
  priceBands: PriceBandForm[]
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

const BAND_MESSAGES: Record<string, string> = {
  'fromQty.missing': 'Ab welcher Menge?',
  'fromQty.invalid': 'Bitte eine ganze Zahl ab 1.',
  'fromQty.duplicate': 'Diese Menge haben Sie schon angegeben.',
  'unitPrice.missing': 'Bitte einen Preis angeben.',
  'unitPrice.unparseable': 'Nicht als Betrag lesbar. Zum Beispiel: 12,50',
  'unitPrice.zero': 'Ein Preis von 0 € ergibt kein Angebot.',
  'unitPrice.too_large': 'Sieht nach einem Tippfehler aus.',
  // The one message that exists because the engine would otherwise be silent: it
  // clamps a sub-floor band up to the floor and prices correctly, so she would see a
  // price she never set, on every quote, with nothing to explain it.
  'unitPrice.below_floor': 'Liegt unter Ihrem Mindestpreis — der Assistent würde diesen nehmen.',
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
  const [bands, setBands] = useState<PriceBandForm[]>([])
  const [bandProblems, setBandProblems] = useState<PriceBandProblem[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const errorFor = (field: string): string | undefined => {
    const problem = problems.find((p) => p.field === field)
    return problem && MESSAGES[`${problem.field}.${problem.code}`]
  }

  const bandErrorFor = (index: number, field: string): string | undefined => {
    const problem = bandProblems.find((p) => p.index === index && p.field === field)
    return problem && BAND_MESSAGES[`${problem.field}.${problem.code}`]
  }

  const thresholdUnit = formatQuantity(driver)
  const bandsApply = supportsPriceBands(driver)

  function reset() {
    setFields(EMPTY)
    setEditingId(null)
    setProblems([])
    setBands([])
    setBandProblems([])
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
    setBands(item.priceBands)
    setBandProblems([])
    setProblems([])
    setSaved(null)
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setProblems([])
    setBandProblems([])
    setFormError(null)
    setSaved(null)

    const payload = {
      ...fields,
      unit,
      vatRate,
      quantityDriver: driver,
      // Sent even when empty: an empty ladder is how the last band is removed.
      priceBands: bandsApply ? bands : [],
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
        // The response carries the item, not its ladder — the ladder that was just
        // saved is the one in hand, already normalised by having been accepted.
        const item: EditorItem = normalise(result.item, bandsApply ? bands : [])
        setItems((current) =>
          editingId ? current.map((i) => (i.id === item.id ? item : i)) : [...current, item],
        )
        setSaved(item.name)
        // Name, description and prices clear; driver, unit and VAT stay, because an
        // agency's services cluster and resetting them costs twelve interactions
        // across five entries. The ladder clears with the prices — it belongs to the
        // item that was just saved, not to the next one.
        setFields(EMPTY)
        setBands([])
        setEditingId(null)
        return
      }
      if (result.status === 'invalid') {
        setProblems(result.problems ?? [])
        setBandProblems(result.bandProblems ?? [])
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

  function updateBand(index: number, patch: Partial<PriceBandForm>) {
    setBands(bands.map((band, i) => (i === index ? { ...band, ...patch } : band)))
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
                {item.priceRuleCount > 0 && (
                  <>
                    <span>·</span>
                    <span className={styles.itemBands}>
                      {item.priceRuleCount === 1
                        ? '1 Staffel'
                        : `${item.priceRuleCount} Staffeln`}
                    </span>
                  </>
                )}
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

        {/* Staffelpreise (F4.3). Hidden entirely for a Pauschale, which has no
            quantity to band on — an empty control the owner cannot use is worse
            than no control. */}
        {bandsApply && (
          <fieldset className={styles.bands}>
            <legend className={styles.label}>
              Staffelpreise
              <span className={styles.hint}>
                Optional. Wird ab einer bestimmten Menge günstiger, tragen Sie das hier
                ein — sonst gilt Ihr Preis von oben für jede Menge.
              </span>
            </legend>

            {bands.length > 0 && (
              <ol className={styles.bandList}>
                {bands.map((band, index) => (
                  <li key={index} className={styles.bandRow}>
                    <span className={styles.bandFrom}>ab</span>
                    <span className={styles.bandQty}>
                      <input
                        className={styles.input}
                        value={band.fromQty}
                        onChange={(e) => updateBand(index, { fromQty: e.target.value })}
                        inputMode="numeric"
                        placeholder="50"
                        aria-label={`Staffel ${index + 1} — ab wie vielen ${thresholdUnit}`}
                        aria-invalid={Boolean(bandErrorFor(index, 'fromQty'))}
                      />
                    </span>
                    <span className={styles.bandUnit}>{thresholdUnit}</span>
                    <span className={styles.bandQty}>
                      <input
                        className={`${styles.input} ${styles.money}`}
                        value={band.unitPrice}
                        onChange={(e) => updateBand(index, { unitPrice: e.target.value })}
                        inputMode="decimal"
                        placeholder="12,50"
                        aria-label={`Staffel ${index + 1} — Preis`}
                        aria-invalid={Boolean(bandErrorFor(index, 'unitPrice'))}
                      />
                    </span>
                    <span className={styles.bandUnit}>€</span>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => setBands(bands.filter((_, i) => i !== index))}
                      aria-label={`Staffel ${index + 1} entfernen`}
                    >
                      Entfernen
                    </button>
                    {(bandErrorFor(index, 'fromQty') || bandErrorFor(index, 'unitPrice')) && (
                      <span className={styles.bandError}>
                        {bandErrorFor(index, 'fromQty') ?? bandErrorFor(index, 'unitPrice')}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}

            <button
              type="button"
              className={styles.secondary}
              onClick={() => setBands([...bands, { fromQty: '', unitPrice: '' }])}
            >
              Staffel hinzufügen
            </button>
          </fieldset>
        )}

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

function normalise(raw: Record<string, unknown>, priceBands: PriceBandForm[]): EditorItem {
  return {
    id: String(raw.id),
    name: String(raw.name),
    description: String(raw.description ?? ''),
    unit: String(raw.unit),
    unitPrice: Number(raw.unitPrice),
    floorPrice: Number(raw.floorPrice),
    vatRate: Number(raw.vatRate),
    quantityDriver: String(raw.quantityDriver) as QuantityDriver,
    priceRuleCount: priceBands.length,
    priceBands,
  }
}
