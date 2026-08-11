/**
 * `/r/{token}` while the request document is assembled (D1).
 *
 * The slowest route in the product on the owner's side: it resolves the link, loads
 * the enquiry, and then runs the pricing engine over his catalogue to produce the
 * suggestion. He opens it from a WhatsApp notification, standing up, and the price is
 * what he came for — so the suggestion panel is reserved at full height and the total
 * does not slide as the sections above it resolve.
 *
 * The box metrics are repeated here rather than imported, because request-document.tsx
 * carries its stylesheet inline on purpose — it has to survive being saved as one file
 * and printed to PDF, so it is deliberately not a CSS module and there is nothing to
 * import. The duplication is three numbers wide (max-width, padding, border colour)
 * and it buys the placeholder the same rectangle as the document. If those numbers
 * change there, change them here.
 */

const CSS = `
.rdoc {
  max-width: 44rem;
  margin: 0 auto;
  padding: 2rem 1.25rem 3rem;
}
.rdoc .rhead {
  display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
  padding-bottom: 1rem; border-bottom: 3px solid var(--line-strong);
}
.rdoc .rrow { display: grid; grid-template-columns: 9.5rem 1fr; gap: 0.75rem;
  padding: 0.6rem 0; border-bottom: 1px solid var(--line); }
.rdoc .rsuggest { margin-top: 1.75rem; padding: 1rem;
  border: 1px solid var(--line); border-radius: 0.5rem; }
@media (max-width: 30rem) {
  .rdoc .rrow { grid-template-columns: 1fr; gap: 0.1rem; }
  .rdoc .rhead { flex-direction: column; }
}
`

const ROWS = [0, 1, 2, 3, 4]

export default function RequestLoading() {
  return (
    <article className="rdoc" aria-busy="true" aria-label="Anfrage wird geladen">
      <style>{CSS}</style>

      <header className="rhead">
        <div>
          <span className="skeleton-line" style={{ display: 'block', width: '6rem' }} />
          <span
            className="skeleton-line"
            style={{ display: 'block', width: '11rem', maxWidth: '100%', height: '1.8rem', marginTop: '0.35rem' }}
          />
        </div>
        <span className="skeleton-line" style={{ display: 'block', width: '8rem' }} />
      </header>

      <section aria-hidden="true">
        {ROWS.map((row) => (
          <div className="rrow" key={row}>
            <span className="skeleton-line" style={{ display: 'block', width: '6rem' }} />
            <span className="skeleton-line" style={{ display: 'block', width: '70%' }} />
          </div>
        ))}
      </section>

      <section className="rsuggest" aria-hidden="true">
        <span className="skeleton-line" style={{ display: 'block', width: '9rem' }} />
        <span
          className="skeleton-line"
          style={{ display: 'block', width: '15rem', maxWidth: '100%', height: '1.6rem', marginTop: '0.5rem' }}
        />
        <span className="skeleton" style={{ display: 'block', width: '100%', height: '9rem', marginTop: '0.9rem' }} />
      </section>
    </article>
  )
}
